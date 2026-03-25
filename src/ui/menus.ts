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
import { calculateDiff } from '../profiler/diff.js';
import { DiffExcelReportGenerator } from '../report/diff-excel-report.js';
import { DiffHtmlReportGenerator } from '../report/diff-html-report.js';
import type { AppConfig } from '../config/types.js';
import type { BaseConnector } from '../connectors/base-connector.js';
import type { DatabaseProfile, TableInfo } from '../profiler/types.js';
import type { DetailLevel, EROutputFormat } from '../er-diagram/types.js';
import { generateERDiagram } from '../er-diagram/er-generator.js';
import { checkGraphviz } from '../er-diagram/graphviz.js';

/* ------------------------------------------------------------------ */
/*  Top-level entry                                                    */
/* ------------------------------------------------------------------ */

export async function runInteractive(configPath: string, pkgRoot: string): Promise<void> {
  installStdinGuard();
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
/*  stdin guard – Windows TTY donma fix'i                              */
/*                                                                     */
/*  Windows'ta @clack/prompts her prompt kapanisinda stdin'i pause      */
/*  edip raw mode'dan cikariyor. Sonraki prompt resume ederek           */
/*  uv_read_start cagiriyor. N tekrardan sonra libuv'un Windows TTY    */
/*  handle'i uv_read_start'i sessizce yutup stdin'i donduruyor.        */
/*                                                                     */
/*  Cozum: stdin'i bir kez raw+flowing yap, pause/setRawMode(false)/   */
/*  resume cagrilarini engelle. Boylece uv_read_stop/uv_read_start     */
/*  dongusu hic calismaz.                                              */
/* ------------------------------------------------------------------ */

let _guardInstalled = false;
function installStdinGuard(): void {
  if (_guardInstalled) return;
  _guardInstalled = true;
  const stdin = process.stdin as any;

  const origResume = stdin.resume.bind(stdin);
  const origSetRaw = stdin.setRawMode?.bind(stdin);

  // stdin'i raw mode'da baslat ve flowing yap
  if (origSetRaw) origSetRaw(true);
  origResume();

  // pause() → no-op
  stdin.pause = function () { return this; };

  // setRawMode(false) → no-op
  if (origSetRaw) {
    stdin.setRawMode = function (mode: boolean) {
      if (!mode) return this;
      return origSetRaw(true);
    };
  }

  // resume() → no-op (zaten flowing)
  stdin.resume = function () { return this; };
}

async function resetStdin(): Promise<void> {
  // Zombie keypress handler'lari temizle.
  // stdin hep raw+flowing kaliyor (guard sayesinde).
  process.stdin.removeAllListeners('keypress');
  await new Promise<void>((r) => setTimeout(r, 10));
  process.stdin.removeAllListeners('keypress');
}

/* ------------------------------------------------------------------ */
/*  Main menu – while loop (recursive degil, stack birikmesin)         */
/* ------------------------------------------------------------------ */

async function showMainMenu(config: AppConfig, pkgRoot: string): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await resetStdin();

    const action = await p.select({
      message: 'Ne yapmak istiyorsunuz?',
      options: [
        { value: 'profile', label: 'Veritabani Profille', hint: 'Sema kesfi + profilleme + rapor' },
        { value: 'report', label: "JSON'dan Rapor Uret", hint: 'Mevcut profil JSON dosyasindan rapor' },
        { value: 'diff', label: 'Profil Karsilastir', hint: 'Iki profil JSON arasindaki farklari goster' },
        { value: 'er', label: 'ER Diyagrami Olustur', hint: 'Profil JSON\'dan ER diyagrami uret' },
        { value: 'test', label: 'Baglanti Testi', hint: 'Veritabani baglantilarini test et' },
        { value: 'exit', label: 'Cikis' },
      ],
    });
    if (p.isCancel(action)) continue;

    switch (action) {
      case 'profile':
        await profileFlow(config, pkgRoot);
        break;
      case 'report':
        await reportOnlyFlow(config, pkgRoot);
        break;
      case 'diff':
        await diffFlow(config, pkgRoot);
        break;
      case 'er':
        await erDiagramFlow(config, pkgRoot);
        break;
      case 'test':
        await connectionTestFlow(config);
        break;
      case 'exit':
        p.outro('Gule gule!');
        process.exit(0);
    }
  }
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
    await resetStdin();
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

    await resetStdin();
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
  await resetStdin();
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

  // Step 6b: Incremental mode
  let baselineProfile: DatabaseProfile | undefined;

  const outDir = path.resolve(config.outputDir);
  let baselineFiles: string[] = [];
  if (fs.existsSync(outDir)) {
    // Filter for JSON files matching the selected DB
    baselineFiles = fs.readdirSync(outDir)
      .filter((f) => f.startsWith('profil_') && f.endsWith('.json') &&
        selectedDbs.some((db) => f.includes(db)))
      .sort()
      .reverse();
  }

  if (baselineFiles.length > 0) {
    await resetStdin();
    const useIncremental = await p.confirm({
      message: `Incremental mod? (sadece degisen tablolari yeniden profille)`,
      initialValue: false,
    });

    if (!p.isCancel(useIncremental) && useIncremental) {
      await resetStdin();
      const chosen = await p.select({
        message: 'Karsilastirilacak baseline JSON secin:',
        options: baselineFiles.slice(0, 10).map((f) => ({
          value: f,
          label: f.replace('profil_', '').replace('.json', ''),
        })),
      });

      if (!p.isCancel(chosen)) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(outDir, chosen as string), 'utf-8'));
          baselineProfile = dictToProfile(data);
          p.log.info(
            `Baseline yuklendi: ${(chosen as string).replace('.json', '')} — ` +
            `${baselineProfile.total_tables} tablo, ${new Date(baselineProfile.profiled_at).toLocaleString('tr-TR')}`,
          );
        } catch (e) {
          p.log.warn(`Baseline JSON okunamadi: ${e}`);
        }
      }
    }
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

  const modeLine = baselineProfile
    ? `Mod: Incremental (baseline: ${new Date(baselineProfile.profiled_at).toLocaleString('tr-TR')})`
    : `Mod: Tam profilleme`;

  p.note(
    [
      `Veritabanlari: ${selectedSchemas.size}`,
      ...summaryLines,
      `Toplam: ${grandTotalTables} tablo`,
      modeLine,
      `Raporlar: ${reportTypes.join(' + ') || 'Yok'}`,
      `Cikti: ${config.outputDir}`,
    ].join('\n'),
    'Profilleme Ozeti',
  );

  await resetStdin();
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
    const profile = await profiler.profileDatabase(tableMap, baselineProfile);

    // Mapping
    annotateWithMapping(config, profile);

    // Save JSON
    const jsonPath = profiler.saveIntermediate(profile, config.outputDir);
    p.log.info(`${key} JSON kaydedildi: ${chalk.dim(jsonPath)}`);

    // Reports
    generateReports(config, profile, !opts.excel, !opts.html, pkgRoot);

    const qualityPct = (profile.overall_quality_score * 100).toFixed(1);
    const incrementalInfo = profile.incremental
      ? ` (${profile.incremental.tables_changed} degisen, ${profile.incremental.tables_unchanged} degismeyen, ${profile.incremental.tables_new} yeni)`
      : '';
    p.log.success(
      `${C.bold(key)} tamamlandi: ` +
      `${profile.total_schemas} sema, ${profile.total_tables} tablo, ` +
      `${profile.total_columns} kolon, kalite: %${qualityPct}${incrementalInfo}`,
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
    await resetStdin();
    const manual = await promptJsonPath();
    if (p.isCancel(manual) || !manual) return;
    jsonPaths = [manual as string];
  }

  await resetStdin();
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
/*  Diff flow                                                          */
/* ------------------------------------------------------------------ */

