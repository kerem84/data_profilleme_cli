/**
 * PostgreSQL connector using pg.
 */
import pg from 'pg';
import { getLogger } from '../utils/logger.js';
import { BaseConnector } from './base-connector.js';
import type { DatabaseConfig } from '../config/types.js';
import type { DbConnection, QueryResult, RowCountResult, TableInfo } from '../profiler/types.js';

const { Pool } = pg;

export class PostgresConnector extends BaseConnector {
  private pool: pg.Pool;

  constructor(config: DatabaseConfig) {
    super(config);
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.dbname,
      user: config.user,
      password: config.password,
      connectionTimeoutMillis: config.connectTimeout * 1000,
      statement_timeout: config.statementTimeout,
      max: 3,
    });
  }

  async withConnection<T>(fn: (conn: DbConnection) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      const conn: DbConnection = {
        async query(sql: string, params?: unknown[]): Promise<QueryResult> {
          const result = await client.query(sql, params);
          return { rows: result.rows };
        },
      };
      return await fn(conn);
    } finally {
      client.release();
    }
  }

  async executeQuery(sql: string, params?: unknown): Promise<Record<string, unknown>[] | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, params as unknown[] | undefined);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async testConnection(): Promise<boolean> {
    const logger = getLogger();
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
      logger.info(`[${this.config.alias}] Baglanti basarili: ${this.config.host}:${this.config.port}/${this.config.dbname}`);
      return true;
    } catch (e) {
      logger.error(`[${this.config.alias}] Baglanti hatasi: ${e}`);
      return false;
    }
  }

  async discoverSchemas(): Promise<string[]> {
    const sql = `
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        AND schema_name NOT LIKE 'pg_temp_%'
        AND schema_name NOT LIKE 'pg_toast_temp_%'
      ORDER BY schema_name;
    `;
    const rows = await this.executeQuery(sql);
    const allSchemas = (rows ?? []).map((r) => String(r.schema_name));

    const sf = this.config.schemaFilter;
    if (sf === '*') return allSchemas;
    if (Array.isArray(sf)) return allSchemas.filter((s) => sf.includes(s));
    return allSchemas;
  }

  async discoverTables(schema: string): Promise<TableInfo[]> {
    const sql = `
      SELECT
        t.table_name,
        t.table_type,
        COALESCE(s.n_live_tup, 0) AS estimated_rows
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s
        ON t.table_schema = s.schemaname AND t.table_name = s.relname
      WHERE t.table_schema = $1
        AND t.table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY t.table_name;
    `;
    const rows = await this.executeQuery(sql, [schema]);
    return (rows ?? []).map((r) => ({
      table_name: String(r.table_name),
      table_type: String(r.table_type),
      estimated_rows: Number(r.estimated_rows ?? 0),
    }));
  }

  async getEstimatedRowCount(conn: DbConnection, schema: string, table: string): Promise<RowCountResult> {
    const sql = `
      SELECT COALESCE(n_live_tup, 0) AS estimated_rows
      FROM pg_stat_user_tables
      WHERE schemaname = $1 AND relname = $2;
    `;
    try {
      const { rows } = await conn.query(sql, [schema, table]);
      const count = rows[0]?.estimated_rows ?? 0;
      return { row_count: Number(count), estimated: true };
    } catch {
      return { row_count: 0, estimated: true };
    }
  }

  async validateDbType(conn: DbConnection): Promise<boolean> {
    const logger = getLogger();
    try {
      const { rows } = await conn.query('SELECT version()');
      const version = String(rows[0]?.version ?? '');
      if (!version.includes('PostgreSQL')) {
        logger.error(`[${this.config.alias}] db_type=postgresql ama sunucu PostgreSQL degil: ${version}`);
        return false;
      }
      return true;
    } catch (e) {
      logger.warn(`[${this.config.alias}] db_type dogrulama hatasi: ${e}`);
      return true;
    }
  }

  async getTableSize(conn: DbConnection, schema: string, table: string): Promise<number | null> {
    const safeName = `${schema.replace(/'/g, "''")}.${table.replace(/'/g, "''")}`;
    const sql = `SELECT pg_total_relation_size('${safeName}'::regclass) AS size_bytes`;
    try {
      const { rows } = await conn.query(sql);
      return rows[0]?.size_bytes != null ? Number(rows[0].size_bytes) : null;
    } catch {
      return null;
    }
  }

  isQueryTimeoutError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'code' in error) {
      return (error as { code: string }).code === '57014'; // query_canceled
    }
    return false;
  }

  async destroy(): Promise<void> {
    await this.pool.end();
  }
}
