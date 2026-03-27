/**
 * Incremental profiling integration test.
 *
 * 1) Full profile against each mock DB → saves baseline JSON
 * 2) Incremental run (no data change) → all tables "unchanged"
 * 3) INSERT rows into one table → incremental → that table "changed", rest "unchanged"
 *
 * Usage:  npx tsx test-incremental.ts [pg|mssql|oracle]
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import mssql from 'mssql';
import { loadConfig } from './src/config/loader.js';
import { Profiler } from './src/profiler/profiler.js';
import { createConnector } from './src/connectors/factory.js';
import { setupLogger, getLogger } from './src/utils/logger.js';
import { dictToProfile } from './src/utils/profile-utils.js';
import type { DatabaseConfig } from './src/config/types.js';
import type { DatabaseProfile } from './src/profiler/types.js';

const CONFIG_PATH = 'config/config.mock.yaml';
const SQL_DIR = path.resolve('sql');
const OUTPUT_DIR = './output';

// Which DBs to test (default: all reachable)
const requestedDb = process.argv[2]; // pg | mssql | oracle

const DB_MAP: Record<string, string> = {
  pg: 'mock_pg',
  mssql: 'mock_mssql',
  oracle: 'mock_oracle',
};

async function main() {
  const config = loadConfig(CONFIG_PATH);
  setupLogger('WARN', './output/test-incremental.log');
  const logger = getLogger();

  const dbKeys = requestedDb
    ? [DB_MAP[requestedDb] ?? requestedDb]
    : Object.keys(config.databases);

  let passed = 0;
  let failed = 0;

  for (const dbKey of dbKeys) {
    const dbConfig = config.databases[dbKey];
    if (!dbConfig) {
      console.log(`⚠ DB key "${dbKey}" bulunamadi, atlaniyor.`);
      continue;
    }

    const connector = createConnector(dbConfig);
    const ok = await connector.testConnection();
    if (!ok) {
      console.log(`⚠ ${dbKey}: baglanti kurulamadi, atlaniyor.`);
      continue;
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  TEST: ${dbKey} (${dbConfig.dbType})`);
    console.log(`${'='.repeat(60)}`);

    try {
      // ------- STEP 1: Full profiling -------
      console.log('\n[1/3] Tam profilleme...');
      const profiler1 = new Profiler(config, dbKey, connector, SQL_DIR);
      const t1 = performance.now();
      const fullProfile = await profiler1.profileDatabase();
      const d1 = ((performance.now() - t1) / 1000).toFixed(2);

      console.log(`      ${fullProfile.total_tables} tablo, ${fullProfile.total_columns} kolon → ${d1}s`);

      if (fullProfile.total_tables === 0) {
        console.log(`      ⚠ Hic tablo yok, test atlanıyor.`);
        continue;
      }

      // Save baseline JSON
      const baselinePath = path.join(OUTPUT_DIR, `test_baseline_${dbKey}.json`);
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(baselinePath, JSON.stringify(fullProfile, null, 2), 'utf-8');
      console.log(`      Baseline kaydedildi: ${baselinePath}`);

      // ------- STEP 2: Incremental (no change) → all unchanged -------
      console.log('\n[2/3] Incremental (degisiklik yok)...');
      const baseline = dictToProfile(JSON.parse(fs.readFileSync(baselinePath, 'utf-8')));
      const profiler2 = new Profiler(config, dbKey, connector, SQL_DIR);
      const t2 = performance.now();
      const incProfile = await profiler2.profileDatabase(undefined, baseline);
      const d2 = ((performance.now() - t2) / 1000).toFixed(2);

      console.log(`      ${incProfile.total_tables} tablo → ${d2}s`);

      // Verify incremental summary
      const inc = incProfile.incremental;
      if (!inc) {
        throw new Error('incremental ozet eksik');
      }
      console.log(`      Degisen: ${inc.tables_changed}, Degismeyen: ${inc.tables_unchanged}, Yeni: ${inc.tables_new}`);

      // All tables should be unchanged
      let allUnchanged = true;
      for (const schema of incProfile.schemas) {
        for (const table of schema.tables) {
          if (table.incremental_status !== 'unchanged') {
            console.log(`      ✗ ${schema.schema_name}.${table.table_name} → ${table.incremental_status} (beklenen: unchanged)`);
            allUnchanged = false;
          }
        }
      }

      if (allUnchanged && inc.tables_unchanged === incProfile.total_tables) {
        console.log(`      ✓ Tum tablolar "unchanged" — PASSED`);
        passed++;
      } else {
        console.log(`      ✗ Bazi tablolar degismis — FAILED`);
        failed++;
      }

      // Verify speedup
      const speedup = parseFloat(d1) / Math.max(parseFloat(d2), 0.01);
      console.log(`      Hiz: ${d1}s → ${d2}s (${speedup.toFixed(1)}x)`);

      // ------- STEP 3: Insert rows, then incremental → detect change -------
      console.log('\n[3/3] Veri degistir + incremental...');

      // Create a temporary test table, insert a row, then incremental should detect it as "new"
      // OR find an existing writable table and insert into it
      const targetSchema = incProfile.schemas[0];
      const schName = targetSchema.schema_name;

      // Create __incr_test table
      const testTblCreated = await createTestTable(dbConfig, schName);
      let tblName: string;

      if (testTblCreated) {
        tblName = '__incr_test';
        console.log(`      ${schName}.__incr_test tablosu olusturuldu.`);
      } else {
        // Fallback: find "employees" or first table
        const targetTable = targetSchema.tables.find((t) => t.table_name.toLowerCase() === 'employees')
          ?? targetSchema.tables[0];
        tblName = targetTable.table_name;
      }

      // Insert a row to change row count
      const insertOk = testTblCreated || await insertTestRow(dbConfig, schName, tblName);
      if (!insertOk) {
        console.log(`      ⚠ Insert yapilamadi, step 3 atlaniyor.`);
        continue;
      }
      console.log(`      ${schName}.${tblName} tablosuna 1 satir eklendi.`);

      const profiler3 = new Profiler(config, dbKey, connector, SQL_DIR);
      const t3 = performance.now();
      const incProfile2 = await profiler3.profileDatabase(undefined, baseline);
      const d3 = ((performance.now() - t3) / 1000).toFixed(2);

      const inc2 = incProfile2.incremental!;
      console.log(`      Degisen: ${inc2.tables_changed}, Degismeyen: ${inc2.tables_unchanged}, Yeni: ${inc2.tables_new} → ${d3}s`);

      // The modified/new table should be "changed" or "new"
      const expectedStatus = testTblCreated ? 'new' : 'changed';
      let modifiedFound = false;
      for (const schema of incProfile2.schemas) {
        for (const table of schema.tables) {
          if (table.table_name === tblName && schema.schema_name === schName) {
            if (table.incremental_status === expectedStatus) {
              console.log(`      ✓ ${schName}.${tblName} → "${expectedStatus}" — PASSED`);
              modifiedFound = true;
              passed++;
            } else {
              console.log(`      ✗ ${schName}.${tblName} → "${table.incremental_status}" (beklenen: ${expectedStatus}) — FAILED`);
              failed++;
            }
          }
        }
      }

      if (!modifiedFound) {
        console.log(`      ✗ Degistirilen/yeni tablo bulunamadi — FAILED`);
        failed++;
      }

      // Remaining tables from baseline should be unchanged
      const unchangedCount = inc2.tables_unchanged;
      const baselineTableCount = incProfile.total_tables;
      if (unchangedCount === baselineTableCount) {
        console.log(`      ✓ Onceki ${unchangedCount} tablo "unchanged" — PASSED`);
        passed++;
      } else {
        console.log(`      ✗ Beklenen ${baselineTableCount} unchanged, gercek: ${unchangedCount} — FAILED`);
        failed++;
      }

      // Cleanup
      if (testTblCreated) {
        await dropTestTable(dbConfig, schName);
      } else {
        await deleteTestRow(dbConfig, schName, tblName);
      }

    } catch (e) {
      console.log(`      ✗ Hata: ${e}`);
      failed++;
    } finally {
      await (connector as any).destroy?.();
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  SONUC: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(60)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

async function createTestTable(dbCfg: DatabaseConfig, schema: string): Promise<boolean> {
  try {
    if (dbCfg.dbType === 'postgresql') {
      const client = new pg.Client({
        host: dbCfg.host, port: dbCfg.port,
        database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
      });
      await client.connect();
      try {
        await client.query(`CREATE TABLE "${schema}"."__incr_test" (id INT PRIMARY KEY, name VARCHAR(50))`);
        await client.query(`INSERT INTO "${schema}"."__incr_test" VALUES (1, 'test')`);
      } finally { await client.end(); }
    } else if (dbCfg.dbType === 'mssql') {
      const pool = await mssql.connect({
        server: dbCfg.host, port: dbCfg.port,
        database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
        options: { encrypt: false, trustServerCertificate: true },
      });
      try {
        await pool.request().query(`CREATE TABLE [${schema}].[__incr_test] (id INT PRIMARY KEY, name NVARCHAR(50))`);
        await pool.request().query(`INSERT INTO [${schema}].[__incr_test] VALUES (1, N'test')`);
      } finally { await pool.close(); }
    } else if (dbCfg.dbType === 'oracle') {
      const oracledb = (await import('oracledb')).default;
      const conn = await oracledb.getConnection({
        user: dbCfg.user, password: dbCfg.password,
        connectString: `${dbCfg.host}:${dbCfg.port}/${dbCfg.serviceName}`,
      });
      try {
        await conn.execute(`CREATE TABLE "__incr_test" (id NUMBER PRIMARY KEY, name VARCHAR2(50))`);
        await conn.execute(`INSERT INTO "__incr_test" VALUES (1, 'test')`);
        await conn.commit();
      } finally { await conn.close(); }
    }
    return true;
  } catch (e) {
    console.log(`      ⚠ Test tablo olusturma hatasi: ${e}`);
    return false;
  }
}

async function dropTestTable(dbCfg: DatabaseConfig, schema: string): Promise<void> {
  try {
    if (dbCfg.dbType === 'postgresql') {
      const client = new pg.Client({
        host: dbCfg.host, port: dbCfg.port,
        database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
      });
      await client.connect();
      try { await client.query(`DROP TABLE IF EXISTS "${schema}"."__incr_test"`); }
      finally { await client.end(); }
    } else if (dbCfg.dbType === 'mssql') {
      const pool = await mssql.connect({
        server: dbCfg.host, port: dbCfg.port,
        database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
        options: { encrypt: false, trustServerCertificate: true },
      });
      try { await pool.request().query(`DROP TABLE IF EXISTS [${schema}].[__incr_test]`); }
      finally { await pool.close(); }
    } else if (dbCfg.dbType === 'oracle') {
      const oracledb = (await import('oracledb')).default;
      const conn = await oracledb.getConnection({
        user: dbCfg.user, password: dbCfg.password,
        connectString: `${dbCfg.host}:${dbCfg.port}/${dbCfg.serviceName}`,
      });
      try {
        await conn.execute(`DROP TABLE "__incr_test" PURGE`);
        await conn.commit();
      } catch { /* table may not exist */ }
      finally { await conn.close(); }
    }
  } catch { /* cleanup not critical */ }
}

