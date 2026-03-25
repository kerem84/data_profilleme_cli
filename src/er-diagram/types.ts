/**
 * ER Diagram data model types.
 */

export type DetailLevel = 'minimal' | 'medium' | 'full';

export interface ERColumn {
  column_name: string;
  data_type: string;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  is_nullable: boolean;
}

export interface ERTable {
  schema_name: string;
  table_name: string;
  columns: ERColumn[];
  is_phantom: boolean;
}

export interface ERSchema {
  schema_name: string;
  tables: ERTable[];
}

export interface ERRelation {
  from_schema: string;
  from_table: string;
  from_columns: string[];
  to_schema: string;
  to_table: string;
  to_columns: string[];
  constraint_name: string;
  cardinality: '1:1' | '1:N';
}

export interface ERModel {
  db_alias: string;
  schemas: ERSchema[];
  relations: ERRelation[];
  detail_level: DetailLevel;
}

export type EROutputFormat = 'svg' | 'png' | 'dot' | 'mermaid' | 'html';

export type GraphvizEngine = 'dot' | 'neato' | 'fdp' | 'sfdp' | 'circo' | 'twopi';

export interface ERGeneratorOptions {
  profile_path: string;
  detail_level: DetailLevel;
  formats: EROutputFormat[];
  output_dir: string;
}
