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

program.parse();
