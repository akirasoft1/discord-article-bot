// ===== services/SourceCredibilityService.js =====
const logger = require('../logger');

class SourceCredibilityService {
  constructor(config) {
    this.config = config;
  }

  /**
   * Rates the credibility of a given URL's source.
   * @param {string} url - The URL to evaluate.
   * @returns {string} - A string representing the star rating (e.g., "⭐⭐⭐⭐⭐").
   */
  rateSource(url) {
    if (!this.config.bot.sourceCredibility.enabled) {
      return '';
    }

    const { trustedSources } = this.config.bot.sourceCredibility;
    if (!trustedSources || Object.keys(trustedSources).length === 0) {
      return '';
    }

    try {
      const { hostname } = new URL(url);
      let rating = 0;

      for (const domain in trustedSources) {
        if (hostname.includes(domain)) {
          rating = trustedSources[domain];
          break;
        }
      }

      if (rating > 0) {
        return '⭐'.repeat(rating);
      } else {
        // Default to a neutral rating if not explicitly trusted
        return '⭐⭐'; 
      }
    } catch (error) {
      logger.error(`Invalid URL for source credibility check: ${url}`);
      return '';
    }
  }
}

module.exports = SourceCredibilityService;
