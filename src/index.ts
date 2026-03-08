/**
 * Programmatic API for @intellica/data-profiler.
 */
export { loadConfig, ConfigError } from './config/loader.js';
export type { AppConfig, DatabaseConfig, ProfilingConfig, ReportingConfig } from './config/types.js';
export { Profiler } from './profiler/profiler.js';
export type {
  DatabaseProfile,
  SchemaProfile,
  TableProfile,
  ColumnProfile,
  TopNValue,
  HistogramBucket,
  OutlierBounds,
} from './profiler/types.js';
export { QualityScorer } from './metrics/quality.js';
export { ExcelReportGenerator } from './report/excel-report.js';
export { HtmlReportGenerator } from './report/html-report.js';
export { MappingAnnotator } from './mapping/annotator.js';
export { SqlLoader } from './sql/loader.js';
export { isNumericType } from './metrics/distribution.js';
export { isStringType } from './metrics/pattern.js';
export { dictToProfile, annotateWithMapping, generateReports } from './utils/profile-utils.js';
