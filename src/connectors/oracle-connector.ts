/**
 * Oracle connector using oracledb (thin mode — no Oracle Client needed).
 */
import OracleDB from 'oracledb';
import { getLogger } from '../utils/logger.js';
import { BaseConnector } from './base-connector.js';
import type { DatabaseConfig } from '../config/types.js';
import type { DbConnection, QueryResult, RowCountResult, TableInfo } from '../profiler/types.js';

// Oracle sistem semalari (filtreleme icin)
const SYSTEM_SCHEMAS = new Set([
  'SYS', 'SYSTEM', 'DBSNMP', 'OUTLN', 'XDB', 'CTXSYS', 'MDSYS',
  'OLAPSYS', 'WMSYS', 'ORDDATA', 'ORDSYS', 'ANONYMOUS', 'APPQOSSYS',
  'AUDSYS', 'DBSFWUSER', 'DIP', 'GGSYS', 'GSMADMIN_INTERNAL',
  'GSMCATUSER', 'GSMUSER', 'LBACSYS', 'MDDATA', 'OJVMSYS',
  'ORACLE_OCM', 'REMOTE_SCHEDULER_AGENT', 'SI_INFORMTN_SCHEMA',
  'SYSBACKUP', 'SYSDG', 'SYSKM', 'SYSRAC', 'XS$NULL',
]);

export class OracleConnector extends BaseConnector {
  private pool: OracleDB.Pool | null = null;

  constructor(config: DatabaseConfig) {
    super(config);
  }

  private buildConnectString(): string {
    const service = this.config.serviceName || this.config.dbname;
    return `${this.config.host}:${this.config.port}/${service}`;
  }

  private async getPool(): Promise<OracleDB.Pool> {
    if (!this.pool) {
      this.pool = await OracleDB.createPool({
        user: this.config.user,
        password: this.config.password,
        connectString: this.buildConnectString(),
        poolMin: 0,
        poolMax: this.config.poolMax,
        poolIncrement: 1,
      });
    }
    return this.pool;
  }

