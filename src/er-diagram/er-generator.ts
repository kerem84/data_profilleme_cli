/**
 * ER Diagram Generator orchestrator.
 * Builds ERModel from profile JSON, renders to selected formats.
 * Always generates per-schema SVGs + a combined SVG.
 * HTML embeds all per-schema SVGs and switches via dropdown.
 *
 * Output directory structure:
 *   output/er_{db}/                  ← database root
 *     er_{db}_{level}_{ts}.svg       ← combined
 *     er_{db}_{level}_{ts}.html      ← interactive HTML
 *     {schema}/                      ← per-schema folder
 *       er_{db}_{schema}_{level}_{ts}.svg
 */

import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../utils/logger.js';
import type { DatabaseProfile } from '../profiler/types.js';
import type { DetailLevel, EROutputFormat, GraphvizEngine } from './types.js';
import { buildERModel, filterERModel } from './er-model.js';
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
  schema_filter?: string[];
  engine_override?: GraphvizEngine;
}

function makeFilename(dbAlias: string, level: string, ext: string, schemaSuffix?: string): string {
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
  const schemaTag = schemaSuffix ? `_${schemaSuffix}` : '';
  return `er_${dbAlias}${schemaTag}_${level}_${ts}.${ext}`;
}

/** Ensure directory exists */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export async function generateERDiagram(options: GenerateEROptions): Promise<string[]> {
  const logger = getLogger();
  const { profile, detail_level, formats, output_dir, template_dir, schema_filter, engine_override } = options;
  const outputFiles: string[] = [];
  const startTime = Date.now();

  logger.info(`ER üretimi başlıyor: db=${profile.db_alias}, detay=${detail_level}, formatlar=[${formats.join(', ')}]${engine_override ? `, engine=${engine_override}` : ''}`);

  // Build full model
  const fullModel = buildERModel(profile, detail_level);

  let totalTables = 0;
  let totalColumns = 0;
  for (const s of fullModel.schemas) {
    totalTables += s.tables.length;
    for (const t of s.tables) {
      totalColumns += t.columns.length;
    }
  }
  logger.info(`ERModel: ${fullModel.schemas.length} şema, ${totalTables} tablo, ${totalColumns} kolon, ${fullModel.relations.length} ilişki`);

  if (fullModel.relations.length === 0) {
    logger.warn('Profilde FK ilişkisi bulunamadı. Diyagram sadece tabloları gösterecek.');
  }

  // Determine which schemas to process
  const allSchemaNames = fullModel.schemas.map((s) => s.schema_name);
  const targetSchemas = (schema_filter && schema_filter.length > 0)
    ? schema_filter.filter((s) => allSchemaNames.includes(s))
    : allSchemaNames;

  // --- Directory structure: output/er_{db}/ ---
  const dbDir = path.join(output_dir, `er_${profile.db_alias}`);
  ensureDir(dbDir);

  // Set up Graphviz stderr log file
  const logFilename = makeFilename(profile.db_alias, detail_level, 'log');
  const logPath = path.join(dbDir, logFilename);
  setStderrLogPath(logPath);
  const header = [
    `ER Diagram Log — ${profile.db_alias}`,
    `Detay: ${detail_level} | Formatlar: ${formats.join(', ')} | Engine: ${engine_override ?? 'auto'}`,
    `Şema: ${fullModel.schemas.length} | Tablo: ${totalTables} | Kolon: ${totalColumns} | İlişki: ${fullModel.relations.length}`,
    `Tarih: ${new Date().toISOString()}`,
    '',
  ].join('\n');
  fs.writeFileSync(logPath, header, 'utf-8');

  // Check Graphviz
  const needsGraphviz = formats.some((f) => f === 'svg' || f === 'png' || f === 'html');
  let graphvizAvailable = false;
  if (needsGraphviz) {
    graphvizAvailable = await checkGraphviz();
    if (!graphvizAvailable) {
      logger.error('Graphviz kurulu değil. SVG/PNG/HTML formatları üretilemeyecek.');
    }
  }

  // --- Generate combined (full) outputs → er_{db}/ root ---
  const fullEngine: GraphvizEngine = engine_override ?? selectEngine(fullModel);
  const fullDot = renderDot(fullModel);
  logger.info(`Birleşik DOT: ${Math.round(fullDot.length / 1024)}KB, engine=${fullEngine}`);

  if (formats.includes('dot')) {
    const dotPath = path.join(dbDir, makeFilename(profile.db_alias, detail_level, 'dot'));
    saveDotFile(fullDot, dotPath);
    outputFiles.push(dotPath);
    logger.info(`DOT: ${path.basename(dotPath)}`);
  }

  if (formats.includes('mermaid')) {
    const mmdString = renderMermaid(fullModel);
    const mmdPath = path.join(dbDir, makeFilename(profile.db_alias, detail_level, 'mmd'));
    fs.writeFileSync(mmdPath, mmdString, 'utf-8');
    outputFiles.push(mmdPath);
    logger.info(`Mermaid: ${path.basename(mmdPath)}`);
  }

  // Combined SVG
  let fullSvgContent = '';
  if ((formats.includes('svg') || formats.includes('html')) && graphvizAvailable) {
    try {
      fullSvgContent = await renderToSvgString(fullDot, fullEngine);
      if (formats.includes('svg')) {
        const svgPath = path.join(dbDir, makeFilename(profile.db_alias, detail_level, 'svg'));
        fs.writeFileSync(svgPath, fullSvgContent, 'utf-8');
        outputFiles.push(svgPath);
        logger.info(`SVG (birleşik): ${path.basename(svgPath)}`);
      }
    } catch (err: any) {
      logger.error(`Birleşik SVG üretilemedi: ${err.message}`);
      if (!formats.includes('dot') && !outputFiles.some((f) => f.endsWith('.dot'))) {
        const fallbackDot = path.join(dbDir, makeFilename(profile.db_alias, detail_level, 'dot'));
        saveDotFile(fullDot, fallbackDot);
        outputFiles.push(fallbackDot);
      }
    }
  }

  // Combined PNG
  if (formats.includes('png') && graphvizAvailable) {
    const pngPath = path.join(dbDir, makeFilename(profile.db_alias, detail_level, 'png'));
    try {
      await renderWithGraphviz(fullDot, 'png', pngPath, fullEngine);
      outputFiles.push(pngPath);
      logger.info(`PNG (birleşik): ${path.basename(pngPath)}`);
    } catch (err: any) {
      logger.error(`PNG üretilemedi: ${err.message}`);
    }
  }

  // --- Generate per-schema SVGs → er_{db}/{schema}/ ---
  const schemaSvgMap: Record<string, string> = {};

  if (graphvizAvailable && targetSchemas.length > 1 && (formats.includes('svg') || formats.includes('html'))) {
    logger.info(`Şema başına SVG üretimi: ${targetSchemas.length} şema`);

    for (const schemaName of targetSchemas) {
      try {
        const filtered = filterERModel(fullModel, [schemaName]);
        const filteredTableCount = filtered.schemas.reduce((sum, s) => sum + s.tables.length, 0);

        if (filteredTableCount === 0) {
          logger.warn(`  ${schemaName}: tablo yok, atlanıyor`);
          continue;
        }

        const filteredDot = renderDot(filtered);
        const filteredEngine: GraphvizEngine = engine_override ?? selectEngine(filtered);
        const svgStr = await renderToSvgString(filteredDot, filteredEngine);
        schemaSvgMap[schemaName] = svgStr;

        // Save per-schema SVG → er_{db}/{schema}/
        if (formats.includes('svg')) {
          const schemaDir = path.join(dbDir, schemaName);
          ensureDir(schemaDir);
          const svgPath = path.join(schemaDir, makeFilename(profile.db_alias, detail_level, 'svg', schemaName));
          fs.writeFileSync(svgPath, svgStr, 'utf-8');
          outputFiles.push(svgPath);
        }

        logger.info(`  ${schemaName}: ${filteredTableCount} tablo, ${filtered.relations.length} ilişki, engine=${filteredEngine}`);
      } catch (err: any) {
        logger.error(`  ${schemaName}: SVG üretilemedi — ${err.message}`);
      }
    }
  }

  // --- HTML output → er_{db}/ root ---
  if (formats.includes('html') && graphvizAvailable && fullSvgContent) {
    try {
      const htmlContent = renderHtml(fullModel, fullSvgContent, schemaSvgMap, template_dir);
      const htmlPath = path.join(dbDir, makeFilename(profile.db_alias, detail_level, 'html'));
      fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
      outputFiles.push(htmlPath);
      logger.info(`HTML: ${path.basename(htmlPath)} (${Math.round(htmlContent.length / 1024)}KB, ${Object.keys(schemaSvgMap).length} şema SVG embed)`);
    } catch (err: any) {
      logger.error(`HTML üretilemedi: ${err.message}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Append summary to log file
  const summary = [
    '',
    '='.repeat(60),
    `SONUÇ: ${outputFiles.length} dosya üretildi, süre=${elapsed}sn`,
    ...outputFiles.map((f) => `  - ${path.relative(output_dir, f)}`),
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
