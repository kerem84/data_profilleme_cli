/**
 * Shared helpers for profiling workflows (extracted from cli.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/types.js';
import type { DatabaseProfile } from '../profiler/types.js';
import { ExcelReportGenerator } from '../report/excel-report.js';
import { HtmlReportGenerator } from '../report/html-report.js';
import { MappingAnnotator } from '../mapping/annotator.js';

/** Convert raw JSON object to typed DatabaseProfile. */
export function dictToProfile(data: Record<string, unknown>): DatabaseProfile {
  const schemas = ((data.schemas as any[]) ?? []).map((s: any) => ({
    ...s,
    tables: (s.tables ?? []).map((t: any) => ({
      ...t,
      columns: (t.columns ?? []).map((c: any) => ({
        ...c,
        top_n_values: c.top_n_values ?? [],
        quality_flags: c.quality_flags ?? [],
        dwh_targets: c.dwh_targets ?? [],
      })),
      dwh_target_tables: t.dwh_target_tables ?? [],
    })),
  }));

  return {
    db_alias: String(data.db_alias ?? ''),
    db_name: String(data.db_name ?? ''),
    host: String(data.host ?? ''),
    profiled_at: String(data.profiled_at ?? ''),
    total_schemas: Number(data.total_schemas ?? 0),
    total_tables: Number(data.total_tables ?? 0),
    total_columns: Number(data.total_columns ?? 0),
    total_rows: Number(data.total_rows ?? 0),
    total_size_bytes: Number(data.total_size_bytes ?? 0),
    total_size_display: String(data.total_size_display ?? '0 B'),
    schemas,
    overall_quality_score: Number(data.overall_quality_score ?? 0),
  };
}

/** Apply DWH mapping annotations to a profile. */
export function annotateWithMapping(config: AppConfig, profile: DatabaseProfile): void {
  if (!config.mapping.enabled || !config.mapping.mappingFile) return;

  const annotator = new MappingAnnotator(config.mapping.mappingFile);
  for (const schema of profile.schemas) {
    for (const table of schema.tables) {
      const tableAnn = annotator.annotateTable(schema.schema_name, table.table_name);
      table.dwh_mapped = tableAnn.dwh_mapped;
      table.dwh_target_tables = tableAnn.dwh_target_tables;

      for (const col of table.columns) {
        const colAnn = annotator.annotateColumn(schema.schema_name, table.table_name, col.column_name);
        col.dwh_mapped = colAnn.dwh_mapped;
        col.dwh_targets = colAnn.dwh_targets;
      }
    }
  }
}

/** Generate Excel and/or HTML reports from a profile. */
export function generateReports(
  config: AppConfig,
  profile: DatabaseProfile,
  noExcel: boolean,
  noHtml: boolean,
  pkgRoot: string,
): void {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
    .replace(/(\d{8})(\d{6})/, '$1_$2');
  const outputDir = config.outputDir;
  fs.mkdirSync(outputDir, { recursive: true });

  if (!noExcel && config.reporting.excelEnabled) {
    const filename = config.reporting.excelFilenameTemplate
      .replace('{db_alias}', profile.db_alias)
      .replace('{timestamp}', timestamp);
    const excelPath = path.join(outputDir, filename);
    const gen = new ExcelReportGenerator(config.mapping.enabled);
    gen.generate(profile, excelPath);
  }

  if (!noHtml && config.reporting.htmlEnabled) {
    const filename = config.reporting.htmlFilenameTemplate
      .replace('{db_alias}', profile.db_alias)
      .replace('{timestamp}', timestamp);
    const htmlPath = path.join(outputDir, filename);
    const templateDir = path.join(pkgRoot, 'templates');
    const gen = new HtmlReportGenerator(templateDir, config.reporting.embedAssets);
    gen.generate(profile, htmlPath);
  }
}
