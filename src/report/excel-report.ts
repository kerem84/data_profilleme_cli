/**
 * Excel report generator (7 sheets).
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../utils/logger.js';
import { QualityScorer } from '../metrics/quality.js';
import type { DatabaseProfile, ColumnProfile, TableProfile } from '../profiler/types.js';
import type { SensitivityLevel } from '../metrics/sensitivity.js';
import { meetsThreshold } from '../metrics/sensitivity.js';

// Styles
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
const PK_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
const FK_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const GRADE_FILLS: Record<string, ExcelJS.Fill> = {
  A: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } },
  B: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } },
  C: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
  D: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } },
  F: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4CCCC' } },
  'N/A': { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } },
};
const SENSITIVITY_FILLS: Record<string, ExcelJS.Fill> = {
  high: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4CCCC' } },
  medium: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } },
  low: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
};
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

export class ExcelReportGenerator {
  constructor(
    private mappingEnabled: boolean = false,
    private sensitivityThreshold: SensitivityLevel = 'low',
  ) {}

  async generate(profile: DatabaseProfile, outputPath: string): Promise<string> {
    const logger = getLogger();
    const wb = new ExcelJS.Workbook();

    this.writeSummary(wb, profile);
    this.writeSchemaSummary(wb, profile);
    this.writeTableProfile(wb, profile);
    this.writeColumnProfile(wb, profile);
    this.writeTopValues(wb, profile);
    this.writePatternAnalysis(wb, profile);
    this.writeOutlierReport(wb, profile);
    this.writeSensitivityInventory(wb, profile);

    const dir = path.dirname(outputPath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    await wb.xlsx.writeFile(outputPath);
    logger.info(`Excel rapor olusturuldu: ${outputPath}`);
    return outputPath;
  }

  private applyHeader(ws: ExcelJS.Worksheet, headers: string[], rowNum: number = 1): void {
    const row = ws.getRow(rowNum);
    headers.forEach((h, i) => {
      const cell = row.getCell(i + 1);
      cell.value = h;
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    ws.views = [{ state: 'frozen', ySplit: rowNum }];
    ws.autoFilter = { from: { row: rowNum, column: 1 }, to: { row: rowNum, column: headers.length } };
  }

  private autoWidth(ws: ExcelJS.Worksheet, maxWidth: number = 40): void {
    ws.columns.forEach((col) => {
      let maxLen = 0;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length;
        if (len > maxLen) maxLen = len;
      });
      col.width = Math.min(maxLen + 3, maxWidth);
    });
  }

  private writeSummary(wb: ExcelJS.Workbook, profile: DatabaseProfile): void {
    const ws = wb.addWorksheet('Ozet');
    const data: [string, string | number][] = [
      ['Proje', 'DWH Kaynak Profilleme'],
      ['Veritabani', `${profile.db_alias} (${profile.db_name})`],
      ['Host', profile.host],
      ['Profilleme Tarihi', profile.profiled_at],
      ['Toplam Sema', profile.total_schemas],
      ['Toplam Tablo', profile.total_tables],
      ['Toplam Kolon', profile.total_columns],
      ['Toplam Satir', profile.total_rows.toLocaleString('tr-TR')],
      ['Toplam Boyut', profile.total_size_display || '-'],
      ['Genel Kalite Skoru', `${(profile.overall_quality_score * 100).toFixed(2)}%`],
    ];
    if (profile.incremental) {
      data.push(
        ['', ''],
        ['Incremental Mod', 'Evet'],
        ['Baseline Tarihi', profile.incremental.baseline_profiled_at],
        ['Degisen Tablolar', profile.incremental.tables_changed],
        ['Degismeyen Tablolar', profile.incremental.tables_unchanged],
        ['Yeni Tablolar', profile.incremental.tables_new],
      );
    }
    data.forEach(([label, value], i) => {
      const row = ws.getRow(i + 1);
      row.getCell(1).value = label;
      row.getCell(1).font = { bold: true };
      row.getCell(2).value = value;
    });
    ws.getColumn(1).width = 25;
    ws.getColumn(2).width = 40;
  }

  private writeSchemaSummary(wb: ExcelJS.Workbook, profile: DatabaseProfile): void {
    const ws = wb.addWorksheet('Schema Ozet');
    const headers = ['Sema', 'Tablo Sayisi', 'Toplam Satir', 'Toplam Boyut', 'Kalite Skoru', 'Kalite Notu'];
    this.applyHeader(ws, headers);

    profile.schemas.forEach((schema, i) => {
      const r = i + 2;
      ws.getRow(r).getCell(1).value = schema.schema_name;
      ws.getRow(r).getCell(2).value = schema.table_count;
      ws.getRow(r).getCell(3).value = schema.total_rows;
      ws.getRow(r).getCell(4).value = schema.total_size_display || '-';
      ws.getRow(r).getCell(5).value = Math.round(schema.schema_quality_score * 10000) / 10000;
      const grade = QualityScorer.grade(schema.schema_quality_score);
      const gradeCell = ws.getRow(r).getCell(6);
      gradeCell.value = grade;
      gradeCell.fill = GRADE_FILLS[grade] ?? GRADE_FILLS['F'];
      for (let c = 1; c <= 6; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
    });
    this.autoWidth(ws);
  }

  private writeTableProfile(wb: ExcelJS.Workbook, profile: DatabaseProfile): void {
    const ws = wb.addWorksheet('Tablo Profil');
    const hasIncremental = profile.incremental?.enabled;
    const headers = [
      'Sema', 'Tablo', 'Tip', 'Satir Sayisi', 'Tahmini', 'Boyut',
      'Kolon Sayisi', 'Sampling', 'Sample %',
      'Kalite Skoru', 'Kalite Notu', 'Sure (sn)',
      ...(hasIncremental ? ['Durum'] : []),
    ];
    this.applyHeader(ws, headers);

    const UNCHANGED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
    const CHANGED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
    const NEW_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8E6C9' } };

    const STATUS_LABELS: Record<string, string> = {
      changed: 'Degisti',
      unchanged: 'Degismedi',
      new: 'Yeni',
      full: 'Tam',
    };

    let r = 2;
    for (const schema of profile.schemas) {
      for (const table of schema.tables) {
        const colCount = hasIncremental ? 13 : 12;
        ws.getRow(r).getCell(1).value = table.schema_name;
        ws.getRow(r).getCell(2).value = table.table_name;
        ws.getRow(r).getCell(3).value = table.table_type;
        ws.getRow(r).getCell(4).value = table.row_count;
        ws.getRow(r).getCell(5).value = table.row_count_estimated ? 'Evet' : 'Hayir';
        ws.getRow(r).getCell(6).value = table.table_size_display || '-';
        ws.getRow(r).getCell(7).value = table.column_count;
        ws.getRow(r).getCell(8).value = table.sampled ? 'Evet' : 'Hayir';
        ws.getRow(r).getCell(9).value = table.sample_percent ?? '';
        ws.getRow(r).getCell(10).value = Math.round(table.table_quality_score * 10000) / 10000;
        const gradeCell = ws.getRow(r).getCell(11);
        gradeCell.value = table.table_quality_grade;
        gradeCell.fill = GRADE_FILLS[table.table_quality_grade] ?? GRADE_FILLS['F'];
        ws.getRow(r).getCell(12).value = table.profile_duration_sec;

        if (hasIncremental && table.incremental_status) {
          const statusCell = ws.getRow(r).getCell(13);
          statusCell.value = STATUS_LABELS[table.incremental_status] ?? table.incremental_status;

          // Color unchanged rows with dim background
          if (table.incremental_status === 'unchanged') {
            for (let c = 1; c <= colCount; c++) ws.getRow(r).getCell(c).fill = UNCHANGED_FILL;
          } else if (table.incremental_status === 'changed') {
            statusCell.fill = CHANGED_FILL;
          } else if (table.incremental_status === 'new') {
            statusCell.fill = NEW_FILL;
          }
        }

        for (let c = 1; c <= colCount; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
        r++;
      }
    }
    this.autoWidth(ws);
  }

  private writeColumnProfile(wb: ExcelJS.Workbook, profile: DatabaseProfile): void {
    const ws = wb.addWorksheet('Kolon Profil');
    const headers = [
      'Sema', 'Tablo', 'Kolon', 'Sira', 'Veri Tipi', 'Max Uzunluk',
      'Nullable', 'PK', 'FK',
      'NULL Sayisi', 'NULL Orani', 'Distinct Sayisi', 'Distinct Orani',
      'Min', 'Max',
      'Ortalama', 'Std Sapma', 'P25', 'P50', 'P75',
      'Kalite Skoru', 'Kalite Notu', 'Kalite Bayraklari',
    ];
    this.applyHeader(ws, headers);

    let r = 2;
    for (const schema of profile.schemas) {
      for (const table of schema.tables) {
        for (const col of table.columns) {
          ws.getRow(r).getCell(1).value = table.schema_name;
          ws.getRow(r).getCell(2).value = table.table_name;
          ws.getRow(r).getCell(3).value = col.column_name;
          ws.getRow(r).getCell(4).value = col.ordinal_position;
          ws.getRow(r).getCell(5).value = col.data_type;
          ws.getRow(r).getCell(6).value = col.max_length ?? '';
          ws.getRow(r).getCell(7).value = col.is_nullable;
          ws.getRow(r).getCell(8).value = col.is_primary_key ? 'PK' : '';
          ws.getRow(r).getCell(9).value = col.is_foreign_key ? 'FK' : '';
          ws.getRow(r).getCell(10).value = col.null_count;
          ws.getRow(r).getCell(11).value = col.null_ratio;
          ws.getRow(r).getCell(12).value = col.distinct_count;
          ws.getRow(r).getCell(13).value = col.distinct_ratio;
          ws.getRow(r).getCell(14).value = col.min_value ?? '';
          ws.getRow(r).getCell(15).value = col.max_value ?? '';
          ws.getRow(r).getCell(16).value = col.mean ?? '';
          ws.getRow(r).getCell(17).value = col.stddev ?? '';
          ws.getRow(r).getCell(18).value = col.percentiles?.p25 ?? '';
          ws.getRow(r).getCell(19).value = col.percentiles?.p50 ?? '';
          ws.getRow(r).getCell(20).value = col.percentiles?.p75 ?? '';
          ws.getRow(r).getCell(21).value = Math.round(col.quality_score * 10000) / 10000;
          const gradeCell = ws.getRow(r).getCell(22);
          gradeCell.value = col.quality_grade;
          gradeCell.fill = GRADE_FILLS[col.quality_grade] ?? GRADE_FILLS['F'];
          ws.getRow(r).getCell(23).value = col.quality_flags.join(', ');

          // PK/FK row highlighting
          if (col.is_primary_key) {
            for (let c = 1; c <= 23; c++) ws.getRow(r).getCell(c).fill = PK_FILL;
          } else if (col.is_foreign_key) {
            for (let c = 1; c <= 23; c++) ws.getRow(r).getCell(c).fill = FK_FILL;
          }
          for (let c = 1; c <= 23; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
          r++;
        }
      }
    }
    this.autoWidth(ws);
  }

  private writeTopValues(wb: ExcelJS.Workbook, profile: DatabaseProfile): void {
    const ws = wb.addWorksheet('Top Degerler');
    const headers = ['Sema', 'Tablo', 'Kolon', 'Deger', 'Frekans', 'Yuzde'];
    this.applyHeader(ws, headers);

    let r = 2;
    for (const schema of profile.schemas) {
      for (const table of schema.tables) {
        for (const col of table.columns) {
          for (const tv of col.top_n_values) {
            ws.getRow(r).getCell(1).value = table.schema_name;
            ws.getRow(r).getCell(2).value = table.table_name;
            ws.getRow(r).getCell(3).value = col.column_name;
            ws.getRow(r).getCell(4).value = String(tv.value ?? '').slice(0, 200);
            ws.getRow(r).getCell(5).value = tv.frequency;
            ws.getRow(r).getCell(6).value = tv.pct;
            for (let c = 1; c <= 6; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
            r++;
          }
        }
      }
    }
    this.autoWidth(ws);
  }

  private writePatternAnalysis(wb: ExcelJS.Workbook, profile: DatabaseProfile): void {
    const ws = wb.addWorksheet('Pattern Analiz');
    const headers = ['Sema', 'Tablo', 'Kolon', 'Pattern', 'Eslesme Orani', 'Dominant'];
    this.applyHeader(ws, headers);

    let r = 2;
    for (const schema of profile.schemas) {
      for (const table of schema.tables) {
        for (const col of table.columns) {
          if (!col.detected_patterns) continue;
          for (const [name, ratio] of Object.entries(col.detected_patterns)) {
            ws.getRow(r).getCell(1).value = table.schema_name;
            ws.getRow(r).getCell(2).value = table.table_name;
            ws.getRow(r).getCell(3).value = col.column_name;
            ws.getRow(r).getCell(4).value = name;
            ws.getRow(r).getCell(5).value = ratio;
            ws.getRow(r).getCell(6).value = name === col.dominant_pattern ? 'Evet' : '';
            for (let c = 1; c <= 6; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
            r++;
          }
        }
      }
    }
    this.autoWidth(ws);
  }

  private writeOutlierReport(wb: ExcelJS.Workbook, profile: DatabaseProfile): void {
    const ws = wb.addWorksheet('Outlier Rapor');
    const headers = [
      'Sema', 'Tablo', 'Kolon', 'Q1', 'Q3', 'IQR',
      'Alt Sinir', 'Ust Sinir', 'Outlier Sayisi', 'Outlier Orani',
    ];
    this.applyHeader(ws, headers);

    let r = 2;
    for (const schema of profile.schemas) {
      for (const table of schema.tables) {
        for (const col of table.columns) {
          if (!col.outlier_bounds) continue;
          const b = col.outlier_bounds;
          ws.getRow(r).getCell(1).value = table.schema_name;
          ws.getRow(r).getCell(2).value = table.table_name;
          ws.getRow(r).getCell(3).value = col.column_name;
          ws.getRow(r).getCell(4).value = b.q1;
          ws.getRow(r).getCell(5).value = b.q3;
          ws.getRow(r).getCell(6).value = b.iqr;
          ws.getRow(r).getCell(7).value = b.lower;
          ws.getRow(r).getCell(8).value = b.upper;
          ws.getRow(r).getCell(9).value = col.outlier_count;
          ws.getRow(r).getCell(10).value = col.outlier_ratio;
          for (let c = 1; c <= 10; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
          r++;
        }
      }
    }
    this.autoWidth(ws);
  }

  async generateSensitivityOnly(profile: DatabaseProfile, outputPath: string): Promise<string> {
    const logger = getLogger();
    const wb = new ExcelJS.Workbook();
    this.writeSensitivityInventory(wb, profile);

    const dir = path.dirname(outputPath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    await wb.xlsx.writeFile(outputPath);
    logger.info(`Sensitivity Excel rapor olusturuldu: ${outputPath}`);
    return outputPath;
  }

  private writeSensitivityInventory(wb: ExcelJS.Workbook, profile: DatabaseProfile): void {
    const ws = wb.addWorksheet('Hassas Veri Envanteri');
    const headers = [
      'Sema', 'Tablo', 'Kolon', 'Veri Tipi',
      'Kategori', 'Seviye', 'Heuristic Eslesmesi', 'Pattern Orani',
      'Maskeleme Onerisi',
    ];
    this.applyHeader(ws, headers);

    let r = 2;
    for (const schema of profile.schemas) {
      for (const table of schema.tables) {
        for (const col of table.columns) {
          if (!col.sensitivity || col.sensitivity.level === 'none') continue;
          if (!meetsThreshold(col.sensitivity.level, this.sensitivityThreshold)) continue;

          const s = col.sensitivity;
          ws.getRow(r).getCell(1).value = schema.schema_name;
          ws.getRow(r).getCell(2).value = table.table_name;
          ws.getRow(r).getCell(3).value = col.column_name;
          ws.getRow(r).getCell(4).value = col.data_type;
          ws.getRow(r).getCell(5).value = s.category;
          const levelCell = ws.getRow(r).getCell(6);
          levelCell.value = s.level;
          levelCell.fill = SENSITIVITY_FILLS[s.level] ?? {};
          ws.getRow(r).getCell(7).value = s.heuristic_match ? 'Evet' : 'Hayir';
          ws.getRow(r).getCell(8).value = s.pattern_match_ratio > 0
            ? Math.round(s.pattern_match_ratio * 10000) / 10000
            : '';
          ws.getRow(r).getCell(9).value = s.masking_suggestion;

          for (let c = 1; c <= 9; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
          r++;
        }
      }
    }
    this.autoWidth(ws);
  }
}
