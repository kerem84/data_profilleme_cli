/**
 * Winston dual-transport logger.
 */
import winston from 'winston';
import fs from 'node:fs';
import path from 'node:path';

let _logger: winston.Logger | null = null;

export function setupLogger(level: string, logFile: string): winston.Logger {
  const dir = path.dirname(logFile);
  if (dir && dir !== '.') {
    fs.mkdirSync(dir, { recursive: true });
  }

  _logger = winston.createLogger({
    level: level.toLowerCase(),
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message }) =>
        `${timestamp} [${level.toUpperCase()}] ${message}`,
      ),
    ),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: logFile }),
    ],
  });

  return _logger;
}

export function getLogger(): winston.Logger {
  if (!_logger) {
    _logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) =>
          `${timestamp} [${level.toUpperCase()}] ${message}`,
        ),
      ),
      transports: [new winston.transports.Console()],
    });
  }
  return _logger;
}
