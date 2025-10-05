// Example test file showing proper usage of custom matchers for Buffer handling
// This demonstrates how to avoid long string output during test failures

const {
  TEST_DATA_BASE64,
  TEST_BUFFERS,
  MOCK_PHOTOS,
  LONG_STRINGS,
  TEST_HELPERS,
} = require('./test-data');

describe('Custom Matcher Usage Examples', () => {
  describe('Buffer Matchers', () => {
    it('should use toEqualBuffer for buffer comparisons', () => {
      const buffer1 = Buffer.from('test data');
      const buffer2 = Buffer.from('test data');
      const buffer3 = Buffer.from('different data');

      // ✅ Good - uses custom matcher that truncates output on failure
      expect(buffer1).toEqualBuffer(buffer2);

      // ❌ This would show full buffer content on failure
      // expect(buffer1).toEqual(buffer2);

      // Test failure case (commented out to avoid actual failure)
      // expect(buffer1).toEqualBuffer(buffer3); // Would show truncated diff
    });

    it('should use toHaveBufferLength for size checks', () => {
      const testBuffer = TEST_BUFFERS.SMALL;

      // ✅ Good - checks size without showing buffer content
      expect(testBuffer).toHaveBufferLength(9); // "test data" = 9 bytes

      // ❌ This would show buffer content on failure
      // expect(testBuffer.length).toBe(9);
    });

    it('should use toBeEmptyBuffer for empty buffer checks', () => {
      const emptyBuffer = Buffer.alloc(0);
      const nonEmptyBuffer = Buffer.from('data');

      // ✅ Good - clean empty check
      expect(emptyBuffer).toBeEmptyBuffer();

      // Test failure case (commented out)
      // expect(nonEmptyBuffer).toBeEmptyBuffer(); // Clean error message
    });

    it('should use toStartWithBuffer and toEndWithBuffer for partial matches', () => {
      const fullBuffer = Buffer.from('test data here');
      const startBuffer = Buffer.from('test');
      const endBuffer = Buffer.from('here');

      // ✅ Good - checks without showing full content
      expect(fullBuffer).toStartWithBuffer(startBuffer);
      expect(fullBuffer).toEndWithBuffer(endBuffer);

      // Also works with strings
      expect(fullBuffer).toStartWithBuffer('test');
      expect(fullBuffer).toEndWithBuffer('here');
    });
  });

  describe('String Matchers', () => {
    it('should use toContainTruncated for long strings', () => {
      const longString = 'A'.repeat(1000) + 'needle' + 'B'.repeat(1000);

      // ✅ Good - will truncate output on failure
      expect(longString).toContainTruncated('needle');

      // ❌ This would show the full 2005 character string on failure
      // expect(longString).toContain('needle');

      // Test failure case (commented out)
      // expect(longString).toContainTruncated('missing'); // Shows truncated string
    });

    it('should use toMatchTruncated for regex patterns on long strings', () => {
      const longUrl = LONG_STRINGS.COMPLEX_URL;

      // ✅ Good - matches without showing full URL on failure
      expect(longUrl).toMatchTruncated(/^https:\/\/example\.com/);
      expect(longUrl).toMatchTruncated('example.com');

      // Test failure case (commented out)
      // expect(longUrl).toMatchTruncated(/^http:\/\/wrong/); // Shows truncated URL
    });
  });

  describe('Working with Test Data Constants', () => {
    it('should use constants instead of inline base64', () => {
      // ✅ Good - uses constants
      const imageData = Buffer.from(TEST_DATA_BASE64.SMALL_PNG, 'base64');
      expect(imageData).toHaveBufferLength(67); // Known size of 1x1 PNG

      // ✅ Good - uses pre-made buffers
      const photoBuffer = TEST_BUFFERS.PNG_IMAGE;
      expect(photoBuffer).toEqualBuffer(imageData);

      // ❌ Avoid inline long base64 strings
      // const inlineBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
    });

    it('should use helper functions for dynamic test data', () => {
      // ✅ Good - uses helpers
      const largeBuffer = TEST_HELPERS.createBuffer(1024, 'pattern');
      expect(largeBuffer).toHaveBufferLength(1024);
      expect(largeBuffer).toStartWithBuffer('pattern');

      const base64Data = TEST_HELPERS.toBase64('test string');
      expect(base64Data).toBe('dGVzdCBzdHJpbmc=');
    });
  });

  describe('Array of Buffers', () => {
    it('should use toContainBuffers for buffer arrays', () => {
      const bufferArray = [
        Buffer.from('first'),
        Buffer.from('second'),
        Buffer.from('third')
      ];

      const expectedBuffers = [
        Buffer.from('first'),
        Buffer.from('second')
      ];

      // ✅ Good - checks array without showing all buffer contents
      expect(bufferArray).toContainBuffers(expectedBuffers);

      // Test failure case (commented out)
      // const missingBuffers = [Buffer.from('missing')];
      // expect(bufferArray).toContainBuffers(missingBuffers); // Clean error message
    });
  });

  describe('Integration with Mock Data', () => {
    it('should combine custom matchers with mock data', () => {
      // Simulate an API response with photo data
      const mockApiCall = jest.fn().mockResolvedValue({
        data: MOCK_PHOTOS.BASIC,
        buffer: TEST_BUFFERS.PHOTO_DATA
      });

      return mockApiCall().then(response => {
        expect(response.data).toEqual(MOCK_PHOTOS.BASIC);
        expect(response.buffer).toHaveBufferLength(TEST_BUFFERS.PHOTO_DATA.length);
        expect(response.buffer).toEqualBuffer(TEST_BUFFERS.PHOTO_DATA);
      });
    });
  });

  describe('Common Anti-patterns to Avoid', () => {
    it('demonstrates what NOT to do', () => {
      const largeBuffer = TEST_HELPERS.createBuffer(10000, 'data');

      // ❌ BAD - These will show full buffer content on failure:
      // expect(largeBuffer).toEqual(Buffer.from('wrong'));
      // expect(largeBuffer.toString()).toContain('missing');
      // expect(largeBuffer.length).toBe(5000);

      // ✅ GOOD - These use truncated output:
      expect(largeBuffer).toEqualBuffer(TEST_HELPERS.createBuffer(10000, 'data'));
      expect(largeBuffer).toContainTruncated('data', { maxDisplayLength: 50 });
      expect(largeBuffer).toHaveBufferLength(10000);
    });
  });

  describe('Options and Customization', () => {
    it('should use options to control truncation', () => {
      const mediumString = 'A'.repeat(200);

      // Default truncation (100 chars)
      expect(mediumString).toContainTruncated('A');

      // Custom truncation length
      expect(mediumString).toContainTruncated('A', { maxDisplayLength: 50 });

      // Custom encoding for buffers
      const utf16Buffer = Buffer.from('test', 'utf16le');
      expect(utf16Buffer).toContainTruncated('test', { encoding: 'utf16le' });
    });
  });
});
