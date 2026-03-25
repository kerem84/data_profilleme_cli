/**
 * Graphviz CLI wrapper for rendering DOT to SVG/PNG.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { getLogger } from '../utils/logger.js';
import type { GraphvizEngine } from './types.js';

const GRAPHVIZ_TIMEOUT_MS = 120_000;

/** Path to write Graphviz stderr log (set by er-generator before rendering). */
let _stderrLogPath: string | null = null;

export function setStderrLogPath(logPath: string): void {
  _stderrLogPath = logPath;
}

/**
 * Strip XML declaration and DOCTYPE from SVG output for HTML embedding.
 */
function stripSvgPreamble(svg: string): string {
  return svg
    .replace(/<\?xml[^?]*\?>\s*/gi, '')
    .replace(/<!DOCTYPE[^>]*>\s*/gi, '')
    .replace(/<!--[^]*?-->\s*/g, '')
    .trim();
}

/**
 * Classify Graphviz stderr into a user-friendly error message.
 */
function classifyGraphvizError(stderr: string, elapsed: string, dotSizeKB: number): string {
  if (stderr.includes('integer overflow')) {
    return `Graphviz bellek taşması (integer overflow). Graf çok büyük (DOT=${dotSizeKB}KB). ` +
      `'minimal' detay seviyesi veya daha az tablo ile deneyin.`;
  }
  if (stderr.includes('trouble in init_rank')) {
    return `Graphviz ranking hatası (DOT=${dotSizeKB}KB, ${elapsed}sn). ` +
      `Graf 'dot' engine için çok karmaşık — 'sfdp' engine otomatik denenecek.`;
  }
  const failedNodes = (stderr.match(/failed at node/g) ?? []).length;
  if (failedNodes > 0) {
    return `Graphviz layout hatası: ${failedNodes} node'da başarısız oldu (DOT=${dotSizeKB}KB, ${elapsed}sn). ` +
      `Graf çok büyük/karmaşık.`;
  }
  return '';
}

/**
 * Write Graphviz stderr to the dedicated log file.
 */
function writeStderrLog(context: string, stderr: string): void {
  if (!_stderrLogPath || !stderr) return;
  const header = `\n${'='.repeat(60)}\n[${new Date().toISOString()}] ${context}\n${'='.repeat(60)}\n`;
  fs.appendFileSync(_stderrLogPath, header + stderr + '\n', 'utf-8');
}

/**
 * Check if Graphviz `dot` command is available on the system.
 */
export async function checkGraphviz(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('dot', ['-V'], { timeout: 5_000 }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Render a DOT string to SVG or PNG using Graphviz.
 */
export async function renderWithGraphviz(
  dot: string,
  format: 'svg' | 'png',
  outputPath: string,
  engine: GraphvizEngine = 'dot',
): Promise<void> {
  const logger = getLogger();
  const available = await checkGraphviz();
  if (!available) {
    throw new Error(
      'Graphviz kurulu değil. SVG/PNG üretmek için Graphviz gereklidir.\n' +
        'Kurulum: https://graphviz.org/download/',
    );
  }

  const dotSizeKB = Math.round(dot.length / 1024);
  logger.debug(`Graphviz render: engine=${engine}, format=${format}, DOT=${dotSizeKB}KB`);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const proc = execFile(
      engine,
      [`-T${format}`, '-o', outputPath],
      { timeout: GRAPHVIZ_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (stderr) {
          writeStderrLog(`renderWithGraphviz engine=${engine} format=${format}`, stderr);
          const lines = stderr.split('\n').length;
          logger.warn(`Graphviz stderr: ${lines} satır (${elapsed}sn). Log: ${_stderrLogPath ?? '-'}`);
        }
        if (error) {
          if (stderr) {
            const classified = classifyGraphvizError(stderr, elapsed, dotSizeKB);
            if (classified) {
              logger.error(classified);
              reject(new Error(classified));
              return;
            }
          }
          if (error.killed) {
            const msg = `Graphviz zaman aşımı (${elapsed}sn, DOT=${dotSizeKB}KB, engine=${engine}).`;
            logger.error(msg);
            reject(new Error(msg));
          } else {
            logger.error(`Graphviz hata (${engine}): ${error.message}`);
            reject(new Error(`Graphviz render hatası (${engine}): ${error.message}`));
          }
          return;
        }
        logger.info(`Graphviz render OK: engine=${engine}, format=${format}, süre=${elapsed}sn`);
        resolve();
      },
    );

    if (proc.stdin) {
      proc.stdin.write(dot);
      proc.stdin.end();
    }
  });
}

/**
 * Render DOT to SVG and return the SVG content as string (preamble stripped for HTML embedding).
 */
export async function renderToSvgString(dot: string, engine: GraphvizEngine = 'dot'): Promise<string> {
  const logger = getLogger();
  const available = await checkGraphviz();
  if (!available) {
    throw new Error('Graphviz kurulu değil. HTML çıktısı için Graphviz gereklidir.');
  }

  const dotSizeKB = Math.round(dot.length / 1024);
  logger.debug(`Graphviz SVG string: engine=${engine}, DOT=${dotSizeKB}KB`);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const proc = execFile(
      engine,
      ['-Tsvg'],
      { timeout: GRAPHVIZ_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (stderr) {
          writeStderrLog(`renderToSvgString engine=${engine}`, stderr);
          const lines = stderr.split('\n').length;
          logger.warn(`Graphviz stderr: ${lines} satır (${elapsed}sn). Log: ${_stderrLogPath ?? '-'}`);
        }
        if (error) {
          if (stderr) {
            const classified = classifyGraphvizError(stderr, elapsed, dotSizeKB);
            if (classified) {
              logger.error(classified);
              reject(new Error(classified));
              return;
            }
          }
          if ((error as any).killed) {
            const msg = `Graphviz SVG zaman aşımı (${elapsed}sn, DOT=${dotSizeKB}KB, engine=${engine}).`;
            logger.error(msg);
            reject(new Error(msg));
          } else {
            logger.error(`Graphviz SVG hata (${engine}): ${error.message}`);
            reject(new Error(`Graphviz SVG render hatası (${engine}): ${error.message}`));
          }
          return;
        }
        const cleanSvg = stripSvgPreamble(stdout);
        logger.debug(`SVG: ham=${Math.round(stdout.length / 1024)}KB, temiz=${Math.round(cleanSvg.length / 1024)}KB, süre=${elapsed}sn`);
        resolve(cleanSvg);
      },
    );

    if (proc.stdin) {
      proc.stdin.write(dot);
      proc.stdin.end();
    }
  });
}

/**
 * Save DOT string to a file.
 */
export function saveDotFile(dot: string, outputPath: string): void {
  fs.writeFileSync(outputPath, dot, 'utf-8');
}
