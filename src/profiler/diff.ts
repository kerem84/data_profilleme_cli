/**
 * Profile diff calculator — compares two DatabaseProfile snapshots.
 */
import type { DatabaseProfile, ColumnProfile, TableProfile, SchemaProfile } from './types.js';

export type DiffStatus = 'improved' | 'degraded' | 'stable' | 'new' | 'dropped';

export interface MetricDiff {
  old: number | null;
  new: number | null;
  delta: number | null;
  pctChange: number | null;
  status: DiffStatus;
}

export interface ColumnDiff {
  column_name: string;
  data_type: string;
  status: DiffStatus;
  null_ratio: MetricDiff;
  distinct_ratio: MetricDiff;
  quality_score: MetricDiff;
  old_grade: string;
  new_grade: string;
  old_flags: string[];
  new_flags: string[];
}

export interface TableDiff {
  schema_name: string;
  table_name: string;
  status: DiffStatus;
  row_count: MetricDiff;
  column_count: MetricDiff;
  quality_score: MetricDiff;
  old_grade: string;
  new_grade: string;
  columns: ColumnDiff[];
}

export interface SchemaDiff {
  schema_name: string;
  table_count: MetricDiff;
  quality_score: MetricDiff;
  tables: TableDiff[];
}

export interface DatabaseDiff {
  old_alias: string;
  new_alias: string;
  old_profiled_at: string;
  new_profiled_at: string;
  total_tables: MetricDiff;
  total_columns: MetricDiff;
  total_rows: MetricDiff;
  overall_quality: MetricDiff;
  schemas: SchemaDiff[];
  summary: {
    tables_improved: number;
    tables_degraded: number;
    tables_stable: number;
    tables_new: number;
    tables_dropped: number;
    columns_improved: number;
    columns_degraded: number;
    columns_new: number;
    columns_dropped: number;
  };
}

function metricDiff(oldVal: number | null, newVal: number | null): MetricDiff {
  if (oldVal == null && newVal == null) {
    return { old: null, new: null, delta: null, pctChange: null, status: 'stable' };
  }
  if (oldVal == null) {
    return { old: null, new: newVal, delta: null, pctChange: null, status: 'new' };
  }
  if (newVal == null) {
    return { old: oldVal, new: null, delta: null, pctChange: null, status: 'dropped' };
  }

  const delta = newVal - oldVal;
  const pctChange = oldVal !== 0 ? (delta / Math.abs(oldVal)) * 100 : (newVal !== 0 ? 100 : 0);
  return { old: oldVal, new: newVal, delta, pctChange, status: 'stable' };
}

/** Higher = better metrics */
function qualityMetricDiff(oldVal: number, newVal: number): MetricDiff {
  const m = metricDiff(oldVal, newVal);
  if (m.delta != null) {
    if (m.delta > 0.005) m.status = 'improved';
    else if (m.delta < -0.005) m.status = 'degraded';
    else m.status = 'stable';
  }
  return m;
}

/** Lower = better for null_ratio */
function inverseMetricDiff(oldVal: number, newVal: number): MetricDiff {
  const m = metricDiff(oldVal, newVal);
  if (m.delta != null) {
    if (m.delta < -0.005) m.status = 'improved';
    else if (m.delta > 0.005) m.status = 'degraded';
    else m.status = 'stable';
  }
  return m;
}

function diffColumn(oldCol: ColumnProfile | undefined, newCol: ColumnProfile | undefined): ColumnDiff {
  if (!oldCol && newCol) {
    return {
      column_name: newCol.column_name,
      data_type: newCol.data_type,
      status: 'new',
      null_ratio: metricDiff(null, newCol.null_ratio),
      distinct_ratio: metricDiff(null, newCol.distinct_ratio),
      quality_score: metricDiff(null, newCol.quality_score),
      old_grade: '-',
      new_grade: newCol.quality_grade,
      old_flags: [],
      new_flags: newCol.quality_flags,
    };
  }
  if (oldCol && !newCol) {
    return {
      column_name: oldCol.column_name,
      data_type: oldCol.data_type,
      status: 'dropped',
      null_ratio: metricDiff(oldCol.null_ratio, null),
      distinct_ratio: metricDiff(oldCol.distinct_ratio, null),
      quality_score: metricDiff(oldCol.quality_score, null),
      old_grade: oldCol.quality_grade,
      new_grade: '-',
      old_flags: oldCol.quality_flags,
      new_flags: [],
    };
  }

  const o = oldCol!;
  const n = newCol!;
  const qs = qualityMetricDiff(o.quality_score, n.quality_score);

  return {
    column_name: n.column_name,
    data_type: n.data_type,
    status: qs.status,
    null_ratio: inverseMetricDiff(o.null_ratio, n.null_ratio),
    distinct_ratio: qualityMetricDiff(o.distinct_ratio, n.distinct_ratio),
    quality_score: qs,
    old_grade: o.quality_grade,
    new_grade: n.quality_grade,
    old_flags: o.quality_flags,
    new_flags: n.quality_flags,
  };
}

