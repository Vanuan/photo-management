declare namespace jest {
  interface Matchers<R> {
    /**
     * Checks if a string contains the expected substring, but displays a truncated version
     * of the actual string in test output to avoid overwhelming console output with large strings.
     *
     * @param expected - The substring to search for
     * @param maxLength - Maximum length of string to display in test output (default: 100)
     *
     * @example
     * expect(largeString).toContainTruncated('needle', 50);
     */
    toContainTruncated(expected: string, maxLength?: number): R;

    /**
     * Matches a string against a pattern (RegExp or string) but displays a truncated version
     * in test output to prevent large strings from cluttering the console.
     *
     * @param pattern - RegExp pattern or string to match against
     * @param maxDisplayLength - Maximum length of string to display in output (default: 50)
     *
     * @example
     * expect(longResponse).toMatchLargeString(/^HTTP\/1\.1 200/, 30);
     * expect(bigData).toMatchLargeString('expected-prefix');
     */
    toMatchLargeString(pattern: RegExp | string, maxDisplayLength?: number): R;
  }
}

declare global {
  namespace jest {
    interface Matchers<R> {
      toContainTruncated(expected: string, maxLength?: number): R;
      toMatchLargeString(pattern: RegExp | string, maxDisplayLength?: number): R;
    }
  }
}

export {};
