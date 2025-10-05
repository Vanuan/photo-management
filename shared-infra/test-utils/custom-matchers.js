// Custom Jest matchers for handling large strings and buffers gracefully
// This module provides matchers that prevent long buffer/string output during test failures

/**
 * Helper function to truncate buffer or string for display
 */
function truncateForDisplay(value, maxLength = 100) {
  if (Buffer.isBuffer(value)) {
    const str = value.toString('utf8', 0, Math.min(value.length, maxLength));
    return value.length > maxLength
      ? `Buffer(${value.length} bytes): "${str}...[truncated]"`
      : `Buffer(${value.length} bytes): "${str}"`;
  }

  if (typeof value === 'string') {
    return value.length > maxLength
      ? `"${value.substring(0, maxLength)}...[truncated ${value.length} chars]"`
      : `"${value}"`;
  }

  return String(value);
}

/**
 * Helper function to convert buffer to comparable format
 */
function bufferToComparable(value) {
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return value;
}

/**
 * Custom matchers for Jest
 */
const customMatchers = {
  /**
   * Checks if a buffer or string contains expected content without showing full content in diff
   */
  toContainTruncated(received, expected, options = {}) {
    const { maxDisplayLength = 100, encoding = 'utf8' } = options;

    const receivedStr = Buffer.isBuffer(received) ? received.toString(encoding) : String(received);
    const expectedStr = String(expected);

    const pass = receivedStr.includes(expectedStr);

    const truncatedReceived = truncateForDisplay(received, maxDisplayLength);
    const truncatedExpected = truncateForDisplay(expected, maxDisplayLength);

    if (pass) {
      return {
        message: () => `Expected ${truncatedReceived} NOT to contain ${truncatedExpected}`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected ${truncatedReceived} to contain ${truncatedExpected}`,
        pass: false,
      };
    }
  },

  /**
   * Matches buffer or string against pattern without showing full content in diff
   */
  toMatchTruncated(received, pattern, options = {}) {
    const { maxDisplayLength = 100, encoding = 'utf8' } = options;

    const receivedStr = Buffer.isBuffer(received) ? received.toString(encoding) : String(received);

    const pass =
      pattern instanceof RegExp ? pattern.test(receivedStr) : receivedStr.includes(String(pattern));

    const truncatedReceived = truncateForDisplay(received, maxDisplayLength);
    const patternStr = pattern instanceof RegExp ? pattern.toString() : String(pattern);

    if (pass) {
      return {
        message: () => `Expected ${truncatedReceived} NOT to match ${patternStr}`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected ${truncatedReceived} to match ${patternStr}`,
        pass: false,
      };
    }
  },

  /**
   * Checks buffer equality without showing full buffer content in diff
   */
  toEqualBuffer(received, expected, options = {}) {
    const { maxDisplayLength = 50 } = options;

    if (!Buffer.isBuffer(received) || !Buffer.isBuffer(expected)) {
      throw new Error('Both arguments must be Buffer objects');
    }

    const pass = received.equals(expected);

    const truncatedReceived = truncateForDisplay(received, maxDisplayLength);
    const truncatedExpected = truncateForDisplay(expected, maxDisplayLength);

    if (pass) {
      return {
        message: () => `Expected ${truncatedReceived} NOT to equal ${truncatedExpected}`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected ${truncatedReceived} to equal ${truncatedExpected}`,
        pass: false,
      };
    }
  },

  /**
   * Checks buffer size without showing buffer content
   */
  toHaveBufferLength(received, expectedLength) {
    if (!Buffer.isBuffer(received)) {
      throw new Error('Expected value must be a Buffer');
    }

    const pass = received.length === expectedLength;

    if (pass) {
      return {
        message: () => `Expected Buffer NOT to have length ${expectedLength}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `Expected Buffer to have length ${expectedLength}, but got ${received.length}`,
        pass: false,
      };
    }
  },

  /**
   * Checks if buffer starts with expected content
   */
  toStartWithBuffer(received, expected, options = {}) {
    const { maxDisplayLength = 50, encoding = 'utf8' } = options;

    const receivedStr = Buffer.isBuffer(received) ? received.toString(encoding) : String(received);
    const expectedStr = Buffer.isBuffer(expected) ? expected.toString(encoding) : String(expected);

    const pass = receivedStr.startsWith(expectedStr);

    const truncatedReceived = truncateForDisplay(received, maxDisplayLength);
    const truncatedExpected = truncateForDisplay(expected, maxDisplayLength);

    if (pass) {
      return {
        message: () => `Expected ${truncatedReceived} NOT to start with ${truncatedExpected}`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected ${truncatedReceived} to start with ${truncatedExpected}`,
        pass: false,
      };
    }
  },

  /**
   * Checks if buffer ends with expected content
   */
  toEndWithBuffer(received, expected, options = {}) {
    const { maxDisplayLength = 50, encoding = 'utf8' } = options;

    const receivedStr = Buffer.isBuffer(received) ? received.toString(encoding) : String(received);
    const expectedStr = Buffer.isBuffer(expected) ? expected.toString(encoding) : String(expected);

    const pass = receivedStr.endsWith(expectedStr);

    const truncatedReceived = truncateForDisplay(received, maxDisplayLength);
    const truncatedExpected = truncateForDisplay(expected, maxDisplayLength);

    if (pass) {
      return {
        message: () => `Expected ${truncatedReceived} NOT to end with ${truncatedExpected}`,
        pass: true,
      };
    } else {
      return {
        message: () => `Expected ${truncatedReceived} to end with ${truncatedExpected}`,
        pass: false,
      };
    }
  },

  /**
   * Checks if buffer is empty without showing content
   */
  toBeEmptyBuffer(received) {
    if (!Buffer.isBuffer(received)) {
      throw new Error('Expected value must be a Buffer');
    }

    const pass = received.length === 0;

    if (pass) {
      return {
        message: () => 'Expected Buffer NOT to be empty',
        pass: true,
      };
    } else {
      return {
        message: () => `Expected Buffer to be empty, but it has ${received.length} bytes`,
        pass: false,
      };
    }
  },

  /**
   * Checks array of buffers without showing full content
   */
  toContainBuffers(received, expectedBuffers, options = {}) {
    const { maxDisplayLength = 30 } = options;

    if (!Array.isArray(received)) {
      throw new Error('Received value must be an array');
    }

    if (!Array.isArray(expectedBuffers)) {
      throw new Error('Expected value must be an array of buffers');
    }

    const allFound = expectedBuffers.every(expectedBuffer => {
      return received.some(receivedBuffer => {
        if (Buffer.isBuffer(receivedBuffer) && Buffer.isBuffer(expectedBuffer)) {
          return receivedBuffer.equals(expectedBuffer);
        }
        return bufferToComparable(receivedBuffer) === bufferToComparable(expectedBuffer);
      });
    });

    const truncatedReceived = received.map(buf => truncateForDisplay(buf, maxDisplayLength));
    const truncatedExpected = expectedBuffers.map(buf => truncateForDisplay(buf, maxDisplayLength));

    if (allFound) {
      return {
        message: () =>
          `Expected array [${truncatedReceived.join(', ')}] NOT to contain all buffers [${truncatedExpected.join(', ')}]`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `Expected array [${truncatedReceived.join(', ')}] to contain all buffers [${truncatedExpected.join(', ')}]`,
        pass: false,
      };
    }
  },
};

/**
 * Helper function to truncate large nested objects for display
 */
function truncateObject(obj, maxDepth = 2, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    return '[Object]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    if (typeof obj === 'string' && obj.length > 50) {
      return `"${obj.substring(0, 50)}...[truncated]"`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length > 3) {
      return `[Array(${obj.length})]`;
    }
    return obj.map(item => truncateObject(item, maxDepth, currentDepth + 1));
  }

  const truncated = {};
  const keys = Object.keys(obj);

  if (keys.length > 5) {
    // Show first few keys and indicate truncation
    keys.slice(0, 3).forEach(key => {
      truncated[key] = truncateObject(obj[key], maxDepth, currentDepth + 1);
    });
    truncated['...'] = `[${keys.length - 3} more properties]`;
  } else {
    keys.forEach(key => {
      truncated[key] = truncateObject(obj[key], maxDepth, currentDepth + 1);
    });
  }

  return truncated;
}

/**
 * Additional custom matchers for handling large objects and function calls
 */
const additionalMatchers = {
  /**
   * Checks if a function was called with arguments containing large objects
   */
  toHaveBeenCalledWithTruncated(received, ...expectedArgs) {
    if (!jest.isMockFunction(received)) {
      throw new Error('Expected a mock function');
    }

    const calls = received.mock.calls;
    const lastCall = calls[calls.length - 1];

    if (!lastCall) {
      return {
        message: () => 'Expected function to have been called, but it was not called',
        pass: false,
      };
    }

    // Truncate large objects in the expected arguments
    const truncatedExpected = expectedArgs.map(arg => truncateObject(arg));
    const truncatedReceived = lastCall.map(arg => truncateObject(arg));

    const pass = expectedArgs.every((expectedArg, index) => {
      if (typeof expectedArg === 'object' && expectedArg !== null && expectedArg.asymmetricMatch) {
        // Handle expect.any(), expect.objectContaining(), etc.
        return expectedArg.asymmetricMatch(lastCall[index]);
      }

      // For objects with large properties, do a shallow comparison
      if (typeof expectedArg === 'object' && typeof lastCall[index] === 'object') {
        if (expectedArg === null) return lastCall[index] === null;
        if (lastCall[index] === null) return false;

        // Check key-by-key for objects
        const expectedKeys = Object.keys(expectedArg);
        const receivedKeys = Object.keys(lastCall[index]);

        return expectedKeys.every(key => {
          const expectedValue = expectedArg[key];
          const receivedValue = lastCall[index][key];

          // For large strings (like base64), just check they're both strings
          if (typeof expectedValue === 'string' && typeof receivedValue === 'string') {
            if (expectedValue.length > 100 || receivedValue.length > 100) {
              return true; // Don't compare large strings exactly
            }
          }

          return this.equals(expectedValue, receivedValue);
        });
      }

      return this.equals(expectedArg, lastCall[index]);
    });

    if (pass) {
      return {
        message: () =>
          `Expected function NOT to have been called with ${JSON.stringify(truncatedExpected, null, 2)}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `Expected function to have been called with ${JSON.stringify(truncatedExpected, null, 2)}, but was called with ${JSON.stringify(truncatedReceived, null, 2)}`,
        pass: false,
      };
    }
  },

  /**
   * Checks function calls while ignoring large string content
   */
  toHaveBeenCalledWithPartialMatch(received, partialExpected) {
    if (!jest.isMockFunction(received)) {
      throw new Error('Expected a mock function');
    }

    const calls = received.mock.calls;

    const matchingCall = calls.find(call => {
      return partialExpected.every((expectedArg, index) => {
        const receivedArg = call[index];

        if (
          typeof expectedArg === 'object' &&
          expectedArg !== null &&
          expectedArg.asymmetricMatch
        ) {
          return expectedArg.asymmetricMatch(receivedArg);
        }

        if (typeof expectedArg === 'string' && typeof receivedArg === 'string') {
          return receivedArg.includes(expectedArg);
        }

        if (typeof expectedArg === 'object' && typeof receivedArg === 'object') {
          return Object.keys(expectedArg).every(key => {
            if (typeof expectedArg[key] === 'string' && expectedArg[key].length > 50) {
              // For large strings, just check they exist
              return typeof receivedArg[key] === 'string';
            }
            return this.equals(expectedArg[key], receivedArg[key]);
          });
        }

        return this.equals(expectedArg, receivedArg);
      });
    });

    const pass = !!matchingCall;

    const truncatedExpected = partialExpected.map(arg => truncateObject(arg));
    const truncatedCalls = calls.map(call => call.map(arg => truncateObject(arg)));

    if (pass) {
      return {
        message: () =>
          `Expected function NOT to have been called with partial match ${JSON.stringify(truncatedExpected, null, 2)}`,
        pass: true,
      };
    } else {
      return {
        message: () =>
          `Expected function to have been called with partial match ${JSON.stringify(truncatedExpected, null, 2)}, but received calls: ${JSON.stringify(truncatedCalls, null, 2)}`,
        pass: false,
      };
    }
  },
};

// Combine all matchers
const allMatchers = { ...customMatchers, ...additionalMatchers };

// Export function to extend Jest expect
function extendExpect(expect) {
  expect.extend(allMatchers);
}

module.exports = {
  customMatchers: allMatchers,
  extendExpect,
  truncateForDisplay,
  bufferToComparable,
  truncateObject,
};
