// ===== utils/textUtils.js =====
const logger = require('../logger');

// URL regex pattern - matches http/https URLs
// Negative lookbehind: not preceded by < or ](
// Negative lookahead: not followed by > or )
const URL_PATTERN = /(?<![<]|\]\()(?<!\[.*\]\()(https?:\/\/[^\s<>\[\]()]+)(?![>\)])/g;

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
    return text.replace(URL_PATTERN, '<$1>');
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
