# Test Utilities

This directory contains shared utilities for testing across the photo management storage packages. The utilities are designed to solve common testing problems, particularly around handling large strings and buffers that create unreadable test output.

## Problem Statement

When testing with buffers, long strings, or base64 data, Jest's default diff output can become overwhelming and unreadable. For example:

```javascript
// BAD: This creates massive diff output on failure
const largeBuffer = Buffer.from('very long base64 string here...');
expect(receivedBuffer).toEqual(largeBuffer); // Shows full buffer content
```

## Solution

This package provides custom Jest matchers and test data constants that truncate output while maintaining test functionality.

## Files

- **`custom-matchers.js`** - Custom Jest matchers for handling buffers and long strings
- **`test-data.js`** - Reusable test data constants to avoid inline long strings
- **`example-usage.test.js`** - Examples of proper usage patterns
- **`README.md`** - This documentation

## Custom Matchers

### Buffer Matchers

#### `toEqualBuffer(expected, options?)`
Compares two buffers for equality without showing full content in diff.

```javascript
expect(buffer1).toEqualBuffer(buffer2);
// On failure: "Expected Buffer(1024 bytes): 'test...[truncated]' to equal Buffer(512 bytes): 'other...[truncated]'"
```

#### `toHaveBufferLength(expectedLength)`
Checks buffer length without showing buffer content.

```javascript
expect(imageBuffer).toHaveBufferLength(1024);
// On failure: "Expected Buffer to have length 1024, but got 2048"
```

#### `toBeEmptyBuffer()`
Checks if buffer is empty.

```javascript
expect(buffer).toBeEmptyBuffer();
// On failure: "Expected Buffer to be empty, but it has 256 bytes"
```

#### `toStartWithBuffer(expected, options?)`
Checks if buffer starts with expected content.

```javascript
expect(fullBuffer).toStartWithBuffer('PNG'); // String or Buffer
```

#### `toEndWithBuffer(expected, options?)`
Checks if buffer ends with expected content.

```javascript
expect(fullBuffer).toEndWithBuffer('EOF');
```

#### `toContainBuffers(expectedBuffers, options?)`
Checks if array contains all expected buffers.

```javascript
expect(bufferArray).toContainBuffers([expectedBuffer1, expectedBuffer2]);
```

### String Matchers

#### `toContainTruncated(expected, options?)`
Checks if string/buffer contains expected content with truncated output.

```javascript
expect(longString).toContainTruncated('needle', { maxDisplayLength: 50 });
// On failure: "Expected 'very long string here...[truncated 2000 chars]' to contain 'needle'"
```

#### `toMatchTruncated(pattern, options?)`
Matches string/buffer against pattern with truncated output.

```javascript
expect(longUrl).toMatchTruncated(/^https:\/\/example\.com/);
```

### Options

All matchers support options:

```javascript
{
  maxDisplayLength: 100,  // Characters to show before truncation
  encoding: 'utf8'        // Buffer encoding (for buffer matchers)
}
```

## Test Data Constants

### Available Constants

```javascript
const {
  TEST_DATA_BASE64,     // Base64 encoded test data
  TEST_BUFFERS,         // Pre-made Buffer objects
  MOCK_PHOTOS,          // Mock photo objects
  MOCK_STORE_OPTIONS,   // Mock store options
  MOCK_API_RESPONSES,   // Mock API response objects
  LONG_STRINGS,         // Long strings/patterns for testing
  TEST_HELPERS          // Helper functions
} = require('./test-data');
```

### Examples

```javascript
// Use constants instead of inline base64
const imageData = Buffer.from(TEST_DATA_BASE64.SMALL_PNG, 'base64');

// Or use pre-made buffers
const photoBuffer = TEST_BUFFERS.PNG_IMAGE;

// Use mock objects
const mockPhoto = { ...MOCK_PHOTOS.BASIC, id: 'custom-id' };
```

## Setup

Each package should import and extend Jest expect in their `jest.setup.js`:

```javascript
// Import shared custom matchers
const { extendExpect } = require('../../test-utils/custom-matchers');

// Extend Jest expect with custom matchers
extendExpected(expect);
```

## Usage Patterns

### ✅ Good Patterns

```javascript
// Use custom matchers for buffers
expect(receivedBuffer).toEqualBuffer(expectedBuffer);
expect(largeBuffer).toHaveBufferLength(1024);
expect(responseData).toContainTruncated('expected content');

// Use constants for test data
const testImage = TEST_BUFFERS.PNG_IMAGE;
const mockResponse = MOCK_API_RESPONSES.SUCCESS;

// Use helpers for dynamic data
const largeBuffer = TEST_HELPERS.createBuffer(1024, 'pattern');
```

### ❌ Anti-patterns

```javascript
// Don't use regular matchers for large buffers
expect(largeBuffer).toEqual(expectedBuffer); // Shows full content

// Don't inline long base64 strings
const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAE...', 'base64');

// Don't check buffer length via .length property in failures
expect(buffer.length).toBe(1024); // Shows buffer content on failure
```

## Integration

The custom matchers are automatically available in all test files once properly configured in `jest.setup.js`. No additional imports needed in individual test files.

## Benefits

1. **Cleaner Test Output** - Failed tests show concise, readable diffs
2. **Faster CI/CD** - Reduced log output speeds up build pipelines
3. **Better Debugging** - Focus on actual differences, not noise
4. **Consistency** - Standardized approach across all packages
5. **Maintainability** - Centralized test data management

## Migration Guide

### From Regular Matchers

```javascript
// Before
expect(buffer1).toEqual(buffer2);
expect(longString).toContain('needle');
expect(buffer.length).toBe(1024);

// After
expect(buffer1).toEqualBuffer(buffer2);
expect(longString).toContainTruncated('needle');
expect(buffer).toHaveBufferLength(1024);
```

### From Inline Test Data

```javascript
// Before
const testData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAE...', 'base64');
const apiData = 'dGVzdCBkYXRh'; // inline comment

// After
const testData = TEST_BUFFERS.PNG_IMAGE;
const apiData = TEST_DATA_BASE64.PHOTO_DATA;
```

## Testing the Test Utils

Run the example tests to verify everything works:

```bash
npm test test-utils/example-usage.test.js
```

This will show you exactly how the matchers behave and what output to expect.