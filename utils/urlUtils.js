// ===== utils/urlUtils.js =====
const logger = require('../logger');

class UrlUtils {
  // Legacy archive hostnames - kept for reference but no longer actively processed
  // Archive functionality is now handled by Linkwarden integration
  static ARCHIVE_HOSTNAMES = [
    'archive.is', 'archive.today', 'archive.ph', 'archive.li',
    'archive.vn', 'archive.md', 'archive.fo', 'archive.gg', 'archive.wiki'
  ];

  static GIF_HOSTS = ['tenor.com', 'giphy.com', 'imgur.com'];
  static IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];

  /**
   * Check if URL is from a legacy archive service
   * Note: Archive.today/archive.is integration is deprecated in favor of Linkwarden
   * This method is kept for backward compatibility but always returns false
   * when Linkwarden integration is enabled
   */
  static isArchiveUrl(urlString) {
    // Archive URL handling is deprecated - return false to skip special processing
    // URLs are now archived through Linkwarden browser extension
    return false;
  }

  static isGifHost(url) {
    return this.GIF_HOSTS.some(host => url.toLowerCase().includes(host));
  }

  static isImageUrl(url) {
    return this.IMAGE_EXTENSIONS.some(ext => url.toLowerCase().endsWith(ext));
  }

  static shouldSkipUrl(url) {
    return this.isGifHost(url) || this.isImageUrl(url);
  }

  static extractUrlsFromText(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.match(urlRegex) || [];
  }
}

module.exports = UrlUtils;