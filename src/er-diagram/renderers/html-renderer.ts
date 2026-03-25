/**
 * Renders an interactive HTML page embedding per-schema SVGs.
 * Schema dropdown switches between dedicated SVG containers.
 * "Tüm Şemalar" shows the combined full SVG.
 */

import fs from 'node:fs';
import path from 'node:path';
import nunjucks from 'nunjucks';
import type { ERModel } from '../types.js';

interface TableMeta {
  schema_name: string;
  table_name: string;
  columns: string[];
}

interface EdgeMeta {
  constraint: string;
  from: string;
  to: string;
  cardinality: string;
  columns: string;
}

function buildTableMeta(model: ERModel): Record<string, TableMeta> {
  const meta: Record<string, TableMeta> = {};
  for (const schema of model.schemas) {
    for (const table of schema.tables) {
      const key = `${schema.schema_name}.${table.table_name}`;
      meta[key] = {
        schema_name: schema.schema_name,
        table_name: table.table_name,
        columns: table.columns.map(
          (c) => `${c.is_primary_key ? 'PK ' : c.is_foreign_key ? 'FK ' : ''}${c.column_name}: ${c.data_type}`,
        ),
      };
    }
  }
  return meta;
}

function buildEdgeMeta(model: ERModel): Record<string, EdgeMeta> {
  const meta: Record<string, EdgeMeta> = {};
  for (const rel of model.relations) {
    const edgeKey = `"${rel.from_schema}.${rel.from_table}"->"${rel.to_schema}.${rel.to_table}"`;
    meta[edgeKey] = {
      constraint: rel.constraint_name,
      from: `${rel.from_schema}.${rel.from_table}`,
      to: `${rel.to_schema}.${rel.to_table}`,
      cardinality: rel.cardinality,
      columns: rel.from_columns.map((c, i) => `${c} → ${rel.to_columns[i] ?? '?'}`).join(', '),
    };
  }
  return meta;
}

/**
 * @param model        Full ERModel (for metadata)
 * @param fullSvg      Combined SVG content (all schemas)
 * @param schemaSvgMap Per-schema SVG content keyed by schema name
 * @param templateDir  Path to templates directory
 */
export function renderHtml(
  model: ERModel,
  fullSvg: string,
  schemaSvgMap: Record<string, string>,
  templateDir: string,
): string {
  const env = nunjucks.configure(templateDir, { autoescape: true });
  env.addFilter('tojson', (val: unknown) => JSON.stringify(val));

  // Read embedded assets
  const cssPath = path.join(templateDir, 'assets', 'er-diagram.css');
  const jsPath = path.join(templateDir, 'assets', 'er-diagram.js');
  const cssContent = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : '';
  const jsContent = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf-8') : '';

  const schemaNames = model.schemas.map((s) => s.schema_name);
  let tableCount = 0;
  for (const s of model.schemas) {
    tableCount += s.tables.length;
  }

  const tableMeta = buildTableMeta(model);
  const edgeMeta = buildEdgeMeta(model);

  // Build schema SVG entries for template
  const schemaSvgEntries = schemaNames
    .filter((name) => schemaSvgMap[name])
    .map((name) => ({ name, svg: schemaSvgMap[name] }));

  return env.render('er-diagram.html.j2', {
    db_alias: model.db_alias,
    detail_level: model.detail_level,
    schemas: schemaNames,
    table_count: tableCount,
    relation_count: model.relations.length,
    svg_content: fullSvg,
    schema_svgs: schemaSvgEntries,
    has_per_schema: schemaSvgEntries.length > 0,
    table_meta: tableMeta,
    edge_meta: edgeMeta,
    css_content: cssContent,
    js_content: jsContent,
  });
}
