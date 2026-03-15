/**
 * HTML diff report generator using Nunjucks.
 */
import fs from 'node:fs';
import path from 'node:path';
import nunjucks from 'nunjucks';
import { getLogger } from '../utils/logger.js';
import type { DatabaseDiff } from '../profiler/diff.js';

export class DiffHtmlReportGenerator {
  private env: nunjucks.Environment;

  constructor(
    private templateDir: string,
    private embedAssets: boolean = true,
  ) {
    this.env = nunjucks.configure(templateDir, { autoescape: true });
    this.env.addFilter('tojson', (val: unknown) => JSON.stringify(val));
    this.env.addFilter('numfmt', (val: number) => (val ?? 0).toLocaleString('tr-TR'));
    this.env.addFilter('pct1', (val: number) => ((val ?? 0) * 100).toFixed(1));
    this.env.addFilter('pct0', (val: number) => ((val ?? 0) * 100).toFixed(0));
    this.env.addFilter('pctval', (val: number | null) => val == null ? '-' : `${(val * 100).toFixed(2)}%`);
    this.env.addFilter('deltafmt', (val: number | null) => {
      if (val == null) return '-';
      const prefix = val > 0 ? '+' : '';
      return `${prefix}${(val * 100).toFixed(2)}pp`;
    });
    this.env.addFilter('pctchange', (val: number | null) => {
      if (val == null) return '-';
      const prefix = val > 0 ? '+' : '';
      return `${prefix}${val.toFixed(1)}%`;
    });
    this.env.addFilter('dateshort', (val: unknown) => String(val ?? '').slice(0, 19));
  }

  generate(diff: DatabaseDiff, outputPath: string): string {
    const logger = getLogger();

    let cssContent = '';
    if (this.embedAssets) {
      const cssPath = path.join(this.templateDir, 'assets', 'style.css');
      if (fs.existsSync(cssPath)) cssContent = fs.readFileSync(cssPath, 'utf-8');
    }

    // Build chart data: per-table quality old vs new
    const chartTables: Array<{ name: string; old: number; new: number }> = [];
    for (const schema of diff.schemas) {
      for (const table of schema.tables) {
        if (table.quality_score.old != null && table.quality_score.new != null) {
          chartTables.push({
            name: `${table.schema_name}.${table.table_name}`,
            old: Math.round((table.quality_score.old ?? 0) * 1000) / 10,
            new: Math.round((table.quality_score.new ?? 0) * 1000) / 10,
          });
        }
      }
    }

    const html = this.env.render('diff-report.html.j2', {
      diff,
      embed_assets: this.embedAssets,
      css_content: cssContent,
      chart_tables: chartTables,
    });

    const dir = path.dirname(outputPath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf-8');
    logger.info(`Diff HTML rapor olusturuldu: ${outputPath}`);
    return outputPath;
  }
}
