/**
 * ER Diagram Generator orchestrator.
 * Builds ERModel from profile JSON, renders to selected formats.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../utils/logger.js';
import type { DatabaseProfile } from '../profiler/types.js';
import type { DetailLevel, EROutputFormat, GraphvizEngine } from './types.js';
import { buildERModel } from './er-model.js';
import { renderDot, selectEngine } from './renderers/dot-renderer.js';
import { renderMermaid } from './renderers/mermaid-renderer.js';
import { renderHtml } from './renderers/html-renderer.js';
import { checkGraphviz, renderWithGraphviz, renderToSvgString, saveDotFile, setStderrLogPath } from './graphviz.js';

export interface GenerateEROptions {
  profile: DatabaseProfile;
  detail_level: DetailLevel;
  formats: EROutputFormat[];
  output_dir: string;
  template_dir: string;
}

function makeFilename(dbAlias: string, level: string, ext: string): string {
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `er_${dbAlias}_${level}_${ts}.${ext}`;
}

export async function generateERDiagram(options: GenerateEROptions): Promise<string[]> {
  const logger = getLogger();
  const { profile, detail_level, formats, output_dir, template_dir } = options;
  const outputFiles: string[] = [];
  const startTime = Date.now();

  logger.info(`ER üretimi başlıyor: db=${profile.db_alias}, detay=${detail_level}, formatlar=[${formats.join(', ')}]`);

  // Build model
  const model = buildERModel(profile, detail_level);
  let totalTables = 0;
  let totalColumns = 0;
  for (const s of model.schemas) {
    totalTables += s.tables.length;
    for (const t of s.tables) {
      totalColumns += t.columns.length;
    }
  }
  logger.info(`ERModel: ${model.schemas.length} şema, ${totalTables} tablo, ${totalColumns} kolon, ${model.relations.length} ilişki`);

  if (model.relations.length === 0) {
    logger.warn('Profilde FK ilişkisi bulunamadı. Diyagram sadece tabloları gösterecek.');
  }

  // Select engine based on graph complexity
  const engine: GraphvizEngine = selectEngine(model);
  if (engine !== 'dot') {
    logger.warn(`Büyük graf (${totalTables} tablo, ${model.relations.length} ilişki) — '${engine}' engine kullanılacak`);
  }

  // Generate DOT (needed for SVG/PNG/HTML too)
  const dotString = renderDot(model);
  const dotSizeKB = Math.round(dotString.length / 1024);
  logger.info(`DOT üretildi: ${dotSizeKB}KB, engine=${engine}`);

  // Set up Graphviz stderr log file
  const logFilename = makeFilename(profile.db_alias, detail_level, 'log');
  const logPath = path.join(output_dir, logFilename);
  setStderrLogPath(logPath);
  const header = [
    `ER Diagram Log — ${profile.db_alias}`,
    `Detay: ${detail_level} | Formatlar: ${formats.join(', ')} | Engine: ${engine}`,
    `Şema: ${model.schemas.length} | Tablo: ${totalTables} | Kolon: ${totalColumns} | İlişki: ${model.relations.length}`,
    `DOT boyutu: ${dotSizeKB}KB`,
    `Tarih: ${new Date().toISOString()}`,
    '',
  ].join('\n');
  fs.writeFileSync(logPath, header, 'utf-8');

  // Check Graphviz availability for formats that need it
  const needsGraphviz = formats.some((f) => f === 'svg' || f === 'png' || f === 'html');
  let graphvizAvailable = false;
  if (needsGraphviz) {
    graphvizAvailable = await checkGraphviz();
    if (!graphvizAvailable) {
      logger.error('Graphviz kurulu değil. SVG/PNG/HTML formatları üretilemeyecek.');
    }
  }

  // Ensure output dir exists
  if (!fs.existsSync(output_dir)) {
    fs.mkdirSync(output_dir, { recursive: true });
  }

  // DOT output
  if (formats.includes('dot')) {
    const dotPath = path.join(output_dir, makeFilename(profile.db_alias, detail_level, 'dot'));
    saveDotFile(dotString, dotPath);
    outputFiles.push(dotPath);
    logger.info(`DOT dosyası: ${dotPath}`);
  }

  // Mermaid output
  if (formats.includes('mermaid')) {
    const mmdString = renderMermaid(model);
    const mmdPath = path.join(output_dir, makeFilename(profile.db_alias, detail_level, 'mmd'));
    fs.writeFileSync(mmdPath, mmdString, 'utf-8');
    outputFiles.push(mmdPath);
    logger.info(`Mermaid dosyası: ${mmdPath}`);
  }

  // SVG output
  if (formats.includes('svg') && graphvizAvailable) {
    const svgPath = path.join(output_dir, makeFilename(profile.db_alias, detail_level, 'svg'));
    try {
      await renderWithGraphviz(dotString, 'svg', svgPath, engine);
      outputFiles.push(svgPath);
      logger.info(`SVG dosyası: ${svgPath}`);
    } catch (err: any) {
      logger.error(`SVG üretilemedi: ${err.message}`);
      // Still save DOT if not already saved
      if (!formats.includes('dot') && !outputFiles.some((f) => f.endsWith('.dot'))) {
        const fallbackDot = path.join(output_dir, makeFilename(profile.db_alias, detail_level, 'dot'));
        saveDotFile(dotString, fallbackDot);
        outputFiles.push(fallbackDot);
        logger.info(`Fallback DOT dosyası: ${fallbackDot}`);
      }
    }
  }

  // PNG output
  if (formats.includes('png') && graphvizAvailable) {
    const pngPath = path.join(output_dir, makeFilename(profile.db_alias, detail_level, 'png'));
    try {
      await renderWithGraphviz(dotString, 'png', pngPath, engine);
      outputFiles.push(pngPath);
      logger.info(`PNG dosyası: ${pngPath}`);
    } catch (err: any) {
      logger.error(`PNG üretilemedi: ${err.message}`);
    }
  }

  // HTML output (requires SVG via Graphviz)
  if (formats.includes('html') && graphvizAvailable) {
    try {
      logger.debug(`HTML için SVG string render: engine=${engine}`);
      const svgContent = await renderToSvgString(dotString, engine);
      logger.debug(`SVG string alındı: ${Math.round(svgContent.length / 1024)}KB`);
      const htmlContent = renderHtml(model, svgContent, template_dir);
      const htmlPath = path.join(output_dir, makeFilename(profile.db_alias, detail_level, 'html'));
      fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
      outputFiles.push(htmlPath);
      logger.info(`HTML dosyası: ${htmlPath} (${Math.round(htmlContent.length / 1024)}KB)`);
    } catch (err: any) {
      logger.error(`HTML üretilemedi: ${err.message}`);
      if (!formats.includes('dot') && !outputFiles.some((f) => f.endsWith('.dot'))) {
        const fallbackDot = path.join(output_dir, makeFilename(profile.db_alias, detail_level, 'dot'));
        saveDotFile(dotString, fallbackDot);
        outputFiles.push(fallbackDot);
        logger.info(`Fallback DOT dosyası: ${fallbackDot}`);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Append summary to log file
  const summary = [
    '',
    '='.repeat(60),
    `SONUÇ: ${outputFiles.length} dosya üretildi, süre=${elapsed}sn`,
    ...outputFiles.map((f) => `  - ${path.basename(f)}`),
    '',
  ].join('\n');
  fs.appendFileSync(logPath, summary, 'utf-8');

  // Keep log file only if it has Graphviz stderr content
  const logContent = fs.readFileSync(logPath, 'utf-8');
  const stderrBlocks = (logContent.match(/={60}\n\[/g) ?? []).length;
  if (stderrBlocks > 0) {
    outputFiles.push(logPath);
    logger.warn(`Graphviz log dosyası (hatalar var): ${logPath}`);
  } else {
    try { fs.unlinkSync(logPath); } catch { /* ignore */ }
  }

  logger.info(`ER üretimi tamamlandı: db=${profile.db_alias}, ${outputFiles.length} dosya, süre=${elapsed}sn`);
  return outputFiles;
}