function diffTable(oldTbl: TableProfile | undefined, newTbl: TableProfile | undefined): TableDiff {
  const schemaName = (newTbl ?? oldTbl)!.schema_name;
  const tableName = (newTbl ?? oldTbl)!.table_name;

  if (!oldTbl && newTbl) {
    return {
      schema_name: schemaName, table_name: tableName, status: 'new',
      row_count: metricDiff(null, newTbl.row_count),
      column_count: metricDiff(null, newTbl.column_count),
      quality_score: metricDiff(null, newTbl.table_quality_score),
      old_grade: '-', new_grade: newTbl.table_quality_grade,
      columns: newTbl.columns.map((c) => diffColumn(undefined, c)),
    };
  }
  if (oldTbl && !newTbl) {
    return {
      schema_name: schemaName, table_name: tableName, status: 'dropped',
      row_count: metricDiff(oldTbl.row_count, null),
      column_count: metricDiff(oldTbl.column_count, null),
      quality_score: metricDiff(oldTbl.table_quality_score, null),
      old_grade: oldTbl.table_quality_grade, new_grade: '-',
      columns: oldTbl.columns.map((c) => diffColumn(c, undefined)),
    };
  }

  const o = oldTbl!;
  const n = newTbl!;
  const qs = qualityMetricDiff(o.table_quality_score, n.table_quality_score);

  // Match columns by name
  const oldColMap = new Map(o.columns.map((c) => [c.column_name, c]));
  const newColMap = new Map(n.columns.map((c) => [c.column_name, c]));
  const allColNames = new Set([...oldColMap.keys(), ...newColMap.keys()]);

  const columns: ColumnDiff[] = [];
  for (const name of allColNames) {
    columns.push(diffColumn(oldColMap.get(name), newColMap.get(name)));
  }

  return {
    schema_name: schemaName, table_name: tableName, status: qs.status,
    row_count: metricDiff(o.row_count, n.row_count),
    column_count: metricDiff(o.column_count, n.column_count),
    quality_score: qs,
    old_grade: o.table_quality_grade, new_grade: n.table_quality_grade,
    columns,
  };
}

export function calculateDiff(oldProfile: DatabaseProfile, newProfile: DatabaseProfile): DatabaseDiff {
  // Build table lookup maps
  const oldTableMap = new Map<string, TableProfile>();
  const newTableMap = new Map<string, TableProfile>();
  const oldSchemaMap = new Map<string, SchemaProfile>();
  const newSchemaMap = new Map<string, SchemaProfile>();

  for (const s of oldProfile.schemas) {
    oldSchemaMap.set(s.schema_name, s);
    for (const t of s.tables) oldTableMap.set(`${s.schema_name}.${t.table_name}`, t);
  }
  for (const s of newProfile.schemas) {
    newSchemaMap.set(s.schema_name, s);
    for (const t of s.tables) newTableMap.set(`${s.schema_name}.${t.table_name}`, t);
  }

  const allSchemaNames = new Set([...oldSchemaMap.keys(), ...newSchemaMap.keys()]);
  const schemas: SchemaDiff[] = [];

  const summary = {
    tables_improved: 0, tables_degraded: 0, tables_stable: 0,
    tables_new: 0, tables_dropped: 0,
    columns_improved: 0, columns_degraded: 0,
    columns_new: 0, columns_dropped: 0,
  };

  for (const schemaName of allSchemaNames) {
    const oldSchema = oldSchemaMap.get(schemaName);
    const newSchema = newSchemaMap.get(schemaName);

    // Collect all table keys for this schema
    const oldTables = oldSchema?.tables ?? [];
    const newTables = newSchema?.tables ?? [];
    const oldTblNames = new Set(oldTables.map((t) => t.table_name));
    const newTblNames = new Set(newTables.map((t) => t.table_name));
    const allTblNames = new Set([...oldTblNames, ...newTblNames]);

    const tableDiffs: TableDiff[] = [];
    for (const tblName of allTblNames) {
      const key = `${schemaName}.${tblName}`;
      const td = diffTable(oldTableMap.get(key), newTableMap.get(key));
      tableDiffs.push(td);

      // Count summary
      switch (td.status) {
        case 'improved': summary.tables_improved++; break;
        case 'degraded': summary.tables_degraded++; break;
        case 'stable': summary.tables_stable++; break;
        case 'new': summary.tables_new++; break;
        case 'dropped': summary.tables_dropped++; break;
      }

      for (const cd of td.columns) {
        switch (cd.status) {
          case 'improved': summary.columns_improved++; break;
          case 'degraded': summary.columns_degraded++; break;
          case 'new': summary.columns_new++; break;
          case 'dropped': summary.columns_dropped++; break;
        }
      }
    }

    schemas.push({
      schema_name: schemaName,
      table_count: metricDiff(oldSchema?.table_count ?? 0, newSchema?.table_count ?? 0),
      quality_score: qualityMetricDiff(oldSchema?.schema_quality_score ?? 0, newSchema?.schema_quality_score ?? 0),
      tables: tableDiffs,
    });
  }

  return {
    old_alias: oldProfile.db_alias,
    new_alias: newProfile.db_alias,
    old_profiled_at: oldProfile.profiled_at,
    new_profiled_at: newProfile.profiled_at,
    total_tables: metricDiff(oldProfile.total_tables, newProfile.total_tables),
    total_columns: metricDiff(oldProfile.total_columns, newProfile.total_columns),
    total_rows: metricDiff(oldProfile.total_rows, newProfile.total_rows),
    overall_quality: qualityMetricDiff(oldProfile.overall_quality_score, newProfile.overall_quality_score),
    schemas,
    summary,
  };
}
