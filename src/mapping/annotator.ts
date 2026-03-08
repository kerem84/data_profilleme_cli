/**
 * DWH mapping annotator.
 */
import fs from 'node:fs';
import { getLogger } from '../utils/logger.js';

interface MappingRecord {
  kaynak_sema?: string;
  kaynak_tablo?: string;
  kaynak_kolon?: string;
  hedef_tablo?: string;
  hedef_kolon?: string;
}

interface MappingTarget {
  target_table: string;
  target_column: string;
}

export class MappingAnnotator {
  private mappingData: MappingRecord[] = [];
  private index = new Map<string, MappingTarget[]>();
  private tableIndex = new Map<string, string[]>();

  constructor(mappingFile: string) {
    const logger = getLogger();
    try {
      const content = fs.readFileSync(mappingFile, 'utf-8');
      this.mappingData = JSON.parse(content);
      logger.info(`Mapping dosyasi yuklendi: ${this.mappingData.length} kayit`);
      this.buildIndex();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.warn(`Mapping dosyasi bulunamadi: ${mappingFile}`);
      } else {
        logger.error(`Mapping dosyasi okuma hatasi: ${e}`);
      }
    }
  }

  private buildIndex(): void {
    for (const record of this.mappingData) {
      const srcSchema = (record.kaynak_sema ?? '').toLowerCase().trim();
      const srcTable = (record.kaynak_tablo ?? '').toLowerCase().trim();
      const srcColumn = (record.kaynak_kolon ?? '').toLowerCase().trim();
      const tgtTable = record.hedef_tablo ?? '';
      const tgtColumn = record.hedef_kolon ?? '';

      if (!srcTable || !srcColumn) continue;

      // Column index
      const key = `${srcSchema}.${srcTable}.${srcColumn}`;
      if (!this.index.has(key)) this.index.set(key, []);
      this.index.get(key)!.push({ target_table: tgtTable, target_column: tgtColumn });

      // Table index
      const tblKey = `${srcSchema}.${srcTable}`;
      if (!this.tableIndex.has(tblKey)) this.tableIndex.set(tblKey, []);
      const targets = this.tableIndex.get(tblKey)!;
      if (!targets.includes(tgtTable)) targets.push(tgtTable);
    }
  }

  annotateColumn(schema: string, table: string, column: string): { dwh_mapped: boolean; dwh_targets: string[] } {
    const key = `${schema.toLowerCase()}.${table.toLowerCase()}.${column.toLowerCase()}`;
    const targets = this.index.get(key) ?? [];
    return {
      dwh_mapped: targets.length > 0,
      dwh_targets: targets.map((t) => `${t.target_table}.${t.target_column}`),
    };
  }

  annotateTable(schema: string, table: string): { dwh_mapped: boolean; dwh_target_tables: string[] } {
    const key = `${schema.toLowerCase()}.${table.toLowerCase()}`;
    const targets = this.tableIndex.get(key) ?? [];
    return {
      dwh_mapped: targets.length > 0,
      dwh_target_tables: targets,
    };
  }
}
