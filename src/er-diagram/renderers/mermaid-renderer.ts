/**
 * Renders an ERModel to Mermaid erDiagram syntax.
 */

import type { ERModel, ERTable, ERColumn, ERRelation } from '../types.js';

function escapeMermaidId(s: string): string {
  // Mermaid entity names: alphanumeric + underscore only
  return s.replace(/[^a-zA-Z0-9_]/g, '_');
}

function entityId(schema: string, table: string): string {
  return escapeMermaidId(`${schema}__${table}`);
}

function renderColumns(table: ERTable): string[] {
  if (table.columns.length === 0) return [];
  const lines: string[] = [];
  for (const col of table.columns) {
    const type = escapeMermaidId(col.data_type);
    const markers: string[] = [];
    if (col.is_primary_key) markers.push('PK');
    if (col.is_foreign_key) markers.push('FK');
    const markerStr = markers.length > 0 ? ` ${markers.join(',')}` : '';
    const comment = col.is_nullable ? '"nullable"' : '';
    lines.push(`    ${type} ${escapeMermaidId(col.column_name)}${markerStr} ${comment}`.trimEnd());
  }
  return lines;
}

function renderRelationLine(rel: ERRelation): string {
  const from = entityId(rel.from_schema, rel.from_table);
  const to = entityId(rel.to_schema, rel.to_table);
  const label = rel.constraint_name.replace(/"/g, "'");

  if (rel.cardinality === '1:1') {
    return `  ${from} ||--|| ${to} : "${label}"`;
  }
  // 1:N
  return `  ${from} }o--|| ${to} : "${label}"`;
}

export function renderMermaid(model: ERModel): string {
  const lines: string[] = [];
  lines.push('erDiagram');

  // Entity definitions
  for (const schema of model.schemas) {
    for (const table of schema.tables) {
      if (table.is_phantom) {
        lines.push(`  ${entityId(schema.schema_name, table.table_name)} {`);
        lines.push('  }');
        continue;
      }
      const id = entityId(schema.schema_name, table.table_name);
      const cols = renderColumns(table);
      if (cols.length > 0) {
        lines.push(`  ${id} {`);
        lines.push(...cols);
        lines.push('  }');
      } else {
        // Empty entity for minimal level
        lines.push(`  ${id} {`);
        lines.push('  }');
      }
    }
  }

  lines.push('');

  // Relationships
  for (const rel of model.relations) {
    lines.push(renderRelationLine(rel));
  }

  return lines.join('\n');
}
