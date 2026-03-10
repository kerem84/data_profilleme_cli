/**
 * Interactive menu flows for the CLI.
 */
import * as p from '@clack/prompts';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { C, SYM, fmtDb, fmtSchema, fmtRows } from './theme.js';
import { loadConfig, ConfigError } from '../config/loader.js';
import { setupLogger, getLogger } from '../utils/logger.js';
import { createConnector } from '../connectors/factory.js';
import { Profiler } from '../profiler/profiler.js';
import { dictToProfile, annotateWithMapping, generateReports } from '../utils/profile-utils.js';
import type { AppConfig } from '../config/types.js';
import type { BaseConnector } from '../connectors/base-connector.js';
import type { TableInfo } from '../profiler/types.js';

/* ------------------------------------------------------------------ */
/*  Top-level entry                                                    */
/* ------------------------------------------------------------------ */

export async function runInteractive(configPath: string, pkgRoot: string): Promise<void> {
  p.intro(chalk.dim('Konfigurasyon yukleniyor...'));

  const config = loadAndValidateConfig(configPath);
  setupLogger(config.logLevel, config.logFile);

  const dbCount = Object.keys(config.databases).length;
  p.log.success(`${C.bold(config.projectName)} - ${dbCount} veritabani tanimli`);

  await showMainMenu(config, pkgRoot);
}

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

