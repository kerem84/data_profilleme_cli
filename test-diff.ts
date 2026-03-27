/**
 * Diff report integration test.
 *
 * 1) Full profile (baseline)
 * 2) Modify data (insert rows, add NULL values)
 * 3) Full profile again (new)
 * 4) Run diff → verify changed/stable/new detection + report generation
 *
 * Usage:  npx tsx test-diff.ts [pg|mssql|oracle]
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import mssql from 'mssql';
import { loadConfig } from './src/config/loader.js';
import { Profiler } from './src/profiler/profiler.js';
import { createConnector } from './src/connectors/factory.js';
import { setupLogger } from './src/utils/logger.js';
import { dictToProfile } from './src/utils/profile-utils.js';
import { calculateDiff } from './src/profiler/diff.js';
import { DiffExcelReportGenerator } from './src/report/diff-excel-report.js';
import { DiffHtmlReportGenerator } from './src/report/diff-html-report.js';
import type { DatabaseConfig } from './src/config/types.js';

const CONFIG_PATH = 'config/config.mock.yaml';
const SQL_DIR = path.resolve('sql');
const OUTPUT_DIR = './output';

const requestedDb = process.argv[2];
const DB_MAP: Record<string, string> = { pg: 'mock_pg', mssql: 'mock_mssql', oracle: 'mock_oracle' };

async function main() {
  const config = loadConfig(CONFIG_PATH);
  setupLogger('WARN', './output/test-diff.log');

  const dbKeys = requestedDb ? [DB_MAP[requestedDb] ?? requestedDb] : Object.keys(config.databases);
  let passed = 0;
  let failed = 0;

  for (const dbKey of dbKeys) {
    const dbConfig = config.databases[dbKey];
    if (!dbConfig) { console.log(`⚠ ${dbKey} bulunamadi`); continue; }

    const connector = createConnector(dbConfig);
    if (!(await connector.testConnection())) { console.log(`⚠ ${dbKey}: baglanti yok`); continue; }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  DIFF TEST: ${dbKey} (${dbConfig.dbType})`);
    console.log(`${'='.repeat(60)}`);

    try {
      // 1. Baseline profile
      console.log('\n[1/4] Baseline profilleme...');
      const p1 = new Profiler(config, dbKey, connector, SQL_DIR);
      const baseline = await p1.profileDatabase();
      console.log(`      ${baseline.total_tables} tablo, kalite: ${(baseline.overall_quality_score * 100).toFixed(1)}%`);

      // 2. Create test table with deliberately poor quality (lots of NULLs)
      console.log('\n[2/4] Test tablosu olusturuluyor...');
      await createDiffTestTable(dbConfig);
      console.log('      __diff_test tablosu olusturuldu (3 satir, 2 NULL)');

      // 3. New profile
      console.log('\n[3/4] Yeni profilleme...');
      const p2 = new Profiler(config, dbKey, connector, SQL_DIR);
      const newProfile = await p2.profileDatabase();
      console.log(`      ${newProfile.total_tables} tablo, kalite: ${(newProfile.overall_quality_score * 100).toFixed(1)}%`);

      // 4. Calculate diff
      console.log('\n[4/4] Diff hesaplaniyor...');
      const diff = calculateDiff(baseline, newProfile);

      console.log(`      Iyilesen: ${diff.summary.tables_improved}, Kotulesen: ${diff.summary.tables_degraded}, Ayni: ${diff.summary.tables_stable}, Yeni: ${diff.summary.tables_new}, Silinen: ${diff.summary.tables_dropped}`);

      // Verify: __diff_test should be "new"
      let newTableFound = false;
      for (const schema of diff.schemas) {
        for (const table of schema.tables) {
          if (table.table_name.toLowerCase() === '__diff_test') {
            if (table.status === 'new') {
              console.log(`      ✓ __diff_test → "new" — PASSED`);
              newTableFound = true;
              passed++;
            } else {
              console.log(`      ✗ __diff_test → "${table.status}" (beklenen: new) — FAILED`);
              failed++;
            }
          }
        }
      }
      if (!newTableFound) {
        console.log(`      ✗ __diff_test bulunamadi — FAILED`);
        failed++;
      }

      // Verify: existing tables should be stable
      const stableCount = diff.summary.tables_stable;
      if (stableCount === baseline.total_tables) {
        console.log(`      ✓ ${stableCount} mevcut tablo "stable" — PASSED`);
        passed++;
      } else {
        console.log(`      ✗ Beklenen ${baseline.total_tables} stable, gercek: ${stableCount} — FAILED`);
        failed++;
      }

      // Generate reports
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/(\d{8})(\d{6})/, '$1_$2');

      const excelPath = path.join(OUTPUT_DIR, `diff_test_${dbKey}_${ts}.xlsx`);
      await new DiffExcelReportGenerator().generate(diff, excelPath);
      if (fs.existsSync(excelPath) && fs.statSync(excelPath).size > 0) {
        console.log(`      ✓ Excel diff rapor: ${excelPath} — PASSED`);
        passed++;
      } else {
        console.log(`      ✗ Excel diff rapor olusturulamadi — FAILED`);
        failed++;
      }

      const htmlPath = path.join(OUTPUT_DIR, `diff_test_${dbKey}_${ts}.html`);
      new DiffHtmlReportGenerator(path.resolve('templates'), true).generate(diff, htmlPath);
      if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).size > 0) {
        console.log(`      ✓ HTML diff rapor: ${htmlPath} — PASSED`);
        passed++;
      } else {
        console.log(`      ✗ HTML diff rapor olusturulamadi — FAILED`);
        failed++;
      }

      // Cleanup
      await dropDiffTestTable(dbConfig);

    } catch (e) {
      console.log(`      ✗ Hata: ${e}`);
      failed++;
    } finally {
      await (connector as any).destroy?.();
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  SONUC: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(60)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

async function createDiffTestTable(dbCfg: DatabaseConfig): Promise<void> {
  if (dbCfg.dbType === 'postgresql') {
    const client = new pg.Client({
      host: dbCfg.host, port: dbCfg.port,
      database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
    });
    await client.connect();
    try {
      await client.query(`DROP TABLE IF EXISTS public."__diff_test"`);
      await client.query(`CREATE TABLE public."__diff_test" (id INT PRIMARY KEY, name VARCHAR(50), score NUMERIC)`);
      await client.query(`INSERT INTO public."__diff_test" VALUES (1, 'test1', 85), (2, NULL, NULL), (3, 'test3', NULL)`);
    } finally { await client.end(); }
  } else if (dbCfg.dbType === 'mssql') {
    const pool = await mssql.connect({
      server: dbCfg.host, port: dbCfg.port,
      database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
      options: { encrypt: false, trustServerCertificate: true },
    });
    try {
      await pool.request().query(`IF OBJECT_ID('dbo.__diff_test','U') IS NOT NULL DROP TABLE dbo.__diff_test`);
      await pool.request().query(`CREATE TABLE dbo.__diff_test (id INT PRIMARY KEY, name NVARCHAR(50), score DECIMAL(10,2))`);
      await pool.request().query(`INSERT INTO dbo.__diff_test VALUES (1, N'test1', 85), (2, NULL, NULL), (3, N'test3', NULL)`);
    } finally { await pool.close(); }
  } else if (dbCfg.dbType === 'oracle') {
    const oracledb = (await import('oracledb')).default;
    const conn = await oracledb.getConnection({
      user: dbCfg.user, password: dbCfg.password,
      connectString: `${dbCfg.host}:${dbCfg.port}/${dbCfg.serviceName}`,
    });
    try {
      try { await conn.execute(`DROP TABLE "__diff_test" PURGE`); } catch { /* may not exist */ }
      await conn.execute(`CREATE TABLE "__diff_test" (id NUMBER PRIMARY KEY, name VARCHAR2(50), score NUMBER)`);
      await conn.execute(`INSERT INTO "__diff_test" VALUES (1, 'test1', 85)`);
      await conn.execute(`INSERT INTO "__diff_test" VALUES (2, NULL, NULL)`);
      await conn.execute(`INSERT INTO "__diff_test" VALUES (3, 'test3', NULL)`);
      await conn.commit();
    } finally { await conn.close(); }
  }
}

