/**
 * Connector factory.
 */
import type { DatabaseConfig } from '../config/types.js';
import { BaseConnector } from './base-connector.js';
import { PostgresConnector } from './postgres-connector.js';
import { MssqlConnector } from './mssql-connector.js';

export function createConnector(config: DatabaseConfig): BaseConnector {
  if (config.dbType === 'mssql') {
    return new MssqlConnector(config);
  }
  return new PostgresConnector(config);
}
