/**
 * MSSQL connector using mssql (tedious).
 */
import sql from 'mssql';
import { getLogger } from '../utils/logger.js';
import { BaseConnector } from './base-connector.js';
import type { DatabaseConfig } from '../config/types.js';
import type { DbConnection, QueryResult, RowCountResult, TableInfo } from '../profiler/types.js';

/** Strip SQL single-line comments to avoid ? in comments being treated as params. */
function stripComments(text: string): string {
  return text.replace(/--.*$/gm, '');
}

export class MssqlConnector extends BaseConnector {
  private poolPromise: Promise<sql.ConnectionPool>;

  constructor(config: DatabaseConfig) {
    super(config);
    const mssqlConfig: sql.config = {
      server: config.host,
      port: config.port,
      database: config.dbname,
      user: config.user,
      password: config.password,
      connectionTimeout: config.connectTimeout * 1000,
      requestTimeout: config.statementTimeout,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        isolationLevel: sql.ISOLATION_LEVEL.READ_UNCOMMITTED,
      },
      pool: {
        max: 3,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };
    const pool = new sql.ConnectionPool(mssqlConfig);
    // Suppress unhandled 'error' events from tedious on connection timeout.
    // The error is already surfaced via the rejected connect() promise.
    pool.on('error', () => {});
    this.poolPromise = pool.connect();
  }

