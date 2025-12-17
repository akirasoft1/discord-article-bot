// ===== utils/textUtils.js =====
const logger = require('../logger');

// URL regex pattern - matches http/https URLs
// Excludes trailing punctuation that's likely not part of the URL
const URL_PATTERN = /(https?:\/\/[^\s<>]*[^\s<>.,;:!?)\]}"'])/g;

class TextUtils {
  /**
   * Wraps URLs in angle brackets to prevent Discord auto-expansion.
   * Already-wrapped URLs (in <> or []) are left unchanged.
   * @param {string} text - The text containing URLs.
   * @returns {string} - Text with URLs wrapped in <>.
   */
  static wrapUrls(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    // Use replacement function to check context for each URL
    return text.replace(URL_PATTERN, (match, url, offset, fullString) => {
      // Check if already wrapped in angle brackets
      const charBefore = offset > 0 ? fullString[offset - 1] : '';
      const charAfter = fullString[offset + match.length] || '';

      if (charBefore === '<' && charAfter === '>') {
        return match; // Already wrapped
      }

      // Check if inside a markdown link: [text](url)
      // Look for ]( before the URL
      const before = fullString.substring(Math.max(0, offset - 10), offset);
      if (before.includes('](')) {
        // Check if there's a closing ) after - this is a markdown link
        const afterUrl = fullString.substring(offset + match.length);
        if (afterUrl.startsWith(')')) {
          return match; // Part of markdown link, don't wrap
        }
      }

      // Wrap the URL
      return `<${url}>`;
    });
  }

  /**
   * Estimates the reading time for a given text.
   * @param {string} text - The text to be evaluated.
   * @param {number} wpm - Words per minute, defaults to 200.
   * @returns {string} - A string representing the estimated reading time (e.g., "~3 min read").
   */
  static calculateReadingTime(text, wpm = 200) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    const words = text.trim().split(/\s+/).length;
    const time = Math.ceil(words / wpm);
    
    if (time < 1) {
      return '~<1 min read';
    }
    
    return `~${time} min read`;
  }
}

module.exports = TextUtils;
