/**
 * Zod config validation schemas.
 */
import { z } from 'zod';

const dbTypeEnum = z.enum(['postgresql', 'mssql', 'oracle']);

const databaseConfigSchema = z.object({
  db_type: dbTypeEnum.default('postgresql'),
  host: z.string().min(1),
  port: z.coerce.number().int().positive(),
  dbname: z.string().min(1),
  user: z.string().min(1),
  password: z.string(),
  connect_timeout: z.coerce.number().int().positive().default(15),
  statement_timeout: z.coerce.number().int().positive().default(300000),
  schema_filter: z.union([z.literal('*'), z.array(z.string())]).default('*'),
  driver: z.string().default('ODBC Driver 17 for SQL Server'),
  service_name: z.string().default(''),
});

const qualityWeightsSchema = z.object({
  completeness: z.number().default(0.35),
  uniqueness: z.number().default(0.20),
  consistency: z.number().default(0.25),
  validity: z.number().default(0.20),
}).default({});

const profilingConfigSchema = z.object({
  top_n_values: z.coerce.number().int().positive().default(20),
  sample_threshold: z.coerce.number().int().positive().default(5_000_000),
  sample_percent: z.coerce.number().int().positive().default(10),
  numeric_percentiles: z.array(z.number()).default([0.01, 0.05, 0.25, 0.50, 0.75, 0.95, 0.99]),
  max_pattern_sample: z.coerce.number().int().positive().default(100_000),
  outlier_iqr_multiplier: z.number().positive().default(1.5),
  quality_weights: qualityWeightsSchema,
  string_patterns: z.record(z.string()).default({}),
}).default({});

const mappingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mapping_file: z.string().default(''),
}).default({});

const excelConfigSchema = z.object({
  enabled: z.boolean().default(true),
  filename_template: z.string().default('profil_{db_alias}_{timestamp}.xlsx'),
}).default({});

const htmlConfigSchema = z.object({
  enabled: z.boolean().default(true),
  filename_template: z.string().default('profil_{db_alias}_{timestamp}.html'),
  embed_assets: z.boolean().default(true),
}).default({});

const reportingConfigSchema = z.object({
  excel: excelConfigSchema,
  html: htmlConfigSchema,
  combined_report: z.boolean().default(true),
}).default({});

const projectConfigSchema = z.object({
  name: z.string().default('Profilleme'),
  output_dir: z.string().default('./output'),
}).default({});

const loggingConfigSchema = z.object({
  level: z.string().default('INFO'),
  file: z.string().default('./output/profil.log'),
}).default({});

export const appConfigSchema = z.object({
  project: projectConfigSchema,
  databases: z.record(databaseConfigSchema).refine(
    (dbs) => Object.keys(dbs).length > 0,
    { message: 'En az bir veritabani tanimlanmali (databases bolumu).' },
  ),
  profiling: profilingConfigSchema,
  mapping: mappingConfigSchema,
  reporting: reportingConfigSchema,
  logging: loggingConfigSchema,
});

export type RawAppConfig = z.infer<typeof appConfigSchema>;
