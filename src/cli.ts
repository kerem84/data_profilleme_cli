/**
 * CLI entry point - interactive menu-driven.
 */
import { Command } from 'commander';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { showBanner } from './ui/banner.js';
import { runInteractive } from './ui/menus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..');

const program = new Command();

program
  .name('intellica-profiler')
  .description('Kaynak Tablo Profilleme Araci (PostgreSQL / MSSQL)')
  .version('1.0.0')
  .requiredOption('-c, --config <path>', 'Config YAML dosya yolu')
  .action(async (opts) => {
    showBanner();
    await runInteractive(opts.config, PKG_ROOT);
  });

program.parse();
