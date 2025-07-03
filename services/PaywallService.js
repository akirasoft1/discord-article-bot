// ===== services/PaywallService.js =====
const logger = require('../logger');
const axios = require('axios');

class PaywallService {
  constructor() {
    this.axiosInstance = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
    });
  }

  async detectPaywall(url) {
    try {
      const response = await this.axiosInstance.get(url);
      const html = response.data;

      // A simple check for common paywall indicators
      const paywallIndicators = ['paywall', 'subscribe', 'premium', 'metered'];
      return paywallIndicators.some(indicator => html.toLowerCase().includes(indicator));
    } catch (error) {
      logger.error(`Failed to fetch for paywall detection: ${url}`, error);
      return false;
    }
  }

  async findArchiveUrl(url) {
    try {
      const archiveUrl = `https://archive.today/latest/${url}`;
      const response = await this.axiosInstance.get(archiveUrl, { maxRedirects: 0, validateStatus: (status) => status === 302 });
      return response.headers.location || null;
    } catch (error) {
      if (error.response && error.response.status === 302) {
        return error.response.headers.location;
      }
      logger.error(`Failed to find archive URL for: ${url}`, error);
      return null;
    }
  }
}

module.exports = new PaywallService();
