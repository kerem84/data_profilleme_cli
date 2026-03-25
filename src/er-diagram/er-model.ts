/**
 * Builds an ERModel from a DatabaseProfile, filtering by detail level.
 */

import type { DatabaseProfile } from '../profiler/types.js';
import type { DetailLevel, ERModel, ERSchema, ERTable, ERColumn, ERRelation } from './types.js';

interface RawFK {
  from_schema: string;
  from_table: string;
  from_column: string;
  to_schema: string;
  to_table: string;
  to_column: string;
  constraint_name: string;
  from_is_pk: boolean;
}

export function buildERModel(profile: DatabaseProfile, level: DetailLevel): ERModel {
  const schemas: ERSchema[] = [];
  const rawFKs: RawFK[] = [];
  const tableSet = new Set<string>(); // "schema.table" for lookup

  // 1. Extract tables and columns, collect raw FK data
  for (const schema of profile.schemas) {
    const tables: ERTable[] = [];

    for (const table of schema.tables) {
      const key = `${schema.schema_name}.${table.table_name}`;
      tableSet.add(key);

      const columns: ERColumn[] = [];
      for (const col of table.columns) {
        // Collect FK info
        if (col.is_foreign_key && col.referenced_table) {
          rawFKs.push({
            from_schema: schema.schema_name,
            from_table: table.table_name,
            from_column: col.column_name,
            to_schema: col.referenced_schema ?? schema.schema_name,
            to_table: col.referenced_table,
            to_column: col.referenced_column ?? '',
            constraint_name: col.fk_constraint ?? `fk_${table.table_name}_${col.column_name}`,
            from_is_pk: col.is_primary_key,
          });
        }

        // Filter columns by detail level
        if (level === 'minimal') continue;
        if (level === 'medium' && !col.is_primary_key && !col.is_foreign_key) continue;

        columns.push({
          column_name: col.column_name,
          data_type: col.data_type,
          is_primary_key: col.is_primary_key,
          is_foreign_key: col.is_foreign_key,
          is_nullable: col.is_nullable === 'YES',
        });
      }

      tables.push({
        schema_name: schema.schema_name,
        table_name: table.table_name,
        columns,
        is_phantom: false,
      });
    }

    schemas.push({ schema_name: schema.schema_name, tables });
  }

  // 2. Group raw FKs by constraint_name → ERRelation (composite FK support)
  const fkGroups = new Map<string, RawFK[]>();
  for (const fk of rawFKs) {
    const groupKey = `${fk.from_schema}.${fk.from_table}::${fk.constraint_name}`;
    const group = fkGroups.get(groupKey);
    if (group) {
      group.push(fk);
    } else {
      fkGroups.set(groupKey, [fk]);
    }
  }

  const relations: ERRelation[] = [];
  for (const [, group] of fkGroups) {
    const first = group[0];
    // Cardinality heuristic: if all FK columns are also PK → 1:1, else 1:N
    const allPK = group.every((fk) => fk.from_is_pk);
    relations.push({
      from_schema: first.from_schema,
      from_table: first.from_table,
      from_columns: group.map((fk) => fk.from_column),
      to_schema: first.to_schema,
      to_table: first.to_table,
      to_columns: group.map((fk) => fk.to_column),
      constraint_name: first.constraint_name,
      cardinality: allPK ? '1:1' : '1:N',
    });
  }

  // 3. Add phantom tables for cross-schema FK targets not in profile
  for (const rel of relations) {
    const targetKey = `${rel.to_schema}.${rel.to_table}`;
    if (!tableSet.has(targetKey)) {
      tableSet.add(targetKey);
      let targetSchema = schemas.find((s) => s.schema_name === rel.to_schema);
      if (!targetSchema) {
        targetSchema = { schema_name: rel.to_schema, tables: [] };
        schemas.push(targetSchema);
      }
      targetSchema.tables.push({
        schema_name: rel.to_schema,
        table_name: rel.to_table,
        columns: [],
        is_phantom: true,
      });
    }
  }

  return {
    db_alias: profile.db_alias,
    schemas,
    relations,
    detail_level: level,
  };
}

/**
 * Filter an ERModel to include only tables from selected schemas.
 * Cross-schema FK targets are represented as phantom (ghost) nodes
 * with no columns — just table name + dashed border in the diagram.
 * Relations are kept if at least one endpoint belongs to selected schemas.
 */
export function filterERModel(model: ERModel, schemaNames: string[]): ERModel {
  const selectedSet = new Set(schemaNames);
  const includedTables = new Set<string>(); // "schema.table"

  // 1. Collect tables that belong to selected schemas
  for (const schema of model.schemas) {
    if (!selectedSet.has(schema.schema_name)) continue;
    for (const table of schema.tables) {
      includedTables.add(`${schema.schema_name}.${table.table_name}`);
    }
  }

  // 2. Find cross-schema FK targets/sources that need phantom nodes
  const phantomNeeded = new Set<string>(); // "schema.table" keys needing ghost nodes
  const relevantRelations: ERRelation[] = [];

  for (const rel of model.relations) {
    const fromKey = `${rel.from_schema}.${rel.from_table}`;
    const toKey = `${rel.to_schema}.${rel.to_table}`;
    const fromIn = includedTables.has(fromKey);
    const toIn = includedTables.has(toKey);

    if (fromIn && toIn) {
      // Both endpoints in selected schemas — keep as is
      relevantRelations.push(rel);
    } else if (fromIn && !toIn) {
      // FK source in selected, target outside — phantom target
      relevantRelations.push(rel);
      phantomNeeded.add(toKey);
    } else if (!fromIn && toIn) {
      // FK source outside, target in selected — phantom source
      relevantRelations.push(rel);
      phantomNeeded.add(fromKey);
    }
    // Both outside → skip entirely
  }

  // 3. Build filtered schemas with real tables
  const filteredSchemas: ERSchema[] = [];
  for (const schema of model.schemas) {
    if (!selectedSet.has(schema.schema_name)) continue;
    const tables = schema.tables.filter(
      (t) => includedTables.has(`${schema.schema_name}.${t.table_name}`),
    );
    if (tables.length > 0) {
      filteredSchemas.push({ schema_name: schema.schema_name, tables });
    }
  }

  // 4. Add phantom nodes for cross-schema references
  for (const phantomKey of phantomNeeded) {
    const [pSchema, pTable] = phantomKey.split('.');
    if (!pSchema || !pTable) continue;

    let targetSchema = filteredSchemas.find((s) => s.schema_name === pSchema);
    if (!targetSchema) {
      targetSchema = { schema_name: pSchema, tables: [] };
      filteredSchemas.push(targetSchema);
    }
    // Only add if not already present
    if (!targetSchema.tables.some((t) => t.table_name === pTable)) {
      targetSchema.tables.push({
        schema_name: pSchema,
        table_name: pTable,
        columns: [],
        is_phantom: true,
      });
    }
  }

  return {
    db_alias: model.db_alias,
    schemas: filteredSchemas,
    relations: relevantRelations,
    detail_level: model.detail_level,
  };
}