async function diffFlow(config: AppConfig, pkgRoot: string): Promise<void> {
  const outDir = path.resolve(config.outputDir);
  let jsonFiles: string[] = [];
  if (fs.existsSync(outDir)) {
    jsonFiles = fs.readdirSync(outDir)
      .filter((f) => f.startsWith('profil_') && f.endsWith('.json'))
      .sort()
      .reverse();
  }

  if (jsonFiles.length < 2) {
    p.log.warn('Karsilastirma icin en az 2 profil JSON dosyasi gerekli.');
    return;
  }

  const shown = jsonFiles.slice(0, 15);

  // Select old profile
  await resetStdin();
  const oldChosen = await p.select({
    message: 'Eski (baseline) profil secin:',
    options: shown.map((f) => ({
      value: f,
      label: f.replace('profil_', '').replace('.json', ''),
    })),
  });
  if (p.isCancel(oldChosen)) return;

  // Select new profile (exclude old selection)
  await resetStdin();
  const newOptions = shown.filter((f) => f !== oldChosen);
  const newChosen = await p.select({
    message: 'Yeni profil secin:',
    options: newOptions.map((f) => ({
      value: f,
      label: f.replace('profil_', '').replace('.json', ''),
    })),
  });
  if (p.isCancel(newChosen)) return;

  // Report options
  await resetStdin();
  const reportOpts = await p.group({
    excel: () => p.confirm({ message: 'Excel diff rapor uretilsin mi?', initialValue: true }),
    html: () => p.confirm({ message: 'HTML diff rapor uretilsin mi?', initialValue: true }),
  });
  if (p.isCancel(reportOpts)) return;

  const s = p.spinner();
  s.start('Profiller karsilastiriliyor...');

  try {
    const oldData = JSON.parse(fs.readFileSync(path.join(outDir, oldChosen as string), 'utf-8'));
    const newData = JSON.parse(fs.readFileSync(path.join(outDir, newChosen as string), 'utf-8'));
    const oldProfile = dictToProfile(oldData);
    const newProfile = dictToProfile(newData);

    const diff = calculateDiff(oldProfile, newProfile);

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/(\d{8})(\d{6})/, '$1_$2');
    const reports: string[] = [];

    if (reportOpts.excel) {
      const excelPath = path.join(outDir, `diff_${diff.new_alias}_${timestamp}.xlsx`);
      const gen = new DiffExcelReportGenerator();
      await gen.generate(diff, excelPath);
      reports.push(`Excel: ${excelPath}`);
    }

    if (reportOpts.html) {
      const htmlPath = path.join(outDir, `diff_${diff.new_alias}_${timestamp}.html`);
      const templateDir = path.join(pkgRoot, 'templates');
      const gen = new DiffHtmlReportGenerator(templateDir, true);
      gen.generate(diff, htmlPath);
      reports.push(`HTML:  ${htmlPath}`);
    }

    s.stop(`${SYM.ok} Karsilastirma tamamlandi`);

    p.note(
      [
        `Eski: ${oldChosen}`,
        `Yeni: ${newChosen}`,
        '',
        `Iyilesen: ${diff.summary.tables_improved} tablo`,
        `Kotulesen: ${diff.summary.tables_degraded} tablo`,
        `Degismeyen: ${diff.summary.tables_stable} tablo`,
        `Yeni: ${diff.summary.tables_new} tablo`,
        `Silinen: ${diff.summary.tables_dropped} tablo`,
        '',
        ...reports,
      ].join('\n'),
      'Diff Sonucu',
    );
  } catch (e) {
    s.stop(`${SYM.fail} Hata: ${e}`);
  }
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
/*  ER Diagram flow                                                    */
/* ------------------------------------------------------------------ */

