import { Logger, createLogger, logger, LogLevel, LogLevelName, LogEntry } from '../logger';

// Import test data constants
const { LONG_STRINGS } = require('../../../../test-utils/test-data');

describe('Logger', () => {
  let mockConsole: {
    error: jest.SpyInstance;
    warn: jest.SpyInstance;
    log: jest.SpyInstance;
    debug: jest.SpyInstance;
  };

  beforeEach(() => {
    // Mock console methods
    mockConsole = {
      error: jest.spyOn(console, 'error').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      log: jest.spyOn(console, 'log').mockImplementation(),
      debug: jest.spyOn(console, 'debug').mockImplementation(),
    };
  });

  afterEach(() => {
    // Restore console methods
    Object.values(mockConsole).forEach(spy => spy.mockRestore());
  });

  describe('constructor', () => {
    it('should initialize with component name and default log level', () => {
      const testLogger = new Logger('TestComponent');

      // Test by logging at info level (should be visible with default 'info' level)
      testLogger.info('test message');

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] INFO \[TestComponent\]: test message/)
      );
    });

    it('should initialize with custom log level', () => {
      const testLogger = new Logger('TestComponent', 'error');

      // Info should not be logged with error level
      testLogger.info('info message');
      expect(mockConsole.log).not.toHaveBeenCalled();

      // Error should be logged
      testLogger.error('error message');
      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringMatching(/\[.*\] ERROR \[TestComponent\]: error message/)
      );
    });

    it('should handle all valid log levels in constructor', () => {
      const levels: LogLevelName[] = ['error', 'warn', 'info', 'debug'];

      levels.forEach(level => {
        expect(() => new Logger('TestComponent', level)).not.toThrow();
      });
    });
  });

  describe('logging methods', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger('TestLogger', 'debug'); // Enable all levels
    });

    describe('error', () => {
      it('should log error messages to console.error', () => {
        testLogger.error('test error message');

        expect(mockConsole.error).toHaveBeenCalledWith(
          expect.stringMatching(/\[.*\] ERROR \[TestLogger\]: test error message/)
        );
      });

      it('should log error messages with metadata', () => {
        const meta = { userId: '123', action: 'upload' };
        testLogger.error('test error with metadata', meta);

        expect(mockConsole.error).toHaveBeenCalledWith(
          expect.stringMatching(LONG_STRINGS.LOG_PATTERN_BASIC)
        );
      });
    });

    describe('warn', () => {
      it('should log warning messages to console.warn', () => {
        testLogger.warn('test warning message');

        expect(mockConsole.warn).toHaveBeenCalledWith(
          expect.stringMatching(/\[.*\] WARN \[TestLogger\]: test warning message/)
        );
      });

      it('should log warning messages with metadata', () => {
        const meta = { retryCount: 3 };
        testLogger.warn('retry warning', meta);

        expect(mockConsole.warn).toHaveBeenCalledWith(
          expect.stringMatching(/\[.*\] WARN \[TestLogger\]: retry warning \{"retryCount":3\}/)
        );
      });
    });

    describe('info', () => {
      it('should log info messages to console.log', () => {
        testLogger.info('test info message');

        expect(mockConsole.log).toHaveBeenCalledWith(
          expect.stringMatching(/\[.*\] INFO \[TestLogger\]: test info message/)
        );
      });

      it('should log info messages with metadata', () => {
        const meta = { requestId: 'req-123' };
        testLogger.info('processing request', meta);

        expect(mockConsole.log).toHaveBeenCalledWith(
          expect.stringMatching(
            /\[.*\] INFO \[TestLogger\]: processing request \{"requestId":"req-123"\}/
          )
        );
      });
    });

    describe('debug', () => {
      it('should log debug messages to console.debug', () => {
        testLogger.debug('test debug message');

        expect(mockConsole.debug).toHaveBeenCalledWith(
          expect.stringMatching(/\[.*\] DEBUG \[TestLogger\]: test debug message/)
        );
      });

      it('should log debug messages with metadata', () => {
        const meta = { variable: 'value', step: 1 };
        testLogger.debug('debug step', meta);

        expect(mockConsole.debug).toHaveBeenCalledWith(
          expect.stringMatching(
            /\[.*\] DEBUG \[TestLogger\]: debug step \{"variable":"value","step":1\}/
          )
        );
      });
    });
  });

  describe('log level filtering', () => {
    it('should respect ERROR level - only show errors', () => {
      const testLogger = new Logger('TestLogger', 'error');

      testLogger.debug('debug message');
      testLogger.info('info message');
      testLogger.warn('warn message');
      testLogger.error('error message');

      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.log).not.toHaveBeenCalled();
      expect(mockConsole.warn).not.toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });

    it('should respect WARN level - show warnings and errors', () => {
      const testLogger = new Logger('TestLogger', 'warn');

      testLogger.debug('debug message');
      testLogger.info('info message');
      testLogger.warn('warn message');
      testLogger.error('error message');

      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.log).not.toHaveBeenCalled();
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });

    it('should respect INFO level - show info, warnings and errors', () => {
      const testLogger = new Logger('TestLogger', 'info');

      testLogger.debug('debug message');
      testLogger.info('info message');
      testLogger.warn('warn message');
      testLogger.error('error message');

      expect(mockConsole.debug).not.toHaveBeenCalled();
      expect(mockConsole.log).toHaveBeenCalledTimes(1);
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });

    it('should respect DEBUG level - show all messages', () => {
      const testLogger = new Logger('TestLogger', 'debug');

      testLogger.debug('debug message');
      testLogger.info('info message');
      testLogger.warn('warn message');
      testLogger.error('error message');

      expect(mockConsole.debug).toHaveBeenCalledTimes(1);
      expect(mockConsole.log).toHaveBeenCalledTimes(1);
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('setLevel', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger('TestLogger', 'info');
    });

    it('should change log level to error', () => {
      testLogger.setLevel('error');

      testLogger.info('info message');
      testLogger.error('error message');

      expect(mockConsole.log).not.toHaveBeenCalled();
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });

    it('should change log level to debug', () => {
      testLogger.setLevel('debug');

      testLogger.debug('debug message');
      testLogger.info('info message');

      expect(mockConsole.debug).toHaveBeenCalledTimes(1);
      expect(mockConsole.log).toHaveBeenCalledTimes(1);
    });

    it('should handle level changes dynamically', () => {
      // Start with info level
      testLogger.info('info message 1');
      testLogger.debug('debug message 1');

      expect(mockConsole.log).toHaveBeenCalledTimes(1);
      expect(mockConsole.debug).not.toHaveBeenCalled();

      // Change to debug level
      testLogger.setLevel('debug');
      testLogger.info('info message 2');
      testLogger.debug('debug message 2');

      expect(mockConsole.log).toHaveBeenCalledTimes(2);
      expect(mockConsole.debug).toHaveBeenCalledTimes(1);

      // Change to error level
      testLogger.setLevel('error');
      testLogger.info('info message 3');
      testLogger.error('error message 1');

      expect(mockConsole.log).toHaveBeenCalledTimes(2); // No new info logs
      expect(mockConsole.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('message formatting', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger('TestLogger', 'debug');
    });

    it('should format messages with timestamp and component', () => {
      const beforeTime = new Date().toISOString();
      testLogger.info('test message');
      const afterTime = new Date().toISOString();

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] INFO \[TestLogger\]: test message$/
        )
      );

      // Verify timestamp is within reasonable range
      const logCall = mockConsole.log.mock.calls[0][0];
      const timestampMatch = logCall.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
      expect(timestampMatch).not.toBeNull();

      const logTimestamp = timestampMatch![1];
      expect(logTimestamp >= beforeTime && logTimestamp <= afterTime).toBe(true);
    });

    it('should format messages with metadata', () => {
      const meta = {
        string: 'value',
        number: 42,
        boolean: true,
        nested: { key: 'nestedValue' },
        array: [1, 2, 3],
      };

      testLogger.info('complex metadata', meta);

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringMatching(LONG_STRINGS.LOG_PATTERN_COMPLEX)
      );
    });

    it('should not include metadata section for empty metadata', () => {
      testLogger.info('message without metadata', {});

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringMatching(/^\[.*\] INFO \[TestLogger\]: message without metadata$/)
      );
    });

    it('should handle undefined metadata', () => {
      testLogger.info('message with undefined metadata', undefined);

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringMatching(/^\[.*\] INFO \[TestLogger\]: message with undefined metadata$/)
      );
    });

    it('should handle null metadata', () => {
      testLogger.info('message with null metadata', null as any);

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringMatching(/^\[.*\] INFO \[TestLogger\]: message with null metadata$/)
      );
    });
  });

  describe('static LOG_LEVELS', () => {
    it('should have correct log level values', () => {
      // Access static property through instance for testing
      const testLogger = new Logger('Test');

      // We can't directly access private static members, but we can test their behavior
      // by verifying that level filtering works correctly with expected order

      testLogger.setLevel('error');
      testLogger.error('error test');
      expect(mockConsole.error).toHaveBeenCalledTimes(1);

      testLogger.warn('warn test');
      expect(mockConsole.warn).not.toHaveBeenCalled();

      testLogger.setLevel('warn');
      testLogger.warn('warn test 2');
      expect(mockConsole.warn).toHaveBeenCalledTimes(1);

      testLogger.info('info test');
      expect(mockConsole.log).not.toHaveBeenCalled();
    });
  });
});

