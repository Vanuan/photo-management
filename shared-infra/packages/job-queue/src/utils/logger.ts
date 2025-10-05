/**
 * Logger utility for Job Queue Coordinator
 * @module @shared-infra/job-queue/utils/logger
 */

import { LoggingConfig } from '../types';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogContext {
  queueName?: string;
  jobId?: string;
  workerId?: string;
  component?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export class Logger {
  private level: LogLevel;
  private format: 'json' | 'text';
  private context: LogContext;

  constructor(config?: Partial<LoggingConfig>, context?: LogContext) {
    this.level = this.parseLogLevel(config?.level || 'info');
    this.format = config?.format || 'json';
    this.context = context || {};
  }

  private parseLogLevel(level: string): LogLevel {
    const levels: Record<string, LogLevel> = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR,
    };
    return levels[level.toLowerCase()] ?? LogLevel.INFO;
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger(
      { level: this.getLevelName(), format: this.format },
      { ...this.context, ...context }
    );
    return childLogger;
  }

  private getLevelName(): 'debug' | 'info' | 'warn' | 'error' {
    const levels: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error'];
    return levels[this.level] || 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatLog(
    level: string,
    message: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      context: { ...this.context, ...metadata },
    };

    if (error) {
      entry.error = {
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      };
    }

    if (this.format === 'json') {
      return JSON.stringify(entry);
    }

    // Text format
    const contextStr =
      Object.keys(entry.context || {}).length > 0 ? ` ${JSON.stringify(entry.context)}` : '';
    const errorStr = entry.error
      ? `\n  Error: ${entry.error.message}\n  Stack: ${entry.error.stack}`
      : '';
    return `[${entry.timestamp}] ${entry.level}: ${message}${contextStr}${errorStr}`;
  }

  private write(output: string): void {
    // Simple console output for now
    // Can be extended to write to files or external services
    console.log(output);
  }

  /**
   * Log debug message
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.write(this.formatLog('debug', message, metadata));
    }
  }

  /**
   * Log info message
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.write(this.formatLog('info', message, metadata));
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.write(this.formatLog('warn', message, metadata));
    }
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.write(this.formatLog('error', message, metadata, error));
    }
  }

  /**
   * Log with custom level
   */
  log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    metadata?: Record<string, unknown>
  ): void {
    switch (level) {
      case 'debug':
        this.debug(message, metadata);
        break;
      case 'info':
        this.info(message, metadata);
        break;
      case 'warn':
        this.warn(message, metadata);
        break;
      case 'error':
        this.error(message, undefined, metadata);
        break;
    }
  }
}

/**
 * Create a default logger instance
 */
export function createLogger(config?: Partial<LoggingConfig>, context?: LogContext): Logger {
  return new Logger(config, context);
}

/**
 * Default logger instance
 */
export const defaultLogger = new Logger();
