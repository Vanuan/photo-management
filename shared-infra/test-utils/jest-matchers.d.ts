// TypeScript definitions for custom Jest matchers
// This extends the Jest expect interface with our custom buffer and string matchers

declare global {
  namespace jest {
    interface Matchers<R> {
      /**
       * Checks if a buffer or string contains expected content without showing full content in diff
       * @param expected - The content to search for
       * @param options - Options for display and encoding
       */
      toContainTruncated(expected: string | Buffer, options?: {
        maxDisplayLength?: number;
        encoding?: BufferEncoding;
      }): R;

      /**
       * Matches buffer or string against pattern without showing full content in diff
       * @param pattern - RegExp or string pattern to match
       * @param options - Options for display and encoding
       */
      toMatchTruncated(pattern: RegExp | string, options?: {
        maxDisplayLength?: number;
        encoding?: BufferEncoding;
      }): R;

      /**
       * Checks buffer equality without showing full buffer content in diff
       * @param expected - Expected buffer
       * @param options - Options for display
       */
      toEqualBuffer(expected: Buffer, options?: {
        maxDisplayLength?: number;
      }): R;

      /**
       * Checks buffer size without showing buffer content
       * @param expectedLength - Expected buffer length in bytes
       */
      toHaveBufferLength(expectedLength: number): R;

      /**
       * Checks if buffer starts with expected content
       * @param expected - Expected prefix content (string or buffer)
       * @param options - Options for display and encoding
       */
      toStartWithBuffer(expected: string | Buffer, options?: {
        maxDisplayLength?: number;
        encoding?: BufferEncoding;
      }): R;

      /**
       * Checks if buffer ends with expected content
       * @param expected - Expected suffix content (string or buffer)
       * @param options - Options for display and encoding
       */
      toEndWithBuffer(expected: string | Buffer, options?: {
        maxDisplayLength?: number;
        encoding?: BufferEncoding;
      }): R;

      /**
       * Checks if buffer is empty without showing content
       */
      toBeEmptyBuffer(): R;

      /**
       * Checks array of buffers without showing full content
       * @param expectedBuffers - Array of expected buffers
       * @param options - Options for display
       */
      toContainBuffers(expectedBuffers: (Buffer | string)[], options?: {
        maxDisplayLength?: number;
      }): R;

      /**
       * Checks if a mock function was called with arguments containing large objects,
       * showing truncated output on failure
       * @param expectedArgs - Expected arguments with truncated display
       */
      toHaveBeenCalledWithTruncated(...expectedArgs: any[]): R;

      /**
       * Checks function calls while ignoring large string content and doing partial matching
       * @param partialExpected - Partial expected arguments
       */
      toHaveBeenCalledWithPartialMatch(partialExpected: any[]): R;
    }
  }
}

// This file needs to be empty export to be treated as a module
export {};
