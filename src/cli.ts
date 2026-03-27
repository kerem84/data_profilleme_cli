/**
 * CLI entry point - interactive menu-driven + diff subcommand.
 */
import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { showBanner } from './ui/banner.js';
import { runInteractive } from './ui/menus.js';
import { dictToProfile } from './utils/profile-utils.js';
import { calculateDiff } from './profiler/diff.js';
import { DiffExcelReportGenerator } from './report/diff-excel-report.js';
import { DiffHtmlReportGenerator } from './report/diff-html-report.js';
import { setupLogger } from './utils/logger.js';
import { SensitivityAnalyzer } from './metrics/sensitivity.js';
import type { SensitivityLevel } from './metrics/sensitivity.js';
import { ExcelReportGenerator } from './report/excel-report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..');

const _require = createRequire(import.meta.url);
const { version: PKG_VERSION } = _require(path.resolve(PKG_ROOT, 'package.json'));

const program = new Command();

program
  .name('intellica-profiler')
  .description('Kaynak Tablo Profilleme Araci (PostgreSQL / MSSQL / Oracle)')
  .version(PKG_VERSION);

// Default interactive mode
program
  .command('interactive', { isDefault: true })
  .description('Interaktif menu modu')
  .requiredOption('-c, --config <path>', 'Config YAML dosya yolu')
  .action(async (opts) => {
    showBanner();
    await runInteractive(opts.config, PKG_ROOT);
  });

// Diff subcommand
program
  .command('diff')
  .description('Iki profil JSON dosyasini karsilastir')
  .argument('<old_json>', 'Eski profil JSON dosya yolu')
  .argument('<new_json>', 'Yeni profil JSON dosya yolu')
  .option('-o, --output <dir>', 'Cikti dizini', './output')
  .option('--no-excel', 'Excel rapor uretme')
  .option('--no-html', 'HTML rapor uretme')
  .action(async (oldPath: string, newPath: string, opts) => {
    setupLogger('INFO', path.join(opts.output, 'diff.log'));

    if (!fs.existsSync(oldPath)) {
      console.error(`Dosya bulunamadi: ${oldPath}`);
      process.exit(1);
    }
    if (!fs.existsSync(newPath)) {
      console.error(`Dosya bulunamadi: ${newPath}`);
      process.exit(1);
    }

    const oldProfile = dictToProfile(JSON.parse(fs.readFileSync(oldPath, 'utf-8')));
    const newProfile = dictToProfile(JSON.parse(fs.readFileSync(newPath, 'utf-8')));

    console.log(`Eski: ${oldProfile.db_alias} — ${oldProfile.profiled_at}`);
    console.log(`Yeni: ${newProfile.db_alias} — ${newProfile.profiled_at}`);

    const diff = calculateDiff(oldProfile, newProfile);

    console.log(`\nSonuc: ${diff.summary.tables_improved} iyilesen, ${diff.summary.tables_degraded} kotulesen, ${diff.summary.tables_stable} ayni, ${diff.summary.tables_new} yeni, ${diff.summary.tables_dropped} silinen`);

    fs.mkdirSync(opts.output, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/(\d{8})(\d{6})/, '$1_$2');

    if (opts.excel !== false) {
      const excelPath = path.join(opts.output, `diff_${diff.new_alias}_${timestamp}.xlsx`);
      const gen = new DiffExcelReportGenerator();
      await gen.generate(diff, excelPath);
      console.log(`Excel: ${excelPath}`);
    }

    if (opts.html !== false) {
      const htmlPath = path.join(opts.output, `diff_${diff.new_alias}_${timestamp}.html`);
      const templateDir = path.join(PKG_ROOT, 'templates');
      const gen = new DiffHtmlReportGenerator(templateDir, true);
      gen.generate(diff, htmlPath);
      console.log(`HTML:  ${htmlPath}`);
    }
  });

// Sensitivity scan subcommand
program
  .command('sensitivity')
  .description('Profil JSON dosyasinda hassas veri taramasi yap (PII/KVKK)')
  .argument('<json_path>', 'Profil JSON dosya yolu')
  .option('-o, --output <dir>', 'Cikti dizini', './output')
  .option('-t, --threshold <level>', 'Minimum sensitivity seviyesi (none|low|medium|high)', 'low')
  .action(async (jsonPath: string, opts) => {
    if (!fs.existsSync(jsonPath)) {
      console.error(`Dosya bulunamadi: ${jsonPath}`);
      process.exit(1);
    }

    const threshold = opts.threshold as SensitivityLevel;
    const validLevels = ['none', 'low', 'medium', 'high'];
    if (!validLevels.includes(threshold)) {
      console.error(`Gecersiz threshold: ${threshold}. Gecerli degerler: ${validLevels.join(', ')}`);
      process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const profile = dictToProfile(data);

    console.log(`Profil: ${profile.db_alias} — ${profile.profiled_at}`);
    console.log(`Threshold: ${threshold}\n`);

    const findings = SensitivityAnalyzer.scanProfile(profile, threshold);

    if (findings.length === 0) {
      console.log('Hassas veri bulunamadi.');
      return;
    }

    // Console summary
    console.log(`${findings.length} hassas kolon tespit edildi:\n`);
    const levelCounts = { high: 0, medium: 0, low: 0 };
    for (const f of findings) {
      const lvl = f.result.level as keyof typeof levelCounts;
      if (lvl in levelCounts) levelCounts[lvl]++;
      console.log(`  [${f.result.level.toUpperCase()}] ${f.schema}.${f.table}.${f.column} — ${f.result.category} (maskeleme: ${f.result.masking_suggestion})`);
    }
    console.log(`\nOzet: ${levelCounts.high} yuksek, ${levelCounts.medium} orta, ${levelCounts.low} dusuk`);

    // Excel output
    fs.mkdirSync(opts.output, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/(\d{8})(\d{6})/, '$1_$2');
    const excelPath = path.join(opts.output, `sensitivity_${profile.db_alias}_${timestamp}.xlsx`);

    const gen = new ExcelReportGenerator(false, threshold);
    await gen.generateSensitivityOnly(profile, excelPath);
    console.log(`\nExcel: ${excelPath}`);
  });

program.parse();
