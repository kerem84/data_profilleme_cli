/**
 * Renders an ERModel to Graphviz DOT format.
 */

import type { ERModel, ERTable, ERColumn, ERRelation, GraphvizEngine } from '../types.js';

/**
 * Determine best Graphviz engine based on graph size.
 */
export function selectEngine(model: ERModel): GraphvizEngine {
  let totalTables = 0;
  for (const s of model.schemas) totalTables += s.tables.length;
  const totalEdges = model.relations.length;

  if (totalTables > 200 || totalEdges > 400) return 'sfdp';
  return 'dot';
}

function escapeLabel(s: string): string {
  return s.replace(/[{}<>|"\\]/g, '\\$&');
}

function tableId(schema: string, table: string): string {
  return `"${schema}.${table}"`;
}

function renderColumnLine(col: ERColumn): string {
  const icons: string[] = [];
  if (col.is_primary_key) icons.push('PK');
  if (col.is_foreign_key) icons.push('FK');
  if (col.is_nullable) icons.push('?');
  const prefix = icons.length > 0 ? `[${icons.join(',')}] ` : '';
  return `${prefix}${escapeLabel(col.column_name)} : ${escapeLabel(col.data_type)}`;
}

function renderTableNode(table: ERTable, level: string): string {
  const id = tableId(table.schema_name, table.table_name);

  if (table.is_phantom) {
    return `  ${id} [label="${escapeLabel(table.table_name)}", style=dashed, color=gray, fontcolor=gray];`;
  }

  if (level === 'minimal' || table.columns.length === 0) {
    return `  ${id} [label="${escapeLabel(table.table_name)}", shape=box, style=filled, fillcolor="#e8f4fd"];`;
  }

  // Record-based node for medium/full
  const colLines = table.columns.map((c) => renderColumnLine(c) + '\\l').join('');
  const label = `{${escapeLabel(table.table_name)}|${colLines}}`;
  return `  ${id} [label="${label}", shape=Mrecord, style=filled, fillcolor="#e8f4fd"];`;
}

/**
 * Edge label strategy based on graph density.
 * - small graphs: show full constraint name on edge
 * - medium graphs: show abbreviated constraint name
 * - large graphs: hide label, use tooltip only
 */
function renderRelation(rel: ERRelation, totalTables: number, totalEdges: number): string {
  const from = tableId(rel.from_schema, rel.from_table);
  const to = tableId(rel.to_schema, rel.to_table);
  const fullName = rel.constraint_name;

  // Cardinality arrows
  // from=FK table (N side), to=PK table (1 side)
  // arrowtail=source (from), arrowhead=target (to)
  const arrowAttrs = rel.cardinality === '1:1'
    ? 'arrowhead=tee, arrowtail=tee'
    : 'arrowhead=tee, arrowtail=crow';

  // Tooltip always has full constraint name
  const tooltip = `tooltip="${escapeLabel(fullName)}"`;

  // Label strategy based on density
  let labelAttr: string;
  if (totalTables > 60 || totalEdges > 100) {
    // Dense: no visible label, tooltip only
    labelAttr = '';
  } else if (totalTables > 30 || totalEdges > 50) {
    // Medium: abbreviated label
    const short = abbreviateConstraint(fullName);
    labelAttr = `, label="${escapeLabel(short)}", fontsize=7, fontcolor="#999999"`;
  } else {
    // Small: full label but smaller font
    labelAttr = `, label="${escapeLabel(fullName)}", fontsize=7, fontcolor="#888888"`;
  }

  return `  ${from} -> ${to} [${arrowAttrs}, dir=both, ${tooltip}, color="#999999", penwidth=0.8${labelAttr}];`;
}

/**
 * Abbreviate a constraint name: "fk_koknedendenetimtreniliski_fk_trendenetimbaslik_fkey" → "fk_..baslik"
 */
function abbreviateConstraint(name: string): string {
  // Remove common prefixes/suffixes
  let s = name
    .replace(/^fk_/i, '')
    .replace(/_fkey$/i, '')
    .replace(/_fk$/i, '');

  if (s.length <= 16) return s;

  // Take last meaningful segment
  const parts = s.split('_').filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    return `..${last.substring(0, 12)}`;
  }
  return s.substring(0, 6) + '..' + s.substring(s.length - 6);
}

const SCHEMA_COLORS = [
  '#f0f7ff', '#f7f0ff', '#f0fff7', '#fff7f0', '#fff0f7', '#f0fff0', '#f7f7f0', '#f0f0f7',
];

export function renderDot(model: ERModel): string {
  const lines: string[] = [];

  // Count totals for adaptive rendering
  let totalTables = 0;
  for (const s of model.schemas) totalTables += s.tables.length;
  const totalEdges = model.relations.length;

  // Adapt layout to graph complexity
  let graphAttrs: string;
  if (totalTables > 200 || totalEdges > 400) {
    // Very large: sfdp engine
    graphAttrs = [
      'graph [fontname="Helvetica"',
      'overlap=prism, overlap_scaling=4',
      'splines=curved, sep="+25"',
      'outputorder=edgesfirst',
      '];',
    ].join(', ');
  } else if (totalTables > 80 || totalEdges > 150) {
    // Medium-large: dot with polyline
    graphAttrs = [
      'graph [rankdir=LR, fontname="Helvetica"',
      'splines=polyline',
      'nodesep=0.8, ranksep=1.5',
      'forcelabels=false',
      'outputorder=edgesfirst',
      '];',
    ].join(', ');
  } else if (totalTables > 30 || totalEdges > 50) {
    // Medium: dot with ortho, increased spacing
    graphAttrs = [
      'graph [rankdir=LR, fontname="Helvetica"',
      'splines=ortho',
      'nodesep=1.0, ranksep=2.0',
      'forcelabels=false',
      'outputorder=edgesfirst',
      '];',
    ].join(', ');
  } else {
    // Small: dot with ortho, comfortable spacing
    graphAttrs = [
      'graph [rankdir=LR, fontname="Helvetica"',
      'splines=ortho',
      'nodesep=1.0, ranksep=1.8',
      'outputorder=edgesfirst',
      '];',
    ].join(', ');
  }

  lines.push('digraph ER {');
  lines.push(`  ${graphAttrs}`);
  lines.push('  node [fontname="Helvetica", fontsize=10];');
  lines.push('  edge [fontname="Helvetica", fontsize=7];');
  lines.push('');

  // Render schemas as subgraph clusters
  model.schemas.forEach((schema, idx) => {
    const color = SCHEMA_COLORS[idx % SCHEMA_COLORS.length];
    lines.push(`  subgraph "cluster_${schema.schema_name}" {`);
    lines.push(`    label="${escapeLabel(schema.schema_name)}";`);
    lines.push(`    style=filled;`);
    lines.push(`    color="#cccccc";`);
    lines.push(`    fillcolor="${color}";`);
    lines.push(`    fontsize=12;`);
    lines.push(`    fontname="Helvetica-Bold";`);
    lines.push('');
    for (const table of schema.tables) {
      lines.push(renderTableNode(table, model.detail_level));
    }
    lines.push('  }');
    lines.push('');
  });

  // Render relations
  for (const rel of model.relations) {
    lines.push(renderRelation(rel, totalTables, totalEdges));
  }

  lines.push('}');
  return lines.join('\n');
}