async function insertTestRow(
  dbCfg: DatabaseConfig,
  schema: string,
  table: string,
): Promise<boolean> {
  try {
    if (dbCfg.dbType === 'postgresql') {
      const client = new pg.Client({
        host: dbCfg.host, port: dbCfg.port,
        database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
      });
      await client.connect();
      try {
        const meta = await client.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position LIMIT 1`, [schema, table],
        );
        if (meta.rows.length === 0) return false;
        const col = meta.rows[0].column_name;
        await client.query(`INSERT INTO "${schema}"."${table}" ("${col}") VALUES (99999)`);
      } finally { await client.end(); }
    } else if (dbCfg.dbType === 'mssql') {
      const pool = await mssql.connect({
        server: dbCfg.host, port: dbCfg.port,
        database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
        options: { encrypt: false, trustServerCertificate: true },
      });
      try {
        const meta = await pool.request()
          .input('s', mssql.NVarChar, schema)
          .input('t', mssql.NVarChar, table)
          .query(`SELECT TOP 1 COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_SCHEMA = @s AND TABLE_NAME = @t
                  ORDER BY ORDINAL_POSITION`);
        if (meta.recordset.length === 0) return false;
        const col = meta.recordset[0].COLUMN_NAME;
        await pool.request().query(`INSERT INTO [${schema}].[${table}] ([${col}]) VALUES (99999)`);
      } finally { await pool.close(); }
    } else if (dbCfg.dbType === 'oracle') {
      const oracledb = (await import('oracledb')).default;
      const conn = await oracledb.getConnection({
        user: dbCfg.user, password: dbCfg.password,
        connectString: `${dbCfg.host}:${dbCfg.port}/${dbCfg.serviceName}`,
      });
      try {
        const meta = await conn.execute(
          `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS
           WHERE OWNER = :1 AND TABLE_NAME = :2
           ORDER BY COLUMN_ID FETCH FIRST 1 ROWS ONLY`,
          [schema.toUpperCase(), table.toUpperCase()],
        );
        if (!meta.rows || meta.rows.length === 0) return false;
        const col = (meta.rows[0] as any[])[0];
        await conn.execute(`INSERT INTO "${schema}"."${table}" ("${col}") VALUES (99999)`);
        await conn.commit();
      } finally { await conn.close(); }
    }
    return true;
  } catch (e) {
    console.log(`      ⚠ Insert hatasi: ${e}`);
    return false;
  }
}

async function deleteTestRow(
  dbCfg: DatabaseConfig,
  schema: string,
  table: string,
): Promise<void> {
  try {
    if (dbCfg.dbType === 'postgresql') {
      const client = new pg.Client({
        host: dbCfg.host, port: dbCfg.port,
        database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
      });
      await client.connect();
      try {
        const meta = await client.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position LIMIT 1`, [schema, table],
        );
        if (meta.rows.length > 0) {
          const col = meta.rows[0].column_name;
          await client.query(`DELETE FROM "${schema}"."${table}" WHERE "${col}" = 99999`);
        }
      } finally { await client.end(); }
    } else if (dbCfg.dbType === 'mssql') {
      const pool = await mssql.connect({
        server: dbCfg.host, port: dbCfg.port,
        database: dbCfg.dbname, user: dbCfg.user, password: dbCfg.password,
        options: { encrypt: false, trustServerCertificate: true },
      });
      try {
        const meta = await pool.request()
          .input('s', mssql.NVarChar, schema)
          .input('t', mssql.NVarChar, table)
          .query(`SELECT TOP 1 COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_SCHEMA = @s AND TABLE_NAME = @t
                  ORDER BY ORDINAL_POSITION`);
        if (meta.recordset.length > 0) {
          const col = meta.recordset[0].COLUMN_NAME;
          await pool.request().query(`DELETE FROM [${schema}].[${table}] WHERE [${col}] = 99999`);
        }
      } finally { await pool.close(); }
    } else if (dbCfg.dbType === 'oracle') {
      const oracledb = (await import('oracledb')).default;
      const conn = await oracledb.getConnection({
        user: dbCfg.user, password: dbCfg.password,
        connectString: `${dbCfg.host}:${dbCfg.port}/${dbCfg.serviceName}`,
      });
      try {
        const meta = await conn.execute(
          `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS
           WHERE OWNER = :1 AND TABLE_NAME = :2
           ORDER BY COLUMN_ID FETCH FIRST 1 ROWS ONLY`,
          [schema.toUpperCase(), table.toUpperCase()],
        );
        if (meta.rows && meta.rows.length > 0) {
          const col = (meta.rows[0] as any[])[0];
          await conn.execute(`DELETE FROM "${schema}"."${table}" WHERE "${col}" = 99999`);
          await conn.commit();
        }
      } finally { await conn.close(); }
    }
  } catch {
    // cleanup failure is not critical
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
