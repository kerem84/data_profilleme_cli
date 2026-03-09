/**
 * Welcome banner with Intellica logo and version.
 */
import gradient from 'gradient-string';
import chalk from 'chalk';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BRAND } from './theme.js';

const _require = createRequire(import.meta.url);
const _dir = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(_dir, '..', '..');
const { version: VERSION } = _require(path.resolve(PKG_ROOT, 'package.json'));

const LOGO = [
  '         ++.                                                                                        ',
  '       --+++..            :@@.                                            -@@                       ',
  '     ++++- ++++           @@@=             .@@+              =@@   .#@%   @@@=                      ',
  '   -++++.   +++++         :--. :--.:%@=   -=@@*-:   .#@#.    @@@   :@@%   :--    .@@@@-     #@@@.@@@',
  ' .++++.       +++*+       #@@: +@@@@@@@@- @@@@@@+ *@@@@@@@%  @@@   :@@%   #@@  .@@@@@@@@- @@@@@@@@@@',
  '=+++-           +***.     #@@: +@@+   @@@  -@@+  -@@#   :@@- @@@   :@@%   #@@  @@@       .@@@    @@@',
  ' .++++.       +++*+       #@@: +@@:   @@@  -@@+  +@@@@@@@@@* @@@   :@@%   #@@  @@@       .@@@    @@@',
  '   -++++.   +++++         #@@: +@@:   @@@  .@@@@+ @@@@-=@@   #@@@@ .@@@@% #@@  .@@@@@@@@= @@@@@@@@@@',
  '     ++++- ++++           #@@: +@@:   @@@   -@@@+  :@@@@@@    #@@@  :@@@% #@@    :@@@@+     @@@@-@@@',
  '       --+++:.                                                                                      ',
  '         ++.                                                                                        ',
];

const DATA_PROFILER = [
  ' ██████   █████  ████████  █████       ██████  ██████   ██████  ███████ ██ ██      ███████ ██████ ',
  ' ██   ██ ██   ██    ██    ██   ██      ██   ██ ██   ██ ██    ██ ██      ██ ██      ██      ██   ██',
  ' ██   ██ ███████    ██    ███████      ██████  ██████  ██    ██ █████   ██ ██      █████   ██████ ',
  ' ██   ██ ██   ██    ██    ██   ██      ██      ██   ██ ██    ██ ██      ██ ██      ██      ██   ██',
  ' ██████  ██   ██    ██    ██   ██      ██      ██   ██  ██████  ██      ██ ███████ ███████ ██   ██',
];

export function showBanner(): void {
  const g = gradient([BRAND.teal, BRAND.blue]);

  console.log('');
  for (const line of LOGO) {
    console.log(g(line));
  }
  console.log('');
  for (const line of DATA_PROFILER) {
    console.log(g(line));
  }
  console.log('');
  console.log(chalk.dim(` v${VERSION}  ${chalk.gray('|')}  @intellica/data-profiler`));
  console.log(chalk.dim(` Kaynak Tablo Profilleme Araci  ${chalk.gray('|')}  PostgreSQL & MSSQL & Oracle`));
  console.log('');
}
