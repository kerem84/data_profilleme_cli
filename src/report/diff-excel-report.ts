/**
 * Excel diff report — colored comparison of two profiles.
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../utils/logger.js';
import type { DatabaseDiff, TableDiff, ColumnDiff, MetricDiff, DiffStatus } from '../profiler/diff.js';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
const IMPROVED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8E6C9' } };
const DEGRADED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCDD2' } };
const NEW_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBBDEFB' } };
const DROPPED_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' }, left: { style: 'thin' },
  bottom: { style: 'thin' }, right: { style: 'thin' },
};

const STATUS_FILLS: Record<DiffStatus, ExcelJS.Fill | null> = {
  improved: IMPROVED_FILL,
  degraded: DEGRADED_FILL,
  new: NEW_FILL,
  dropped: DROPPED_FILL,
  stable: null,
};

const STATUS_LABELS: Record<DiffStatus, string> = {
  improved: 'Iyilesti',
  degraded: 'Kotulesti',
  stable: 'Ayni',
  new: 'Yeni',
  dropped: 'Silindi',
};

function fmtDelta(m: MetricDiff, pct: boolean = false): string {
  if (m.delta == null) return '-';
  const prefix = m.delta > 0 ? '+' : '';
  if (pct) return `${prefix}${(m.delta * 100).toFixed(2)}pp`;
  return `${prefix}${m.delta}`;
}

function fmtPctChange(m: MetricDiff): string {
  if (m.pctChange == null) return '-';
  const prefix = m.pctChange > 0 ? '+' : '';
  return `${prefix}${m.pctChange.toFixed(1)}%`;
}

function fmtVal(v: number | null, pct: boolean = false): string {
  if (v == null) return '-';
  return pct ? `${(v * 100).toFixed(2)}%` : String(v);
}

export class DiffExcelReportGenerator {
  async generate(diff: DatabaseDiff, outputPath: string): Promise<string> {
    const logger = getLogger();
    const wb = new ExcelJS.Workbook();

    this.writeSummary(wb, diff);
    this.writeTableDiff(wb, diff);
    this.writeColumnDiff(wb, diff);

    const dir = path.dirname(outputPath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    await wb.xlsx.writeFile(outputPath);
    logger.info(`Diff Excel rapor olusturuldu: ${outputPath}`);
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

  private fillRow(ws: ExcelJS.Worksheet, row: number, colCount: number, status: DiffStatus): void {
    const fill = STATUS_FILLS[status];
    if (fill) {
      for (let c = 1; c <= colCount; c++) ws.getRow(row).getCell(c).fill = fill;
    }
  }

  private writeSummary(wb: ExcelJS.Workbook, diff: DatabaseDiff): void {
    const ws = wb.addWorksheet('Diff Ozet');
    const data: [string, string | number][] = [
      ['Eski Profil', `${diff.old_alias} (${diff.old_profiled_at})`],
      ['Yeni Profil', `${diff.new_alias} (${diff.new_profiled_at})`],
      ['', ''],
      ['Genel Kalite (Eski)', fmtVal(diff.overall_quality.old, true)],
      ['Genel Kalite (Yeni)', fmtVal(diff.overall_quality.new, true)],
      ['Kalite Degisimi', fmtDelta(diff.overall_quality, true)],
      ['', ''],
      ['Toplam Tablo (Eski)', diff.total_tables.old ?? '-'],
      ['Toplam Tablo (Yeni)', diff.total_tables.new ?? '-'],
      ['Toplam Satir (Eski)', diff.total_rows.old ?? '-'],
      ['Toplam Satir (Yeni)', diff.total_rows.new ?? '-'],
      ['', ''],
      ['Iyilesen Tablolar', diff.summary.tables_improved],
      ['Kotulesen Tablolar', diff.summary.tables_degraded],
      ['Degismeyen Tablolar', diff.summary.tables_stable],
      ['Yeni Tablolar', diff.summary.tables_new],
      ['Silinen Tablolar', diff.summary.tables_dropped],
      ['', ''],
      ['Iyilesen Kolonlar', diff.summary.columns_improved],
      ['Kotulesen Kolonlar', diff.summary.columns_degraded],
      ['Yeni Kolonlar', diff.summary.columns_new],
      ['Silinen Kolonlar', diff.summary.columns_dropped],
    ];

    data.forEach(([label, value], i) => {
      const row = ws.getRow(i + 1);
      row.getCell(1).value = label;
      row.getCell(1).font = { bold: true };
      row.getCell(2).value = value;
    });
    ws.getColumn(1).width = 30;
    ws.getColumn(2).width = 50;
  }

  private writeTableDiff(wb: ExcelJS.Workbook, diff: DatabaseDiff): void {
    const ws = wb.addWorksheet('Tablo Karsilastirma');
    const headers = [
      'Sema', 'Tablo', 'Durum',
      'Satir (Eski)', 'Satir (Yeni)', 'Satir Degisim',
      'Kolon (Eski)', 'Kolon (Yeni)',
      'Kalite (Eski)', 'Kalite (Yeni)', 'Kalite Delta',
      'Not (Eski)', 'Not (Yeni)',
    ];
    this.applyHeader(ws, headers);

    let r = 2;
    for (const schema of diff.schemas) {
      for (const table of schema.tables) {
        ws.getRow(r).getCell(1).value = table.schema_name;
        ws.getRow(r).getCell(2).value = table.table_name;
        ws.getRow(r).getCell(3).value = STATUS_LABELS[table.status];
        ws.getRow(r).getCell(4).value = table.row_count.old ?? '-';
        ws.getRow(r).getCell(5).value = table.row_count.new ?? '-';
        ws.getRow(r).getCell(6).value = fmtPctChange(table.row_count);
        ws.getRow(r).getCell(7).value = table.column_count.old ?? '-';
        ws.getRow(r).getCell(8).value = table.column_count.new ?? '-';
        ws.getRow(r).getCell(9).value = fmtVal(table.quality_score.old, true);
        ws.getRow(r).getCell(10).value = fmtVal(table.quality_score.new, true);
        ws.getRow(r).getCell(11).value = fmtDelta(table.quality_score, true);
        ws.getRow(r).getCell(12).value = table.old_grade;
        ws.getRow(r).getCell(13).value = table.new_grade;

        this.fillRow(ws, r, 13, table.status);
        for (let c = 1; c <= 13; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
        r++;
      }
    }
    this.autoWidth(ws);
  }

  private writeColumnDiff(wb: ExcelJS.Workbook, diff: DatabaseDiff): void {
    const ws = wb.addWorksheet('Kolon Karsilastirma');
    const headers = [
      'Sema', 'Tablo', 'Kolon', 'Tip', 'Durum',
      'NULL% (Eski)', 'NULL% (Yeni)', 'NULL Delta',
      'Distinct% (Eski)', 'Distinct% (Yeni)', 'Distinct Delta',
      'Kalite (Eski)', 'Kalite (Yeni)', 'Kalite Delta',
      'Not (Eski)', 'Not (Yeni)',
    ];
    this.applyHeader(ws, headers);

    let r = 2;
    for (const schema of diff.schemas) {
      for (const table of schema.tables) {
        for (const col of table.columns) {
          ws.getRow(r).getCell(1).value = table.schema_name;
          ws.getRow(r).getCell(2).value = table.table_name;
          ws.getRow(r).getCell(3).value = col.column_name;
          ws.getRow(r).getCell(4).value = col.data_type;
          ws.getRow(r).getCell(5).value = STATUS_LABELS[col.status];
          ws.getRow(r).getCell(6).value = fmtVal(col.null_ratio.old, true);
          ws.getRow(r).getCell(7).value = fmtVal(col.null_ratio.new, true);
          ws.getRow(r).getCell(8).value = fmtDelta(col.null_ratio, true);
          ws.getRow(r).getCell(9).value = fmtVal(col.distinct_ratio.old, true);
          ws.getRow(r).getCell(10).value = fmtVal(col.distinct_ratio.new, true);
          ws.getRow(r).getCell(11).value = fmtDelta(col.distinct_ratio, true);
          ws.getRow(r).getCell(12).value = fmtVal(col.quality_score.old, true);
          ws.getRow(r).getCell(13).value = fmtVal(col.quality_score.new, true);
          ws.getRow(r).getCell(14).value = fmtDelta(col.quality_score, true);
          ws.getRow(r).getCell(15).value = col.old_grade;
          ws.getRow(r).getCell(16).value = col.new_grade;

          this.fillRow(ws, r, 16, col.status);
          for (let c = 1; c <= 16; c++) ws.getRow(r).getCell(c).border = THIN_BORDER;
          r++;
        }
      }
    }
    this.autoWidth(ws);
  }
}
