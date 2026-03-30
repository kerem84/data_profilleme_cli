import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CheckpointManager } from '../checkpoint-manager.js';
import type { DatabaseProfile } from '../types.js';

function makeProfile(alias: string, tables: string[]): DatabaseProfile {
  return {
    db_alias: alias,
    db_name: 'testdb',
    host: 'localhost',
    profiled_at: new Date().toISOString(),
    total_schemas: 1,
    total_tables: tables.length,
    total_columns: 0,
    total_rows: 0,
    total_size_bytes: 0,
    total_size_display: '0 B',
    schemas: [{
      schema_name: 'public',
      table_count: tables.length,
      total_rows: 0,
      total_size_bytes: 0,
      total_size_display: '0 B',
      tables: tables.map((t) => ({
        schema_name: 'public',
        table_name: t,
        table_type: 'BASE TABLE',
        description: null,
        row_count: 100,
        estimated_rows: 100,
        row_count_estimated: false,
        column_count: 2,
        columns: [],
        profiled_at: new Date().toISOString(),
        profile_duration_sec: 0.5,
        sampled: false,
        sample_percent: null,
        table_size_bytes: 1024,
        table_size_display: '1.0 KB',
        table_quality_score: 0.8,
        table_quality_grade: 'B',
        dwh_mapped: false,
        dwh_target_tables: [],
      })),
      schema_quality_score: 0.8,
    }],
    overall_quality_score: 0.8,
  };
}

describe('CheckpointManager', () => {
  let tmpDir: string;
  let mgr: CheckpointManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-test-'));
    mgr = new CheckpointManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exists() returns false when no checkpoint', () => {
    expect(mgr.exists('mydb')).toBe(false);
  });

  it('save() then load() returns checkpoint data', () => {
    const profile = makeProfile('mydb', ['t1', 't2']);
    const completed = new Set(['public.t1', 'public.t2']);

    mgr.save(profile, completed);

    expect(mgr.exists('mydb')).toBe(true);

    const loaded = mgr.load('mydb');
    expect(loaded).not.toBeNull();
    expect(loaded!.db_alias).toBe('mydb');
    expect(loaded!.completed_tables).toEqual(['public.t1', 'public.t2']);
    expect(loaded!.partial_profile.total_tables).toBe(2);
  });

  it('clear() removes checkpoint file and empty .tmp dir', () => {
    const profile = makeProfile('mydb', ['t1']);
    mgr.save(profile, new Set(['public.t1']));

    expect(mgr.exists('mydb')).toBe(true);

    mgr.clear('mydb');

    expect(mgr.exists('mydb')).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.tmp'))).toBe(false);
  });

  it('load() returns null for corrupt JSON', () => {
    const tmpPath = path.join(tmpDir, '.tmp');
    fs.mkdirSync(tmpPath, { recursive: true });
    fs.writeFileSync(path.join(tmpPath, 'checkpoint_bad.json'), '{corrupt', 'utf-8');

    const loaded = mgr.load('bad');
    expect(loaded).toBeNull();
  });

  it('save() updates updated_at on subsequent saves', async () => {
    const profile = makeProfile('mydb', ['t1']);
    mgr.save(profile, new Set(['public.t1']));
    const first = mgr.load('mydb')!;

    await new Promise((r) => setTimeout(r, 50));

    mgr.save(profile, new Set(['public.t1', 'public.t2']));
    const second = mgr.load('mydb')!;

    expect(second.completed_tables.length).toBe(2);
    expect(new Date(second.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(first.updated_at).getTime(),
    );
  });

  it('getInfo() returns table count and timestamp', () => {
    const profile = makeProfile('mydb', ['t1', 't2', 't3']);
    mgr.save(profile, new Set(['public.t1', 'public.t2']));

    const info = mgr.getInfo('mydb');
    expect(info).not.toBeNull();
    expect(info!.completedCount).toBe(2);
    expect(info!.updatedAt).toBeTruthy();
  });
});
