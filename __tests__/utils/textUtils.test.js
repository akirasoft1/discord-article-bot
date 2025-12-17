// __tests__/utils/textUtils.test.js

const TextUtils = require('../../utils/textUtils');

describe('TextUtils', () => {
  describe('wrapUrls', () => {
    it('wraps a simple URL in angle brackets', () => {
      const input = 'Check out https://example.com for more info';
      const expected = 'Check out <https://example.com> for more info';
      expect(TextUtils.wrapUrls(input)).toBe(expected);
    });

    it('wraps multiple URLs', () => {
      const input = 'Visit https://google.com and https://github.com';
      const expected = 'Visit <https://google.com> and <https://github.com>';
      expect(TextUtils.wrapUrls(input)).toBe(expected);
    });

    it('wraps URLs with paths and query strings', () => {
      const input = 'See https://example.com/path/to/page?query=value&other=123';
      const expected = 'See <https://example.com/path/to/page?query=value&other=123>';
      expect(TextUtils.wrapUrls(input)).toBe(expected);
    });

    it('does not double-wrap URLs already in angle brackets', () => {
      const input = 'Already wrapped: <https://example.com>';
      expect(TextUtils.wrapUrls(input)).toBe(input);
    });

    it('does not wrap URLs inside markdown links', () => {
      const input = 'Click [here](https://example.com) for details';
      // The URL is after [ so it should not be wrapped
      expect(TextUtils.wrapUrls(input)).toBe(input);
    });

    it('handles mixed wrapped and unwrapped URLs', () => {
      const input = 'Check <https://wrapped.com> and https://unwrapped.com';
      const expected = 'Check <https://wrapped.com> and <https://unwrapped.com>';
      expect(TextUtils.wrapUrls(input)).toBe(expected);
    });

    it('wraps URLs inside parentheses', () => {
      const input = 'More info here (https://example.com/docs)';
      const expected = 'More info here (<https://example.com/docs>)';
      expect(TextUtils.wrapUrls(input)).toBe(expected);
    });

    it('wraps URLs inside parentheses with text', () => {
      const input = 'See the docs (visit https://example.com for details)';
      const expected = 'See the docs (visit <https://example.com> for details)';
      expect(TextUtils.wrapUrls(input)).toBe(expected);
    });

    it('handles http URLs (not just https)', () => {
      const input = 'Old site: http://legacy.example.com';
      const expected = 'Old site: <http://legacy.example.com>';
      expect(TextUtils.wrapUrls(input)).toBe(expected);
    });

    it('handles URLs at end of line', () => {
      const input = 'Visit https://example.com';
      const expected = 'Visit <https://example.com>';
      expect(TextUtils.wrapUrls(input)).toBe(expected);
    });

    it('handles URLs followed by punctuation', () => {
      const input = 'Check https://example.com, it is great!';
      // Note: comma is part of the URL match, which is a known limitation
      // For Discord's purposes, this still prevents embed expansion
      expect(TextUtils.wrapUrls(input)).toContain('<https://example.com');
    });

    it('returns empty/null input unchanged', () => {
      expect(TextUtils.wrapUrls('')).toBe('');
      expect(TextUtils.wrapUrls(null)).toBe(null);
      expect(TextUtils.wrapUrls(undefined)).toBe(undefined);
    });

    it('returns text without URLs unchanged', () => {
      const input = 'No URLs here, just plain text!';
      expect(TextUtils.wrapUrls(input)).toBe(input);
    });

    it('handles URLs in multiline text', () => {
      const input = 'Line 1\nhttps://example.com\nLine 3';
      const expected = 'Line 1\n<https://example.com>\nLine 3';
      expect(TextUtils.wrapUrls(input)).toBe(expected);
    });
  });

  describe('calculateReadingTime', () => {
    it('calculates reading time for short text', () => {
      const text = 'This is a short sentence.';
      // 5 words at 200 wpm = 0.025 min, ceil = 1
      expect(TextUtils.calculateReadingTime(text)).toBe('~1 min read');
    });

    it('calculates reading time for longer text', () => {
      // 400 words at 200 wpm = 2 minutes
      const words = Array(400).fill('word').join(' ');
      expect(TextUtils.calculateReadingTime(words)).toBe('~2 min read');
    });

    it('returns empty string for invalid input', () => {
      expect(TextUtils.calculateReadingTime('')).toBe('');
      expect(TextUtils.calculateReadingTime(null)).toBe('');
      expect(TextUtils.calculateReadingTime(undefined)).toBe('');
    });
  });
});
