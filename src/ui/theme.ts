/**
 * Shared brand colors, symbols, and formatters for the interactive CLI.
 */
import chalk from 'chalk';

/** Intellica brand color endpoints (teal -> blue gradient) */
export const BRAND = {
  teal: '#14b8a6',
  blue: '#3b82f6',
} as const;

/** Chalk helpers */
export const C = {
  dim: chalk.dim,
  bold: chalk.bold,
  success: chalk.green,
  error: chalk.red,
  warn: chalk.yellow,
  info: chalk.cyan,
  muted: chalk.gray,
} as const;

/** Windows cmd.exe-safe symbols (ASCII only) */
export const SYM = {
  ok: chalk.green('[OK]'),
  fail: chalk.red('[X]'),
  bar: '|',
  arrow: '->',
  bullet: '-',
} as const;

/** Format a database alias for display in menus */
export function fmtDb(alias: string, dbType: string, host: string, port: number, dbname: string): string {
  return `${chalk.bold(alias)} ${chalk.dim(`(${dbType} @ ${host}:${port}/${dbname})`)}`;
}

/** Format schema name with table count */
export function fmtSchema(name: string, tableCount: number): string {
  return `${name} ${chalk.dim(`(${tableCount} tablo)`)}`;
}

/** Format row count with Turkish locale */
export function fmtRows(n: number): string {
  return n.toLocaleString('tr-TR');
}
