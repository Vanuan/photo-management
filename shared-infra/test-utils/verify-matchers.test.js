// Test to verify custom matchers are working and provide better output for buffer failures
// This test is designed to show the difference between regular matchers and our custom ones

const {
  TEST_DATA_BASE64,
  TEST_BUFFERS,
  TEST_HELPERS,
} = require('./test-data');

describe('Custom Matcher Verification', () => {
  describe('Buffer Matchers Working Correctly', () => {
    it('should use toEqualBuffer for successful buffer comparison', () => {
      const buffer1 = Buffer.from('test data');
      const buffer2 = Buffer.from('test data');

      // This should pass with clean output
      expect(buffer1).toEqualBuffer(buffer2);
    });

    it('should use toHaveBufferLength for size checks', () => {
      const testBuffer = TEST_BUFFERS.PNG_IMAGE;

      // This should pass - PNG image is 67 bytes
      expect(testBuffer).toHaveBufferLength(67);
    });

    it('should use toContainTruncated for strings with potential long content', () => {
      const mediumString = 'A'.repeat(200) + 'needle' + 'B'.repeat(200);

      // This should pass with truncated output if it fails
      expect(mediumString).toContainTruncated('needle');
    });

    it('should use toStartWithBuffer for buffer prefix checks', () => {
      const pngBuffer = TEST_BUFFERS.PNG_IMAGE;

      // PNG files start with specific bytes
      expect(pngBuffer).toStartWithBuffer(Buffer.from([0x89, 0x50, 0x4E, 0x47])); // PNG signature
    });
  });

  describe('Demonstrate Improved Error Messages (commented out failures)', () => {
    it('should show how custom matchers provide better error output', () => {
      const largeBuffer = TEST_HELPERS.createBuffer(1000, 'pattern');
      const wrongBuffer = TEST_HELPERS.createBuffer(1000, 'different');

      // ✅ This passes - just showing usage
      expect(largeBuffer).toHaveBufferLength(1000);

      // ❌ These would fail with better error messages (commented out):
      // expect(largeBuffer).toEqualBuffer(wrongBuffer);
      // Would show: "Expected Buffer(1000 bytes): 'pattern...[truncated]' to equal Buffer(1000 bytes): 'different...[truncated]'"

      // Instead of regular matcher that would show full 1000+ character diff:
      // expect(largeBuffer).toEqual(wrongBuffer);
    });

    it('should demonstrate string truncation benefits', () => {
      const longString = 'A'.repeat(500) + 'important content' + 'B'.repeat(500);

      // ✅ This passes
      expect(longString).toContainTruncated('important content');

      // ❌ This would fail with truncated output (commented out):
      // expect(longString).toContainTruncated('missing content');
      // Would show: "Expected 'AAAA...[truncated 1017 chars]' to contain 'missing content'"

      // Instead of regular matcher showing all 1017 characters:
      // expect(longString).toContain('missing content');
    });
  });

  describe('Test Data Constants Usage', () => {
    it('should use constants instead of inline data', () => {
      // ✅ Good - uses constants
      const imageBuffer = Buffer.from(TEST_DATA_BASE64.SMALL_PNG, 'base64');
      expect(imageBuffer).toEqualBuffer(TEST_BUFFERS.PNG_IMAGE);

      // ❌ Bad - inline long string (what we're avoiding):
      // const inlineBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
    });

    it('should use helpers for dynamic test data', () => {
      const customBuffer = TEST_HELPERS.createBuffer(100, 'test');

      expect(customBuffer).toHaveBufferLength(100);
      expect(customBuffer).toStartWithBuffer('test');
      expect(customBuffer).toEndWithBuffer('test'); // Pattern repeats
    });
  });

  describe('Array Buffer Handling', () => {
    it('should handle arrays of buffers cleanly', () => {
      const bufferArray = [
        TEST_BUFFERS.SMALL,
        TEST_BUFFERS.PNG_IMAGE,
        Buffer.from('third')
      ];

      const expectedBuffers = [TEST_BUFFERS.SMALL];

      expect(bufferArray).toContainBuffers(expectedBuffers);
    });
  });

  describe('Options and Customization', () => {
    it('should respect maxDisplayLength option', () => {
      const mediumString = 'X'.repeat(150);

      // Should truncate to 50 characters if it fails
      expect(mediumString).toContainTruncated('X', { maxDisplayLength: 50 });
    });

    it('should handle different encodings for buffers', () => {
      const utf16Buffer = Buffer.from('test string', 'utf16le');

      expect(utf16Buffer).toContainTruncated('test', { encoding: 'utf16le' });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty buffers gracefully', () => {
      const emptyBuffer = Buffer.alloc(0);

      expect(emptyBuffer).toBeEmptyBuffer();
      expect(emptyBuffer).toHaveBufferLength(0);
    });

    it('should handle mixed string and buffer comparisons', () => {
      const textBuffer = Buffer.from('hello world');

      expect(textBuffer).toContainTruncated('hello');
      expect(textBuffer).toStartWithBuffer('hello');
      expect(textBuffer).toEndWithBuffer('world');
    });
  });

  describe('Performance Impact', () => {
    it('should not significantly impact test performance', () => {
      const start = Date.now();

      // Perform multiple custom matcher operations
      for (let i = 0; i < 100; i++) {
        const testBuffer = Buffer.from(`test ${i}`);
        expect(testBuffer).toHaveBufferLength(testBuffer.length);
        expect(testBuffer).toContainTruncated('test');
      }

      const duration = Date.now() - start;

      // Should complete reasonably quickly
      expect(duration).toBeLessThan(1000); // 1 second max
    });
  });
});

// Helper to demonstrate what output looks like in a controlled way
describe('Output Examples (Safe Demonstrations)', () => {
  it('shows what truncated output looks like', () => {
    const { truncateForDisplay } = require('./custom-matchers');

    const longBuffer = Buffer.from('A'.repeat(200));
    const truncated = truncateForDisplay(longBuffer, 50);

    // Verify our truncation helper works
    expect(truncated).toContain('Buffer(200 bytes)');
    expect(truncated).toContain('[truncated]');
    expect(truncated.length).toBeLessThan(100); // Much shorter than original
  });

  it('shows string truncation format', () => {
    const { truncateForDisplay } = require('./custom-matchers');

    const longString = 'B'.repeat(300);
    const truncated = truncateForDisplay(longString, 50);

    expect(truncated).toContain('[truncated 300 chars]');
    expect(truncated.length).toBeLessThan(100);
  });
});