  async withConnection<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
    const pool = await this.poolPromise;
    const conn: DbConnection = {
      async query(sqlText: string, params?: unknown[]): Promise<QueryResult> {
        const request = pool.request();
        if (params) {
          // Strip comments so ? inside -- comments aren't replaced
          sqlText = stripComments(sqlText);
          params.forEach((value, i) => {
            request.input(`p${i + 1}`, value);
          });
          let idx = 0;
          sqlText = sqlText.replace(/\?/g, () => {
            idx++;
            return `@p${idx}`;
          });
        }
        const result = await request.query(sqlText);
        return { rows: result.recordset ?? [] };
      },
    };
    return fn(conn);
  }

  async executeQuery(sqlText: string, params?: unknown): Promise<Record<string, unknown>[] | null> {
    const pool = await this.poolPromise;
    const request = pool.request();
    if (params && Array.isArray(params)) {
      sqlText = stripComments(sqlText);
      params.forEach((value, i) => {
        request.input(`p${i + 1}`, value);
      });
      let idx = 0;
      sqlText = sqlText.replace(/\?/g, () => {
        idx++;
        return `@p${idx}`;
      });
    }
    const result = await request.query(sqlText);
    return result.recordset ?? [];
  }

  async testConnection(): Promise<boolean> {
    const logger = getLogger();
    try {
      const pool = await this.poolPromise;
      await pool.request().query('SELECT 1');
      logger.info(`[${this.config.alias}] Baglanti basarili: ${this.config.host}:${this.config.port}/${this.config.dbname}`);
      return true;
    } catch (e) {
      logger.error(`[${this.config.alias}] Baglanti hatasi: ${e}`);
      return false;
    }
  }

  async discoverSchemas(): Promise<string[]> {
    const sqlText = `
      SELECT s.name AS schema_name
      FROM sys.schemas s
      INNER JOIN sys.sysusers u ON s.principal_id = u.uid
      WHERE s.name NOT IN (
        'sys', 'INFORMATION_SCHEMA', 'guest',
        'db_owner', 'db_accessadmin', 'db_securityadmin',
        'db_ddladmin', 'db_backupoperator', 'db_datareader',
        'db_datawriter', 'db_denydatareader', 'db_denydatawriter'
      )
      ORDER BY s.name;
    `;
    const rows = await this.executeQuery(sqlText);
    const allSchemas = (rows ?? []).map((r) => String(r.schema_name));

    const sf = this.config.schemaFilter;
    if (sf === '*') return allSchemas;
    if (Array.isArray(sf)) return allSchemas.filter((s) => sf.includes(s));
    return allSchemas;
  }

  async discoverTables(schema: string): Promise<TableInfo[]> {
    const sqlText = `
      SELECT
        t.name AS table_name,
        'BASE TABLE' AS table_type,
        ISNULL(SUM(p.row_count), 0) AS estimated_rows
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      LEFT JOIN sys.dm_db_partition_stats p
        ON t.object_id = p.object_id AND p.index_id IN (0, 1)
      WHERE s.name = ?
      GROUP BY t.name
      UNION ALL
      SELECT
        v.name AS table_name,
        'VIEW' AS table_type,
        0 AS estimated_rows
      FROM sys.views v
      INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
      WHERE s.name = ?
      ORDER BY table_name;
    `;
    try {
      const rows = await this.executeQuery(sqlText, [schema, schema]);
      return (rows ?? []).map((r) => ({
        table_name: String(r.table_name),
        table_type: String(r.table_type),
        estimated_rows: Number(r.estimated_rows ?? 0),
      }));
    } catch {
      // Fallback: dm_db_partition_stats erisim yoksa sysindexes kullan
      const fallback = `
        SELECT
          t.name AS table_name,
          'BASE TABLE' AS table_type,
          ISNULL(MAX(i.rowcnt), 0) AS estimated_rows
        FROM sys.tables t
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        LEFT JOIN sys.sysindexes i ON t.object_id = i.id AND i.indid IN (0, 1)
        WHERE s.name = ?
        GROUP BY t.name
        UNION ALL
        SELECT v.name AS table_name, 'VIEW' AS table_type, 0 AS estimated_rows
        FROM sys.views v
        INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
        WHERE s.name = ?
        ORDER BY table_name;
      `;
      const rows = await this.executeQuery(fallback, [schema, schema]);
      return (rows ?? []).map((r) => ({
        table_name: String(r.table_name),
        table_type: String(r.table_type),
        estimated_rows: Number(r.estimated_rows ?? 0),
      }));
    }
  }

  async getEstimatedRowCount(conn: DbConnection, schema: string, table: string): Promise<RowCountResult> {
    const queries = [
      `SELECT ISNULL(SUM(p.row_count), 0) AS cnt
       FROM sys.tables t
       INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
       INNER JOIN sys.dm_db_partition_stats p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
       WHERE s.name = ? AND t.name = ?`,
      `SELECT ISNULL(MAX(i.rowcnt), 0) AS cnt
       FROM sys.tables t
       INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
       INNER JOIN sys.sysindexes i ON t.object_id = i.id AND i.indid IN (0, 1)
       WHERE s.name = ? AND t.name = ?`,
    ];
    for (const q of queries) {
      try {
        const { rows } = await conn.query(q, [schema, table]);
        const count = rows[0]?.cnt ?? 0;
        return { row_count: Number(count), estimated: true };
      } catch {
        continue;
      }
    }
    return { row_count: 0, estimated: true };
  }

  async validateDbType(conn: DbConnection): Promise<boolean> {
    const logger = getLogger();
    try {
      const { rows } = await conn.query('SELECT @@VERSION AS version');
      const version = String(rows[0]?.version ?? '');
      if (!version.includes('Microsoft SQL Server')) {
        logger.error(`[${this.config.alias}] db_type=mssql ama sunucu MSSQL degil: ${version}`);
        return false;
      }
      return true;
    } catch (e) {
      logger.warn(`[${this.config.alias}] db_type dogrulama hatasi: ${e}`);
      return true;
    }
  }

  async getTableSize(conn: DbConnection, schema: string, table: string): Promise<number | null> {
    const sql = `
      SELECT SUM(a.total_pages) * 8 * 1024 AS size_bytes
      FROM sys.tables t WITH (NOLOCK)
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      INNER JOIN sys.indexes i ON t.object_id = i.object_id
      INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
      INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
      WHERE s.name = ? AND t.name = ?`;
    try {
      const { rows } = await conn.query(sql, [schema, table]);
      return rows[0]?.size_bytes != null ? Number(rows[0].size_bytes) : null;
    } catch {
      return null;
    }
  }

  isQueryTimeoutError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const e = error as Record<string, unknown>;
      return e.code === 'ETIMEOUT' || e.number === 3989;
    }
    return false;
  }

  async destroy(): Promise<void> {
    try {
      const pool = await this.poolPromise;
      await pool.close();
    } catch {
      // Pool never connected — nothing to close
    }
  }
}
