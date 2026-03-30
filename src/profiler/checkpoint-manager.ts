import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../utils/logger.js';
import type { DatabaseProfile, CheckpointData } from './types.js';

export interface CheckpointInfo {
  completedCount: number;
  updatedAt: string;
}

export class CheckpointManager {
  private tmpDir: string;

  constructor(outputDir: string) {
    this.tmpDir = path.join(outputDir, '.tmp');
  }

  private filePath(dbAlias: string): string {
    return path.join(this.tmpDir, `checkpoint_${dbAlias}.json`);
  }

  exists(dbAlias: string): boolean {
    return fs.existsSync(this.filePath(dbAlias));
  }

  save(profile: DatabaseProfile, completedTables: Set<string>): void {
    const logger = getLogger();
    try {
      fs.mkdirSync(this.tmpDir, { recursive: true });

      const existing = this.load(profile.db_alias);

      const data: CheckpointData = {
        db_alias: profile.db_alias,
        started_at: existing?.started_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_tables: [...completedTables],
        partial_profile: profile,
      };

      fs.writeFileSync(this.filePath(profile.db_alias), JSON.stringify(data, null, 2), 'utf-8');
      logger.info(`[${profile.db_alias}] Checkpoint kaydedildi: ${completedTables.size} tablo`);
    } catch (e) {
      logger.error(`[${profile.db_alias}] Checkpoint yazma hatasi: ${e}`);
    }
  }

  load(dbAlias: string): CheckpointData | null {
    const logger = getLogger();
    const fp = this.filePath(dbAlias);

    if (!fs.existsSync(fp)) return null;

    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      return JSON.parse(raw) as CheckpointData;
    } catch (e) {
      logger.warn(`[${dbAlias}] Checkpoint okunamadi, sifirdan baslanacak: ${e}`);
      return null;
    }
  }

  clear(dbAlias: string): void {
    const logger = getLogger();
    const fp = this.filePath(dbAlias);

    try {
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
      }

      // Remove .tmp dir if empty
      if (fs.existsSync(this.tmpDir)) {
        const remaining = fs.readdirSync(this.tmpDir);
        if (remaining.length === 0) {
          fs.rmdirSync(this.tmpDir);
        }
      }

      logger.info(`[${dbAlias}] Checkpoint temizlendi.`);
    } catch (e) {
      logger.warn(`[${dbAlias}] Checkpoint temizleme hatasi: ${e}`);
    }
  }

  getInfo(dbAlias: string): CheckpointInfo | null {
    const data = this.load(dbAlias);
    if (!data) return null;

    return {
      completedCount: data.completed_tables.length,
      updatedAt: data.updated_at,
    };
  }
}