  async withConnection<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
    const pool = await this.getPool();
    const oraConn = await pool.getConnection();
    // Statement timeout
    oraConn.callTimeout = this.config.statementTimeout;
    try {
      // READ ONLY transaction — no DML, no locks
      await oraConn.execute('SET TRANSACTION READ ONLY');

      const conn: DbConnection = {
        async query(sql: string, _params?: unknown[]): Promise<QueryResult> {
          const result = await oraConn.execute(sql, [], {
            outFormat: OracleDB.OUT_FORMAT_OBJECT,
          });
          // Oracle returns uppercase column names — normalize to lowercase
          const rows = (result.rows as Record<string, unknown>[] ?? []).map((row) => {
            const lower: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(row)) {
              lower[k.toLowerCase()] = v;
            }
            return lower;
          });
          return { rows };
        },
      };
      return await fn(conn);
    } finally {
      await oraConn.close();
    }
  }

  async executeQuery(sql: string, params?: unknown): Promise<Record<string, unknown>[] | null> {
    const pool = await this.getPool();
    const oraConn = await pool.getConnection();
    oraConn.callTimeout = this.config.statementTimeout;
    try {
      const bindParams = params && typeof params === 'object' && !Array.isArray(params)
        ? params as Record<string, string | number>
        : {};
      const result = await oraConn.execute(sql, bindParams, {
        outFormat: OracleDB.OUT_FORMAT_OBJECT,
      });
      return (result.rows as Record<string, unknown>[] ?? []).map((row) => {
        const lower: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          lower[k.toLowerCase()] = v;
        }
        return lower;
      });
    } finally {
      await oraConn.close();
    }
  }

  async testConnection(): Promise<boolean> {
    const logger = getLogger();
    try {
      const pool = await this.getPool();
      const conn = await pool.getConnection();
      try {
        await conn.execute('SELECT 1 FROM DUAL');
      } finally {
        await conn.close();
      }
      const service = this.config.serviceName || this.config.dbname;
      logger.info(`[${this.config.alias}] Baglanti basarili: ${this.config.host}:${this.config.port}/${service}`);
      return true;
    } catch (e) {
      logger.error(`[${this.config.alias}] Baglanti hatasi: ${e}`);
      return false;
    }
  }

  async discoverSchemas(): Promise<string[]> {
    const placeholders = [...SYSTEM_SCHEMAS].map((s) => `'${s}'`).join(', ');
    const sql = `
      SELECT DISTINCT owner AS schema_name
      FROM all_tables
      WHERE owner NOT IN (${placeholders})
      ORDER BY owner
    `;
    const rows = await this.executeQuery(sql);
    let allSchemas = (rows ?? [])
      .map((r) => String(r.schema_name))
      .filter((s) => !s.startsWith('APEX_') && !s.startsWith('FLOWS_'));

    const sf = this.config.schemaFilter;
    if (sf === '*') return allSchemas;
    if (Array.isArray(sf)) {
      const sfUpper = new Set(sf.map((s) => s.toUpperCase()));
      return allSchemas.filter((s) => sfUpper.has(s.toUpperCase()));
    }
    return allSchemas;
  }

  async discoverTables(schema: string): Promise<TableInfo[]> {
    const sql = `
      SELECT
        table_name,
        'BASE TABLE' AS table_type,
        NVL(num_rows, 0) AS estimated_rows
      FROM all_tables
      WHERE owner = :schema
      UNION ALL
      SELECT
        view_name AS table_name,
        'VIEW' AS table_type,
        0 AS estimated_rows
      FROM all_views
      WHERE owner = :schema
      ORDER BY table_name
    `;
    const rows = await this.executeQuery(sql, { schema });
    return (rows ?? []).map((r) => ({
      table_name: String(r.table_name),
      table_type: String(r.table_type),
      estimated_rows: Number(r.estimated_rows ?? 0),
    }));
  }

  async getEstimatedRowCount(conn: DbConnection, schema: string, table: string): Promise<RowCountResult> {
    const safeSchema = schema.replace(/'/g, "''");
    const safeTable = table.replace(/'/g, "''");
    const sql = `
      SELECT NVL(num_rows, 0) AS cnt
      FROM all_tables
      WHERE owner = '${safeSchema}' AND table_name = '${safeTable}'
    `;
    try {
      const { rows } = await conn.query(sql);
      const count = rows[0]?.cnt ?? 0;
      return { row_count: Number(count), estimated: true };
    } catch {
      return { row_count: 0, estimated: true };
    }
  }

  async validateDbType(conn: DbConnection): Promise<boolean> {
    const logger = getLogger();
    try {
      const { rows } = await conn.query('SELECT banner AS version FROM v$version WHERE ROWNUM = 1');
      const version = String(rows[0]?.version ?? '');
      if (!version.includes('Oracle')) {
        logger.error(`[${this.config.alias}] db_type=oracle ama sunucu Oracle degil: ${version}`);
        return false;
      }
      return true;
    } catch (e) {
      logger.warn(`[${this.config.alias}] db_type dogrulama hatasi: ${e}`);
      return true;
    }
  }

  async getTableSize(conn: DbConnection, schema: string, table: string): Promise<number | null> {
    const safeSchema = schema.replace(/'/g, "''");
    const safeTable = table.replace(/'/g, "''");
    // Try DBA_SEGMENTS first, fall back to USER_SEGMENTS
    const queries = [
      `SELECT NVL(SUM(bytes), 0) AS size_bytes
       FROM dba_segments
       WHERE owner = '${safeSchema}' AND segment_name = '${safeTable}'`,
      `SELECT NVL(SUM(bytes), 0) AS size_bytes
       FROM user_segments
       WHERE segment_name = '${safeTable}'`,
    ];
    for (const sql of queries) {
      try {
        const { rows } = await conn.query(sql);
        const size = rows[0]?.size_bytes;
        if (size != null && Number(size) > 0) return Number(size);
      } catch {
        continue;
      }
    }
    return null;
  }

  isQueryTimeoutError(error: unknown): boolean {
    // ORA-01013: user requested cancel of current operation
    // ORA-03136: inbound connection timed out
    if (error && typeof error === 'object' && 'errorNum' in error) {
      const num = (error as { errorNum: number }).errorNum;
      return num === 1013 || num === 3136;
    }
    return false;
  }

  async destroy(): Promise<void> {
    if (this.pool) {
      await this.pool.close(0);
      this.pool = null;
    }
  }
}
