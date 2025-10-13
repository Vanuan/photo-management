// Jest serializer to handle large strings and objects gracefully
// This prevents overwhelming test output when dealing with base64 data or large objects

/**
 * Truncates a string to a reasonable length for test output
 */
function truncateString(str, maxLength = 100) {
  if (typeof str !== 'string' || str.length <= maxLength) {
    return str;
  }
  return `${str.substring(0, maxLength)}...[truncated ${str.length} chars]`;
}

/**
 * Truncates large objects recursively
 */
function truncateObject(obj, maxDepth = 3, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    return '[Object]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return truncateString(obj);
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length > 5) {
      return `[Array(${obj.length})]`;
    }
    return obj.map(item => truncateObject(item, maxDepth, currentDepth + 1));
  }

  if (Buffer.isBuffer(obj)) {
    const preview = obj.toString('utf8', 0, Math.min(obj.length, 50));
    return `Buffer(${obj.length} bytes): "${truncateString(preview, 50)}"`;
  }

  const truncated = {};
  const keys = Object.keys(obj);

  // Handle objects with many properties
  if (keys.length > 8) {
    keys.slice(0, 5).forEach(key => {
      truncated[key] = truncateObject(obj[key], maxDepth, currentDepth + 1);
    });
    truncated['...'] = `[${keys.length - 5} more properties]`;
  } else {
    keys.forEach(key => {
      truncated[key] = truncateObject(obj[key], maxDepth, currentDepth + 1);
    });
  }

  return truncated;
}

/**
 * Custom Jest serializer for handling large strings and objects
 */
const serializer = {
  test: (val) => {
    // Test if this value should be processed by our serializer
    if (typeof val === 'string' && val.length > 100) {
      return true;
    }

    if (Buffer.isBuffer(val)) {
      return true;
    }

    if (typeof val === 'object' && val !== null) {
      // Check if object has large string properties
      const hasLargeStrings = Object.values(val).some(value =>
        typeof value === 'string' && value.length > 100
      );

      if (hasLargeStrings) {
        return true;
      }

      // Check if object has many properties
      if (Object.keys(val).length > 8) {
        return true;
      }
    }

    return false;
  },

  serialize: (val, config, indentation, depth, refs, printer) => {
    const truncated = truncateObject(val);
    return printer(truncated, config, indentation, depth, refs);
  },
};

module.exports = serializer;
