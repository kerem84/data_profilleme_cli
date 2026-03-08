/**
 * Interactive HTML report generator using Nunjucks.
 */
import fs from 'node:fs';
import path from 'node:path';
import nunjucks from 'nunjucks';
import { getLogger } from '../utils/logger.js';
import { QualityScorer } from '../metrics/quality.js';
import type { DatabaseProfile } from '../profiler/types.js';

export class HtmlReportGenerator {
  private env: nunjucks.Environment;

  constructor(
    private templateDir: string,
    private embedAssets: boolean = true,
  ) {
    this.env = nunjucks.configure(templateDir, { autoescape: true });
    // Custom filters (replacing Python Jinja2 format syntax)
    this.env.addFilter('tojson', (val: unknown) => JSON.stringify(val));
    this.env.addFilter('numfmt', (val: number) => (val ?? 0).toLocaleString('tr-TR'));
    this.env.addFilter('pct1', (val: number) => ((val ?? 0) * 100).toFixed(1));
    this.env.addFilter('pct0', (val: number) => ((val ?? 0) * 100).toFixed(0));
    this.env.addFilter('trunc', (val: unknown, len: number) => {
      const s = String(val ?? '');
      return s.length > len ? s.slice(0, len) + '...' : s;
    });
    this.env.addFilter('dateshort', (val: unknown) => String(val ?? '').slice(0, 19));
  }

  generate(profile: DatabaseProfile, outputPath: string): string {
    const logger = getLogger();

    // Asset contents
    let cssContent = '';
    let jsContent = '';
    if (this.embedAssets) {
      const cssPath = path.join(this.templateDir, 'assets', 'style.css');
      const jsPath = path.join(this.templateDir, 'assets', 'charts.js');
      if (fs.existsSync(cssPath)) cssContent = fs.readFileSync(cssPath, 'utf-8');
      if (fs.existsSync(jsPath)) jsContent = fs.readFileSync(jsPath, 'utf-8');
    }

    // Grade distribution
    const gradeDist = this.calcGradeDistribution(profile);
    const topTables = this.getTopTables(profile, 10);
    const overallGrade = QualityScorer.grade(profile.overall_quality_score);

    const html = this.env.render('report.html.j2', {
      profile,
      embed_assets: this.embedAssets,
      css_content: cssContent,
      js_content: jsContent,
      grade_distribution: gradeDist,
      top_tables: topTables,
      overall_grade: overallGrade,
      grade_fn: QualityScorer.grade,
    });

    const dir = path.dirname(outputPath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf-8');
    logger.info(`HTML rapor olusturuldu: ${outputPath}`);
    return outputPath;
  }

  private calcGradeDistribution(profile: DatabaseProfile): Record<string, number> {
    const counter: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const schema of profile.schemas) {
      for (const table of schema.tables) {
        if (table.table_quality_grade !== 'N/A' && counter[table.table_quality_grade] !== undefined) {
          counter[table.table_quality_grade]++;
        }
      }
    }
    return counter;
  }

  private getTopTables(profile: DatabaseProfile, limit: number): Array<{ name: string; rows: number }> {
    const allTables: Array<{ name: string; rows: number }> = [];
    for (const schema of profile.schemas) {
      for (const table of schema.tables) {
        allTables.push({ name: `${table.schema_name}.${table.table_name}`, rows: table.row_count });
      }
    }
    allTables.sort((a, b) => b.rows - a.rows);
    return allTables.slice(0, limit);
  }
}
