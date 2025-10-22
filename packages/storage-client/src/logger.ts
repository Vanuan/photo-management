export interface LogLevel {
  ERROR: 0;
  WARN: 1;
  INFO: 2;
  DEBUG: 3;
}

export type LogLevelName = 'error' | 'warn' | 'info' | 'debug';

export interface LogEntry {
  level: LogLevelName;
  message: string;
  timestamp: string;
  component: string;
  meta?: Record<string, any>;
}

export class Logger {
  private static readonly LOG_LEVELS: LogLevel = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
  };

  private currentLevel: number;

  constructor(
    private component: string,
    logLevel: LogLevelName = 'info'
  ) {
    this.currentLevel = Logger.LOG_LEVELS[logLevel.toUpperCase() as keyof LogLevel];
  }

  error(message: string, meta?: Record<string, any>): void {
    this.log('error', message, meta);
  }

  warn(message: string, meta?: Record<string, any>): void {
    this.log('warn', message, meta);
  }

  info(message: string, meta?: Record<string, any>): void {
    this.log('info', message, meta);
  }

  debug(message: string, meta?: Record<string, any>): void {
    this.log('debug', message, meta);
  }

  setLevel(level: LogLevelName): void {
    this.currentLevel = Logger.LOG_LEVELS[level.toUpperCase() as keyof LogLevel];
  }

  private log(level: LogLevelName, message: string, meta?: Record<string, any>): void {
    const levelValue = Logger.LOG_LEVELS[level.toUpperCase() as keyof LogLevel];

    if (levelValue > this.currentLevel) {
      return;
    }

    const logEntry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      component: this.component,
      meta,
    };

    const formattedMessage = this.formatMessage(logEntry);

    switch (level) {
      case 'error':
        console.error(formattedMessage);
        break;
      case 'warn':
        console.warn(formattedMessage);
        break;
      case 'info':
        console.log(formattedMessage);
        break;
      case 'debug':
        console.debug(formattedMessage);
        break;
    }
  }

  private formatMessage(entry: LogEntry): string {
    const baseMessage = `[${entry.timestamp}] ${entry.level.toUpperCase()} [${entry.component}]: ${entry.message}`;

    if (entry.meta && Object.keys(entry.meta).length > 0) {
      return `${baseMessage} ${JSON.stringify(entry.meta)}`;
    }

    return baseMessage;
  }
}

// Default logger instance
export const logger = new Logger('StorageClient');

// Helper function to create logger with custom component name
export function createLogger(component: string, level: LogLevelName = 'info'): Logger {
  return new Logger(component, level);
}