async function erDiagramFlow(config: AppConfig, pkgRoot: string): Promise<void> {
  // 1. Find JSON files in output dir
  const outDir = path.resolve(config.outputDir);
  let jsonFiles: string[] = [];
  if (fs.existsSync(outDir)) {
    jsonFiles = fs.readdirSync(outDir)
      .filter((f) => f.startsWith('profil_') && f.endsWith('.json'))
      .sort()
      .reverse();
  }

  if (jsonFiles.length === 0) {
    p.log.warn(`${outDir} dizininde profil JSON bulunamadi.`);
    return;
  }

  // 2. Select JSON files (multiselect)
  const shown = jsonFiles.slice(0, 15);
  const chosenFiles = await multiSelectWithAll(
    'ER diyagrami uretilecek JSON dosyalari secin:',
    shown.map((f) => ({
      value: f,
      label: f.replace('profil_', '').replace('.json', ''),
    })),
  );
  if (chosenFiles.length === 0) return;

  // 3. Select detail level
  await resetStdin();
  const level = await p.select({
    message: 'Detay seviyesi secin:',
    options: [
      { value: 'minimal' as DetailLevel, label: 'Minimal', hint: 'Sadece tablo adlari (buyuk semalar icin)' },
      { value: 'medium' as DetailLevel, label: 'Medium', hint: 'Tablo adi + PK/FK kolonlari' },
      { value: 'full' as DetailLevel, label: 'Full', hint: 'Tum kolonlar, veri tipleri, constraint ikonlari' },
    ],
  });
  if (p.isCancel(level)) return;

  // 4. Select output formats (multiselect)
  await resetStdin();
  const formats = await p.multiselect({
    message: 'Cikti formatlari secin:',
    options: [
      { value: 'svg' as EROutputFormat, label: 'SVG', hint: 'Vektorel (Graphviz gerekli)' },
      { value: 'png' as EROutputFormat, label: 'PNG', hint: 'Raster (Graphviz gerekli)' },
      { value: 'html' as EROutputFormat, label: 'HTML', hint: 'Interaktif (Graphviz gerekli)' },
      { value: 'mermaid' as EROutputFormat, label: 'Mermaid', hint: '.mmd dosyasi' },
      { value: 'dot' as EROutputFormat, label: 'DOT', hint: 'Graphviz kaynak dosyasi' },
    ],
    required: true,
    initialValues: ['svg' as EROutputFormat, 'html' as EROutputFormat],
  });
  if (p.isCancel(formats)) return;
  const selectedFormats = formats as EROutputFormat[];

  // 5. Check Graphviz if needed
  const needsGraphviz = selectedFormats.some((f) => f === 'svg' || f === 'png' || f === 'html');
  if (needsGraphviz) {
    const gvAvailable = await checkGraphviz();
    if (!gvAvailable) {
      p.log.error(
        'Graphviz kurulu degil. SVG/PNG/HTML formatlari icin Graphviz gereklidir.\n' +
        'Kurulum: https://graphviz.org/download/\n' +
        'Windows: winget install Graphviz\n' +
        'macOS: brew install graphviz\n' +
        'Ubuntu/Debian: sudo apt install graphviz',
      );
      return;
    }
  }

  // 6. Generate for each JSON
  const templateDir = path.join(pkgRoot, 'templates');
  let totalFiles = 0;

  for (const fileName of chosenFiles) {
    const jsonPath = path.join(outDir, fileName);
    const s = p.spinner();
    s.start(`ER diyagrami uretiliyor: ${fileName}`);

    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const profile = dictToProfile(data);

      const outputFiles = await generateERDiagram({
        profile,
        detail_level: level as DetailLevel,
        formats: selectedFormats,
        output_dir: outDir,
        template_dir: templateDir,
      });

      totalFiles += outputFiles.length;

      if (profile.schemas.every((sc) => sc.tables.every((t) => t.columns.every((c) => !c.is_foreign_key)))) {
        s.stop(`${SYM.ok} ${fileName} (FK iliskisi yok - sadece tablolar)`);
      } else {
        s.stop(`${SYM.ok} ${fileName} - ${outputFiles.length} dosya uretildi`);
      }

      const logFiles = outputFiles.filter((f) => f.endsWith('.log'));
      const dataFiles = outputFiles.filter((f) => !f.endsWith('.log'));

      for (const f of dataFiles) {
        p.log.info(`  ${chalk.dim(path.basename(f))}`);
      }
      for (const f of logFiles) {
        p.log.warn(`  ${chalk.yellow('⚠ Log:')} ${chalk.dim(path.basename(f))}`);
      }

      if (dataFiles.length === 0) {
        s.stop(`${SYM.fail} ${fileName}: Hiçbir çıktı üretilemedi.`);
        if (logFiles.length > 0) {
          p.log.error(chalk.red(`  Detaylar: ${logFiles[0]}`));
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      s.stop(`${SYM.fail} ${fileName}`);
      p.log.error(chalk.red(`  Hata: ${msg}`));
      if (msg.includes('zaman aşımı') || msg.includes('timeout') || msg.includes('overflow') || msg.includes('minimal')) {
        p.log.warn(chalk.yellow('  İpucu: Daha küçük bir detay seviyesi (minimal) veya daha az tablo deneyin.'));
      }
    }
  }

  p.note(
    `${totalFiles} dosya uretildi\nCikti: ${outDir}`,
    'ER Diyagrami Tamamlandi',
  );
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
  await resetStdin();

  if (options.length === 1) {
    p.log.info(`Tek secenek: ${options[0].label}`);
    return [options[0].value];
  }

  const mode = await p.select({
    message: `${message} ${C.dim(`(${options.length} adet)`)}`,
    options: [
      { value: 'all' as const, label: `Tumunu Sec ${C.dim(`(${options.length})`)}` },
      { value: 'manual' as const, label: 'Manuel Sec' },
      { value: 'manual_empty' as const, label: 'Manuel Sec (Bos)' },
    ],
  });
  if (p.isCancel(mode)) return [];

  if (mode === 'all') {
    const allValues = options.map((o) => o.value);
    p.log.info(`${allValues.length} oge secildi.`);
    return allValues;
  }

  await resetStdin();
  const chosen = await p.multiselect({
    message,
    options: options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
    required: true,
    initialValues: mode === 'manual' ? options.map((o) => o.value) : [],
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

async function destroyConnectors(connectors: Map<string, BaseConnector>): Promise<void> {
  for (const connector of connectors.values()) {
    await (connector as any).destroy?.();
  }
}
