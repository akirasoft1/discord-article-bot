// ===== handlers/ReactionHandler.js =====
const logger = require('../logger');
const UrlUtils = require('../utils/urlUtils');

class ReactionHandler {
  constructor(summarizationService) {
    this.summarizationService = summarizationService;
  }

  async handleNewsReaction(reaction, user) {
    if (reaction.emoji.name !== '📰' || reaction.count > 1) {
      return;
    }

    const message = reaction.message;
    logger.info(`Newspaper reaction by ${user.tag} on message: ${message.content}`);

    const urls = UrlUtils.extractUrlsFromText(message.content);
    if (urls.length === 0) {
      logger.info('No URLs found in message');
      return;
    }

    // Process each URL
    for (const url of urls) {
      await this.summarizationService.processUrl(url, message);
    }
  }
}

module.exports = ReactionHandler;