// ===== utils/textUtils.js =====
const logger = require('../logger');

class TextUtils {
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
