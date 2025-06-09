// ===== utils/urlUtils.js =====
const logger = require('../logger');

class UrlUtils {
  static ARCHIVE_HOSTNAMES = [
    'archive.is', 'archive.today', 'archive.ph', 'archive.li',
    'archive.vn', 'archive.md', 'archive.fo', 'archive.gg', 'archive.wiki'
  ];

  static GIF_HOSTS = ['tenor.com', 'giphy.com', 'imgur.com'];
  static IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];

  static isArchiveUrl(urlString) {
    try {
      const url = new URL(urlString);
      return this.ARCHIVE_HOSTNAMES.includes(url.hostname);
    } catch (error) {
      logger.warn(`Invalid URL: ${urlString} - ${error.message}`);
      return false;
    }
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