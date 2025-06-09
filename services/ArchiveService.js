// ===== services/ArchiveService.js =====
const logger = require('../logger');

class ArchiveService {
  static transformArchiveUrl(archiveUrl) {
    try {
      const parsedUrl = new URL(archiveUrl);
      const originalUrl = this.extractOriginalUrl(parsedUrl.pathname);
      
      if (!originalUrl) {
        return this.handleShortlink(archiveUrl, parsedUrl.pathname);
      }

      const validatedUrl = this.validateOriginalUrl(originalUrl);
      if (!validatedUrl.isValid) {
        return {
          success: false,
          error: validatedUrl.error,
          userMessage: `Could not process archive link: ${archiveUrl}. ${validatedUrl.userMessage}`
        };
      }

      const resultUrl = `https://archive.today/TEXT/${validatedUrl.url}`;
      logger.info(`Transformed archive URL: ${archiveUrl} -> ${resultUrl}`);
      
      return { success: true, url: resultUrl };
    } catch (error) {
      logger.error(`Error processing archive URL ${archiveUrl}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        userMessage: `Archive link appears to be malformed: ${archiveUrl}`
      };
    }
  }

  static extractOriginalUrl(pathname) {
    const markers = ['/https://', '/http://'];
    let bestMatch = { index: -1, marker: null };

    for (const marker of markers) {
      const index = pathname.indexOf(marker);
      if (index !== -1 && (bestMatch.index === -1 || index < bestMatch.index)) {
        bestMatch = { index, marker };
      }
    }

    if (bestMatch.index === -1) return null;

    let originalUrl = pathname.substring(bestMatch.index + 1);
    
    // Fix protocol formatting
    if (originalUrl.startsWith('http:/') && !originalUrl.startsWith('http://')) {
      originalUrl = originalUrl.replace('http:/', 'http://');
    } else if (originalUrl.startsWith('https:/') && !originalUrl.startsWith('https://')) {
      originalUrl = originalUrl.replace('https:/', 'https://');
    }

    return originalUrl;
  }

  static validateOriginalUrl(urlString) {
    try {
      const url = new URL(urlString);
      
      if (!['http:', 'https:'].includes(url.protocol)) {
        return {
          isValid: false,
          error: `Invalid protocol: ${url.protocol}`,
          userMessage: 'The embedded link has an unsupported protocol.'
        };
      }

      if (!url.hostname) {
        return {
          isValid: false,
          error: 'Empty hostname',
          userMessage: 'The embedded link is missing a hostname.'
        };
      }

      // Reconstruct the full URL to preserve query params and hash
      const fullUrl = url.protocol + '//' + url.host + url.pathname + url.search + url.hash;

      return {
        isValid: true,
        url: fullUrl
      };
    } catch (error) {
      return {
        isValid: false,
        error: error.message,
        userMessage: 'The embedded link appears invalid or unparseable.'
      };
    }
  }

  static handleShortlink(archiveUrl, pathname) {
    // Fixed: use pathname directly instead of undefined pathSegments
    const segments = pathname.split('/').filter(Boolean);
    
    if (segments.length === 1 && segments[0].length > 0 && !segments[0].includes('.')) {
      logger.info(`Archive shortlink detected: ${archiveUrl}`);
      return {
        success: false,
        isShortlink: true,
        userMessage: 'Archive link appears to be a shortlink and cannot be directly converted. Please try accessing it in a browser first.'
      };
    }

    return {
      success: false,
      error: 'No embedded URL found',
      userMessage: `Could not find an embedded URL in the archive link: ${archiveUrl}`
    };
  }
}

module.exports = ArchiveService;
