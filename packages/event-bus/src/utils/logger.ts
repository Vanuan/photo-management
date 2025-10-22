/**
 * Logger Utility
 *
 * Simple logging utility for Event Bus service
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;
  private serviceName: string;

  constructor(level: LogLevel = 'info', serviceName: string = 'event-bus') {
    this.level = level;
    this.serviceName = serviceName;
  }

  /**
   * Log debug message
   */
  debug(message: string, ...args: any[]): void {
    this.log('debug', message, ...args);
  }

  /**
   * Log info message
   */
  info(message: string, ...args: any[]): void {
    this.log('info', message, ...args);
  }

  /**
   * Log warning message
   */
  warn(message: string, ...args: any[]): void {
    this.log('warn', message, ...args);
  }

  /**
   * Log error message
   */
  error(message: string, error?: any, ...args: any[]): void {
    if (error instanceof Error) {
      this.log('error', message, { error: error.message, stack: error.stack }, ...args);
    } else if (error) {
      this.log('error', message, error, ...args);
    } else {
      this.log('error', message, ...args);
    }
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, ...args: any[]): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const prefix = `[${timestamp}] [${levelStr}] [${this.serviceName}]`;

    const formattedArgs = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    });

    const fullMessage = [prefix, message, ...formattedArgs].join(' ');

    switch (level) {
      case 'debug':
      case 'info':
        console.log(fullMessage);
        break;
      case 'warn':
        console.warn(fullMessage);
        break;
      case 'error':
        console.error(fullMessage);
        break;
    }
  }

  /**
   * Set log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }
}