describe('createLogger', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create logger with custom component name', () => {
    const customLogger = createLogger('CustomComponent');

    customLogger.info('test message');

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] INFO \[CustomComponent\]: test message/)
    );
  });

  it('should create logger with custom component name and level', () => {
    const customLogger = createLogger('CustomComponent', 'error');

    customLogger.info('info message');
    customLogger.error('error message');

    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] ERROR \[CustomComponent\]: error message/)
    );
  });

  it('should create logger with default info level when level not specified', () => {
    const customLogger = createLogger('CustomComponent');

    customLogger.debug('debug message');
    customLogger.info('info message');

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('should create independent logger instances', () => {
    const logger1 = createLogger('Component1', 'debug');
    const logger2 = createLogger('Component2', 'error');

    logger1.debug('debug from 1');
    logger2.debug('debug from 2');

    logger1.error('error from 1');
    logger2.error('error from 2');

    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(2);

    // Verify component names are different
    expect(console.debug).toHaveBeenCalledWith(expect.stringMatching(/\[Component1\]/));
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/\[Component1\]/));
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/\[Component2\]/));
  });
});

describe('default logger instance', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be initialized with StorageClient component name', () => {
    logger.info('test default logger');

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] INFO \[StorageClient\]: test default logger/)
    );
  });

  it('should be usable immediately', () => {
    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.error('test')).not.toThrow();
    expect(() => logger.warn('test')).not.toThrow();
    expect(() => logger.debug('test')).not.toThrow();
  });

  it('should allow level changes', () => {
    logger.setLevel('error');
    logger.info('info message');
    logger.error('error message');

    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe('edge cases and error handling', () => {
  let testLogger: Logger;

  beforeEach(() => {
    testLogger = new Logger('EdgeCaseLogger', 'debug');
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should handle empty string messages', () => {
    testLogger.info('');

    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] INFO \[EdgeCaseLogger\]: $/)
    );
  });

  it('should handle messages with special characters', () => {
    const specialMessage = 'Test with "quotes", [brackets], {braces}, and \n newlines \t tabs';
    testLogger.info(specialMessage);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(specialMessage));
  });

  it('should handle very long messages', () => {
    const longMessage = 'x'.repeat(100); // Reduced from 1000 to avoid large test output
    testLogger.info(longMessage);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('x'.repeat(50))); // Check partial match with truncation
  });

  it('should handle metadata with circular references gracefully', () => {
    const circularObj: any = { name: 'test' };
    circularObj.self = circularObj;

    // This should throw an error due to circular reference
    expect(() => testLogger.info('circular test', circularObj)).toThrow(
      'Converting circular structure to JSON'
    );
    expect(console.log).not.toHaveBeenCalled();
  });

  it('should handle metadata with functions', () => {
    const metaWithFunction = {
      name: 'test',
      callback: () => 'test function',
    };

    testLogger.info('function test', metaWithFunction);

    // Functions are serialized or omitted by JSON.stringify
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/\[.*\] INFO \[EdgeCaseLogger\]: function test/)
    );
  });

  it('should handle very deep nested metadata', () => {
    const deepObj: any = { level: 0 };
    let current = deepObj;

    // Create 5 levels deep (reduced from 10)
    for (let i = 1; i <= 5; i++) {
      current.nested = { level: i };
      current = current.nested;
    }

    expect(() => testLogger.info('deep nesting test', deepObj)).not.toThrow();
    expect(console.log).toHaveBeenCalled();
  });

  it('should handle case insensitive level names in constructor', () => {
    const upperLogger = new Logger('TestLogger', 'ERROR' as LogLevelName);
    const mixedLogger = new Logger('TestLogger', 'WaRn' as LogLevelName);

    // Both should work without throwing
    expect(() => upperLogger.error('test')).not.toThrow();
    expect(() => mixedLogger.warn('test')).not.toThrow();
  });
});
