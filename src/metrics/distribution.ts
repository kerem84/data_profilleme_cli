/**
 * Distribution metrics: Top N, numeric stats, histogram.
 */
import { getLogger } from '../utils/logger.js';
import type { SqlLoader } from '../sql/loader.js';
import type { BaseConnector } from '../connectors/base-connector.js';
import type { DbConnection, TopNValue, HistogramBucket } from '../profiler/types.js';

// Numeric types (PostgreSQL + MSSQL + Oracle)
const NUMERIC_TYPES = new Set([
  // PostgreSQL
  'smallint', 'integer', 'bigint', 'decimal', 'numeric',
  'real', 'double precision', 'serial', 'bigserial',
  'int2', 'int4', 'int8', 'float4', 'float8', 'money',
  // MSSQL
  'int', 'tinyint', 'float', 'bit', 'smallmoney',
  // Oracle
  'number', 'binary_float', 'binary_double',
  // HANA
  'tinyint', 'smallint', 'integer', 'bigint', 'decimal', 'smalldecimal',
  'real', 'double', 'float',
]);

export function isNumericType(dataType: string): boolean {
  return NUMERIC_TYPES.has(dataType.toLowerCase());
}

/**
 * MSSQL non-comparable types that cannot be used with
 * COUNT(DISTINCT), GROUP BY, ORDER BY, MIN/MAX, or comparisons.
 */
const MSSQL_NON_COMPARABLE = new Set([
  'text', 'ntext', 'image', 'geometry', 'geography', 'xml',
]);

/**
 * Oracle non-comparable types (LOB types that cannot be in ORDER BY/GROUP BY).
 */
const ORACLE_NON_COMPARABLE = new Set([
  'clob', 'nclob', 'blob', 'long', 'long raw', 'bfile',
]);

/** Check if a column type is non-comparable (skip basic/topN/pattern metrics). */
const HANA_NON_COMPARABLE = new Set([
  'blob', 'clob', 'nclob', 'text',
]);

/** Check if a column type is non-comparable (skip basic/topN/pattern metrics). */
export function isNonComparableType(dataType: string, dbType: string): boolean {
  const dt = dataType.toLowerCase();
  if (dbType === 'mssql') return MSSQL_NON_COMPARABLE.has(dt);
  if (dbType === 'oracle') return ORACLE_NON_COMPARABLE.has(dt);
  if (dbType === 'hanabw') return HANA_NON_COMPARABLE.has(dt);
  return false;
}

export class DistributionMetrics {
  private dbType: string;

  constructor(
    private sql: SqlLoader,
    private connector: BaseConnector,
  ) {
    this.dbType = connector['config'].dbType;
  }

  async getTopN(
    conn: DbConnection,
    schema: string,
    table: string,
    column: string,
    topN: number,
    rowCount: number,
    samplePct?: number | null,
  ): Promise<TopNValue[]> {
    const logger = getLogger();
    if (rowCount === 0) return [];

    try {
      let sqlText = this.sql.load('top_n_values', {
        schema_name: schema,
        table_name: table,
        column_name: column,
      });
      sqlText = sqlText.replaceAll('{sample_clause}', samplePct ? `TABLESAMPLE SYSTEM (${Math.floor(samplePct)})` : '');

      let result;
      if (this.dbType === 'mssql') {
        // MSSQL: ? positional -> top_n, total_count
        result = await conn.query(sqlText, [topN, rowCount]);
      } else if (this.dbType === 'hanabw') {
        // HANA: ? positional -> total_count, top_n
        result = await conn.query(sqlText, [rowCount, topN]);
      } else if (this.dbType === 'oracle') {
        // Oracle: :total_count, :top_n named binds -> inlined
        const ora = this.sql.oracleParams(sqlText, { total_count: rowCount, top_n: topN });
        result = await conn.query(ora.sql, ora.values);
      } else {
        // PostgreSQL: %(total_count)s, %(top_n)s -> inlined
        const pgResult = this.sql.pgParams(sqlText, { total_count: rowCount, top_n: topN });
        result = await conn.query(pgResult.sql, pgResult.values);
      }

      return result.rows.map((r) => ({
        value: String(r.value ?? ''),
        frequency: Number(r.frequency),
        pct: Number(r.pct),
      }));
    } catch (err) {
      if (this.connector.isQueryTimeoutError(err)) {
        logger.warn(`[${schema}.${table}.${column}] top_n timeout`);
      } else {
        logger.warn(`[${schema}.${table}.${column}] top_n hatasi: ${err}`);
      }
      return [];
    }
  }

  async getNumericStats(
    conn: DbConnection,
    schema: string,
    table: string,
    column: string,
    samplePct?: number | null,
  ): Promise<Record<string, number | null> | null> {
    const logger = getLogger();
    try {
      let sqlText = this.sql.load('numeric_stats', {
        schema_name: schema,
        table_name: table,
        column_name: column,
      });
      sqlText = sqlText.replaceAll('{sample_clause}', samplePct ? `TABLESAMPLE SYSTEM (${Math.floor(samplePct)})` : '');
      const { rows } = await conn.query(sqlText);
      const row = rows[0];
      if (row && row.mean_value != null) {
        return {
          mean: row.mean_value != null ? Number(row.mean_value) : null,
          stddev: row.stddev_value != null ? Number(row.stddev_value) : null,
          p01: row.p01 != null ? Number(row.p01) : null,
          p05: row.p05 != null ? Number(row.p05) : null,
          p25: row.p25 != null ? Number(row.p25) : null,
          p50: row.p50 != null ? Number(row.p50) : null,
          p75: row.p75 != null ? Number(row.p75) : null,
          p95: row.p95 != null ? Number(row.p95) : null,
          p99: row.p99 != null ? Number(row.p99) : null,
        };
      }
    } catch (err) {
      if (this.connector.isQueryTimeoutError(err)) {
        logger.warn(`[${schema}.${table}.${column}] numeric_stats timeout`);
      } else {
        logger.warn(`[${schema}.${table}.${column}] numeric_stats hatasi: ${err}`);
      }
    }
    return null;
  }

  async getHistogram(
    conn: DbConnection,
    schema: string,
    table: string,
    column: string,
    buckets: number = 20,
    samplePct?: number | null,
  ): Promise<HistogramBucket[] | null> {
    const logger = getLogger();
    try {
      let sqlText = this.sql.load('histogram', {
        schema_name: schema,
        table_name: table,
        column_name: column,
      });
      // {buckets} and {sample_clause} literal substitution
      sqlText = sqlText.replaceAll('{buckets}', String(Math.floor(buckets)));
      sqlText = sqlText.replaceAll('{sample_clause}', samplePct ? `TABLESAMPLE SYSTEM (${Math.floor(samplePct)})` : '');

      const { rows } = await conn.query(sqlText);
      return rows.map((r) => ({
        bucket: Number(r.bucket),
        lower_bound: Number(r.lower_bound ?? 0),
        upper_bound: Number(r.upper_bound ?? 0),
        frequency: Number(r.freq ?? r.frequency ?? 0),
      }));
    } catch (err) {
      if (this.connector.isQueryTimeoutError(err)) {
        logger.warn(`[${schema}.${table}.${column}] histogram timeout`);
      } else {
        logger.warn(`[${schema}.${table}.${column}] histogram hatasi: ${err}`);
      }
    }
    return null;
  }
}