async function dropDiffTestTable(dbCfg: DatabaseConfig): Promise<void> {
  try {
    if (dbCfg.dbType === 'postgresql') {
      const client = new pg.Client({
        host: dbCfg.host, port: dbCfg.port,
        database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
      });
      await client.connect();
      try { await client.query(`DROP TABLE IF EXISTS public."__diff_test"`); }
      finally { await client.end(); }
    } else if (dbCfg.dbType === 'mssql') {
      const pool = await mssql.connect({
        server: dbCfg.host, port: dbCfg.port,
        database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
        options: { encrypt: false, trustServerCertificate: true },
      });
      try { await pool.request().query(`DROP TABLE IF EXISTS dbo.__diff_test`); }
      finally { await pool.close(); }
    } else if (dbCfg.dbType === 'oracle') {
      const oracledb = (await import('oracledb')).default;
      const conn = await oracledb.getConnection({
        user: dbCfg.user, password: dbCfg.password,
        connectString: `${dbCfg.host}:${dbCfg.port}/${dbCfg.serviceName}`,
      });
      try { await conn.execute(`DROP TABLE "__diff_test" PURGE`); await conn.commit(); }
      catch { /* ok */ }
      finally { await conn.close(); }
    }
  } catch { /* cleanup not critical */ }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
