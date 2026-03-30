/**
 * Profile data types.
 */
import type { SensitivityResult } from '../metrics/sensitivity.js';

export interface TopNValue {
  value: string;
  frequency: number;
  pct: number;
}

export interface HistogramBucket {
  bucket: number;
  lower_bound: number;
  upper_bound: number;
  frequency: number;
}

export interface OutlierBounds {
  lower: number;
  upper: number;
  q1: number;
  q3: number;
  iqr: number;
}

export interface ColumnProfile {
  column_name: string;
  ordinal_position: number;
  data_type: string;
  max_length: number | null;
  is_nullable: string;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  pk_constraint: string | null;
  fk_constraint: string | null;
  referenced_schema: string | null;
  referenced_table: string | null;
  referenced_column: string | null;
  description: string | null;
  // Basic
  null_count: number;
  null_ratio: number;
  distinct_count: number;
  distinct_ratio: number;
  min_value: string | null;
  max_value: string | null;
  // Numeric
  mean: number | null;
  stddev: number | null;
  percentiles: Record<string, number> | null;
  // Distribution
  top_n_values: TopNValue[];
  histogram: HistogramBucket[] | null;
  // Pattern
  detected_patterns: Record<string, number> | null;
  dominant_pattern: string | null;
  // Outlier
  outlier_count: number | null;
  outlier_ratio: number | null;
  outlier_bounds: OutlierBounds | null;
  // Quality
  quality_score: number;
  quality_grade: string;
  quality_flags: string[];
  // Sensitivity
  sensitivity: SensitivityResult | null;
  // Mapping
  dwh_mapped: boolean;
  dwh_targets: string[];
}

/** Incremental profiling status for a table. */
export type IncrementalStatus = 'changed' | 'unchanged' | 'new' | 'full';

export interface TableProfile {
  schema_name: string;
  table_name: string;
  table_type: string;
  description: string | null;
  row_count: number;
  estimated_rows: number;
  row_count_estimated: boolean;
  column_count: number;
  columns: ColumnProfile[];
  profiled_at: string;
  profile_duration_sec: number;
  sampled: boolean;
  sample_percent: number | null;
  table_size_bytes: number | null;
  table_size_display: string;
  table_quality_score: number;
  table_quality_grade: string;
  dwh_mapped: boolean;
  dwh_target_tables: string[];
  incremental_status?: IncrementalStatus;
}

export interface SchemaProfile {
  schema_name: string;
  table_count: number;
  total_rows: number;
  total_size_bytes: number;
  total_size_display: string;
  tables: TableProfile[];
  schema_quality_score: number;
}

export interface IncrementalSummary {
  enabled: boolean;
  baseline_profiled_at: string;
  tables_changed: number;
  tables_unchanged: number;
  tables_new: number;
}

export interface DatabaseProfile {
  db_alias: string;
  db_name: string;
  host: string;
  profiled_at: string;
  total_schemas: number;
  total_tables: number;
  total_columns: number;
  total_rows: number;
  total_size_bytes: number;
  total_size_display: string;
  schemas: SchemaProfile[];
  overall_quality_score: number;
  incremental?: IncrementalSummary;
}

/** Checkpoint data for crash recovery. */
export interface CheckpointData {
  db_alias: string;
  started_at: string;
  updated_at: string;
  completed_tables: string[];
  partial_profile: DatabaseProfile;
}

/** Format bytes to human-readable size string. */
export function formatSize(bytes: number | null): string {
  if (bytes == null || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let size = bytes;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx++;
  }
  return `${size.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function createDefaultColumnProfile(colMeta: Record<string, unknown>): ColumnProfile {
  return {
    column_name: String(colMeta.column_name ?? ''),
    ordinal_position: Number(colMeta.ordinal_position ?? 0),
    data_type: String(colMeta.data_type ?? ''),
    max_length: colMeta.character_maximum_length != null ? Number(colMeta.character_maximum_length) : null,
    is_nullable: String(colMeta.is_nullable ?? 'YES'),
    is_primary_key: Boolean(colMeta.is_primary_key),
    is_foreign_key: Boolean(colMeta.is_foreign_key),
    pk_constraint: colMeta.pk_constraint != null ? String(colMeta.pk_constraint) : null,
    fk_constraint: colMeta.fk_constraint != null ? String(colMeta.fk_constraint) : null,
    referenced_schema: colMeta.referenced_schema != null ? String(colMeta.referenced_schema) : null,
    referenced_table: colMeta.referenced_table != null ? String(colMeta.referenced_table) : null,
    referenced_column: colMeta.referenced_column != null ? String(colMeta.referenced_column) : null,
    description: colMeta.column_description != null ? String(colMeta.column_description) : null,
    null_count: 0,
    null_ratio: 0.0,
    distinct_count: 0,
    distinct_ratio: 0.0,
    min_value: null,
    max_value: null,
    mean: null,
    stddev: null,
    percentiles: null,
    top_n_values: [],
    histogram: null,
    detected_patterns: null,
    dominant_pattern: null,
    outlier_count: null,
    outlier_ratio: null,
    outlier_bounds: null,
    quality_score: 0.0,
    quality_grade: 'F',
    quality_flags: [],
    dwh_mapped: false,
    dwh_targets: [],
    sensitivity: null,
  };
}

/** Unified DB query result. */
export interface QueryResult {
  rows: Record<string, unknown>[];
}

/** Unified DB connection interface. */
export interface DbConnection {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
}

export interface TableInfo {
  table_name: string;
  table_type: string;
  estimated_rows: number;
  table_description?: string;
}

export interface RowCountResult {
  row_count: number;
  estimated: boolean;
}