function loadAndValidateConfig(configPath: string): AppConfig {
  try {
    return loadConfig(configPath);
  } catch (e) {
    if (e instanceof ConfigError) {
      p.log.error(`Config hatasi: ${e.message}`);
      p.cancel('Konfigurasyon yuklenemedi.');
      process.exit(1);
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/*  Main menu loop                                                     */
/* ------------------------------------------------------------------ */

async function showMainMenu(config: AppConfig, pkgRoot: string): Promise<void> {
  // Event loop'a onceki prompt'un readline cleanup'ini tamamlamasi icin zaman ver
  await new Promise<void>((r) => setImmediate(r));

  const action = await p.select({
    message: 'Ne yapmak istiyorsunuz?',
    options: [
      { value: 'profile', label: 'Veritabani Profille', hint: 'Sema kesfi + profilleme + rapor' },
      { value: 'report', label: "JSON'dan Rapor Uret", hint: 'Mevcut profil JSON dosyasindan rapor' },
      { value: 'test', label: 'Baglanti Testi', hint: 'Veritabani baglantilarini test et' },
      { value: 'exit', label: 'Cikis' },
    ],
  });

  if (p.isCancel(action)) return showMainMenu(config, pkgRoot);

  switch (action) {
    case 'profile':
      await profileFlow(config, pkgRoot);
      break;
    case 'report':
      await reportOnlyFlow(config, pkgRoot);
      break;
    case 'test':
      await connectionTestFlow(config);
      break;
    case 'exit':
      p.outro('Gule gule!');
      process.exit(0);
  }

  return showMainMenu(config, pkgRoot);
}

/* ------------------------------------------------------------------ */
/*  Profile flow                                                       */
/* ------------------------------------------------------------------ */

interface SchemaInfo {
  name: string;
  tables: TableInfo[];
  totalRows: number;
}

async function profileFlow(config: AppConfig, pkgRoot: string): Promise<void> {
  const dbKeys = Object.keys(config.databases);

  // Step 1: Select database (single)
  let selectedDb: string;
  if (dbKeys.length === 1) {
    const db = config.databases[dbKeys[0]];
    p.log.info(`Tek veritabani: ${fmtDb(dbKeys[0], db.dbType, db.host, db.port, db.dbname)}`);
    selectedDb = dbKeys[0];
  } else {
    const chosen = await p.select({
      message: 'Profillenecek veritabanini secin:',
      options: dbKeys.map((key) => {
        const db = config.databases[key];
        return { value: key, label: fmtDb(key, db.dbType, db.host, db.port, db.dbname) };
      }),
    });
    if (p.isCancel(chosen)) return;
    selectedDb = chosen as string;
  }
  const selectedDbs = [selectedDb];

  // Step 2: Test connections
  const connectors = new Map<string, BaseConnector>();
  for (const key of selectedDbs) {
    const db = config.databases[key];
    const s = p.spinner();
    s.start(`Baglanti test ediliyor: ${key}`);

    const connector = createConnector(db);
    const ok = await connector.testConnection();
    if (ok) {
      s.stop(`${key} ${SYM.ok} baglanti basarili`);
      connectors.set(key, connector);
    } else {
      s.stop(`${key} ${SYM.fail} baglanti kurulamadi!`);
    }
  }

  if (connectors.size === 0) {
    p.log.error('Hicbir veritabanina baglanilmadi. Ana menuye donuluyor.');
    return;
  }

  // If some failed, ask to continue
  if (connectors.size < selectedDbs.length) {
    const failedKeys = selectedDbs.filter((k) => !connectors.has(k));
    p.log.warn(`Baglanti kurulamayan DB'ler: ${failedKeys.join(', ')}`);

    const cont = await p.confirm({
      message: `${connectors.size} basarili baglanti ile devam edilsin mi?`,
    });
    if (p.isCancel(cont) || !cont) {
      await destroyConnectors(connectors);
      return;
    }
  }

  // Step 3: Discover schemas
  const dbSchemas = new Map<string, SchemaInfo[]>();

  for (const [key, connector] of connectors) {
    const s = p.spinner();
    s.start(`Semalar kesfediliyor: ${key}`);

    const schemas = await connector.discoverSchemas();
    const schemaInfos: SchemaInfo[] = [];

    for (const schema of schemas) {
      const tables = await connector.discoverTables(schema);
      const totalRows = tables.reduce((sum, t) => sum + t.estimated_rows, 0);
      schemaInfos.push({ name: schema, tables, totalRows });
    }

    dbSchemas.set(key, schemaInfos);
    const totalTables = schemaInfos.reduce((sum, si) => sum + si.tables.length, 0);
    s.stop(`${key}: ${schemas.length} sema, ${totalTables} tablo kesfedildi`);
  }

  // Step 4: Select schemas per DB
  const selectedSchemas = new Map<string, string[]>();

  for (const [key, schemaInfos] of dbSchemas) {
    if (schemaInfos.length === 0) {
      p.log.warn(`${key}: Hic sema bulunamadi, atlaniyor.`);
      continue;
    }

    const chosen = await multiSelectWithAll(
      `[${C.bold(key)}] Profillenecek semalari secin:`,
      schemaInfos.map((si) => ({
        value: si.name,
        label: fmtSchema(si.name, si.tables.length),
        hint: `~${fmtRows(si.totalRows)} satir`,
      })),
    );

    if (chosen.length === 0) {
      await destroyConnectors(connectors);
      return;
    }

    selectedSchemas.set(key, chosen);
  }

  if (selectedSchemas.size === 0) {
    p.log.error('Hic sema secilmedi. Ana menuye donuluyor.');
    await destroyConnectors(connectors);
    return;
  }

  // Step 5: Select tables per schema
  const selectedTables = new Map<string, Map<string, string[]>>();

  for (const [key, schemas] of selectedSchemas) {
    const schemaInfos = dbSchemas.get(key) ?? [];
    const tableMap = new Map<string, string[]>();

    for (const schemaName of schemas) {
      const si = schemaInfos.find((s) => s.name === schemaName);
      if (!si || si.tables.length === 0) continue;

      const chosenTables = await multiSelectWithAll(
        `[${C.bold(key)} / ${schemaName}] Profillenecek tablolari secin:`,
        si.tables.map((t) => ({
          value: t.table_name,
          label: t.table_name,
          hint: `${t.table_type} ~${fmtRows(t.estimated_rows)} satir`,
        })),
      );

      if (chosenTables.length === 0) {
        await destroyConnectors(connectors);
        return;
      }

      tableMap.set(schemaName, chosenTables);
    }

    selectedTables.set(key, tableMap);
  }

  // Step 6: Report options
  const opts = await p.group({
    excel: () =>
      p.confirm({
        message: 'Excel rapor uretilsin mi?',
        initialValue: config.reporting.excelEnabled,
      }),
    html: () =>
      p.confirm({
        message: 'HTML rapor uretilsin mi?',
        initialValue: config.reporting.htmlEnabled,
      }),
    verbose: () =>
      p.confirm({
        message: 'Detayli log (verbose) aktif olsun mu?',
        initialValue: false,
      }),
  });

  if (p.isCancel(opts)) {
    await destroyConnectors(connectors);
    return;
  }

  if (opts.verbose) {
    setupLogger('debug', config.logFile);
  }

  // Step 7: Summary
  const summaryLines: string[] = [];
  let grandTotalTables = 0;

  for (const [key, schemas] of selectedSchemas) {
    const tableMap = selectedTables.get(key);
    const tableCount = tableMap
      ? [...tableMap.values()].reduce((sum, t) => sum + t.length, 0)
      : 0;
    grandTotalTables += tableCount;
    summaryLines.push(`  ${C.bold(key)}: ${schemas.length} sema, ${tableCount} tablo`);
  }

  const reportTypes: string[] = [];
  if (opts.excel) reportTypes.push('Excel');
  if (opts.html) reportTypes.push('HTML');

  p.note(
    [
      `Veritabanlari: ${selectedSchemas.size}`,
      ...summaryLines,
      `Toplam: ${grandTotalTables} tablo`,
      `Raporlar: ${reportTypes.join(' + ') || 'Yok'}`,
      `Cikti: ${config.outputDir}`,
    ].join('\n'),
    'Profilleme Ozeti',
  );

  const confirmStart = await p.confirm({
    message: 'Profillemeyi baslat?',
  });

  if (p.isCancel(confirmStart) || !confirmStart) {
    await destroyConnectors(connectors);
    return;
  }

  // Step 8: Execute profiling
  const logger = getLogger();
  const sqlDir = path.join(pkgRoot, 'sql');

  for (const [key, schemas] of selectedSchemas) {
    const connector = connectors.get(key);
    if (!connector) continue;

    // Apply schema filter
    config.databases[key].schemaFilter = schemas;

    p.log.step(`${C.bold(key)} profilleme basliyor...`);
    logger.info(`=== Profilleme basliyor: ${key} ===`);

    const profiler = new Profiler(config, key, connector, sqlDir);
    const tableMap = selectedTables.get(key);
    const profile = await profiler.profileDatabase(tableMap);

    // Mapping
    annotateWithMapping(config, profile);

    // Save JSON
    const jsonPath = profiler.saveIntermediate(profile, config.outputDir);
    p.log.info(`${key} JSON kaydedildi: ${chalk.dim(jsonPath)}`);

    // Reports
    generateReports(config, profile, !opts.excel, !opts.html, pkgRoot);

    const qualityPct = (profile.overall_quality_score * 100).toFixed(1);
    p.log.success(
      `${C.bold(key)} tamamlandi: ` +
      `${profile.total_schemas} sema, ${profile.total_tables} tablo, ` +
      `${profile.total_columns} kolon, kalite: %${qualityPct}`,
    );

    logger.info(
      `=== ${key} tamamlandi: ${profile.total_schemas} sema, ${profile.total_tables} tablo, ` +
      `${profile.total_columns} kolon, kalite: ${qualityPct}% ===`,
    );
  }

  await destroyConnectors(connectors);

  p.note(
    `Raporlar: ${config.outputDir}`,
    'Profilleme Tamamlandi',
  );
}

/* ------------------------------------------------------------------ */
/*  Report-only flow                                                   */
/* ------------------------------------------------------------------ */

async function reportOnlyFlow(config: AppConfig, pkgRoot: string): Promise<void> {
  // output dizinindeki JSON dosyalarini bul
  const outDir = path.resolve(config.outputDir);
  let jsonFiles: string[] = [];
  if (fs.existsSync(outDir)) {
    jsonFiles = fs.readdirSync(outDir)
      .filter((f) => f.startsWith('profil_') && f.endsWith('.json'))
      .sort()
      .reverse(); // en yeni en ustte
  }

  let jsonPaths: string[] = [];

  if (jsonFiles.length > 0) {
    const shown = jsonFiles.slice(0, 10);
    const chosen = await multiSelectWithAll(
      'Rapor uretilecek JSON dosyalari secin:',
      shown.map((f) => ({
        value: f,
        label: f.replace('profil_', '').replace('.json', ''),
      })),
    );
    if (chosen.length === 0) return;
    jsonPaths = chosen.map((f) => path.join(outDir, f));
  } else {
    p.log.warn(`${outDir} dizininde profil JSON bulunamadi.`);
    const manual = await promptJsonPath();
    if (p.isCancel(manual) || !manual) return;
    jsonPaths = [manual as string];
  }

  const reportOpts = await p.group({
    excel: () =>
      p.confirm({
        message: 'Excel rapor uretilsin mi?',
        initialValue: config.reporting.excelEnabled,
      }),
    html: () =>
      p.confirm({
        message: 'HTML rapor uretilsin mi?',
        initialValue: config.reporting.htmlEnabled,
      }),
  });

  if (p.isCancel(reportOpts)) return;

  for (const jsonPath of jsonPaths) {
    const fileName = path.basename(jsonPath);
    const s = p.spinner();
    s.start(`Rapor uretiliyor: ${fileName}`);

    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const profile = dictToProfile(data);
      annotateWithMapping(config, profile);
      generateReports(config, profile, !reportOpts.excel, !reportOpts.html, pkgRoot);
      s.stop(`${SYM.ok} ${fileName}`);
    } catch (e) {
      s.stop(`${SYM.fail} ${fileName}: ${e}`);
    }
  }

  p.note(`${jsonPaths.length} rapor uretildi\nCikti: ${config.outputDir}`, 'Tamamlandi');
}

/* ------------------------------------------------------------------ */
/*  Connection test flow                                               */
/* ------------------------------------------------------------------ */

async function connectionTestFlow(config: AppConfig): Promise<void> {
  const dbKeys = Object.keys(config.databases);

  const chosen = await multiSelectWithAll(
    'Test edilecek veritabanlarini secin:',
    dbKeys.map((key) => {
      const db = config.databases[key];
      return { value: key, label: fmtDb(key, db.dbType, db.host, db.port, db.dbname) };
    }),
  );

  if (chosen.length === 0) return;

  const results: string[] = [];

  for (const key of chosen) {
    const db = config.databases[key];
    const s = p.spinner();
    s.start(`Test ediliyor: ${key} (${db.host}:${db.port})`);

    const connector = createConnector(db);
    const ok = await connector.testConnection();

    if (ok) {
      const schemas = await connector.discoverSchemas();
      s.stop(`${key} ${SYM.ok} - ${schemas.length} sema bulundu`);
      results.push(`${SYM.ok} ${key}: ${schemas.length} sema`);
    } else {
      s.stop(`${key} ${SYM.fail} - baglanti kurulamadi`);
      results.push(`${SYM.fail} ${key}: baglanti hatasi`);
    }

    await (connector as any).destroy?.();
  }

  p.note(results.join('\n'), 'Baglanti Test Sonuclari');
}

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

/**
 * Multiselect with "Select All / Manual" pre-prompt.
 * Returns selected values or empty array on cancel.
 */
async function multiSelectWithAll(
  message: string,
  options: Array<{ value: string; label: string; hint?: string }>,
): Promise<string[]> {
  if (options.length === 1) {
    p.log.info(`Tek secenek: ${options[0].label}`);
    return [options[0].value];
  }

  const mode = await p.select({
    message: `${message} ${C.dim(`(${options.length} adet)`)}`,
    options: [
      { value: 'all' as const, label: `Tumunu Sec ${C.dim(`(${options.length})`)}` },
      { value: 'manual' as const, label: 'Manuel Sec' },
    ],
  });

  if (p.isCancel(mode)) return [];

  if (mode === 'all') {
    const allValues = options.map((o) => o.value);
    p.log.info(`${allValues.length} oge secildi.`);
    return allValues;
  }

  const chosen = await p.multiselect({
    message,
    options: options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
    required: true,
    initialValues: options.map((o) => o.value),
  });
  if (p.isCancel(chosen)) return [];
  return chosen as string[];
}

async function promptJsonPath(): Promise<string | symbol> {
  return p.text({
    message: 'Profil JSON dosya yolu:',
    validate: (val) => {
      if (!val) return undefined;
      if (!fs.existsSync(val)) return `Dosya bulunamadi: ${val}`;
      return undefined;
    },
  });
}

function formatFileDate(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return stat.mtime.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '';
  }
}

async function destroyConnectors(connectors: Map<string, BaseConnector>): Promise<void> {
  for (const connector of connectors.values()) {
    await (connector as any).destroy?.();
  }
}
