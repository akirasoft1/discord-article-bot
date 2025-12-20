// ===== handlers/ReactionHandler.js =====
const logger = require('../logger');
const UrlUtils = require('../utils/urlUtils');
const { withRootSpan } = require('../tracing');
const { DISCORD, REACTION, ERROR } = require('../tracing-attributes');

class ReactionHandler {
  constructor(summarizationService, mongoService) {
    this.summarizationService = summarizationService;
    this.mongoService = mongoService;
  }

  async handleNewsReaction(reaction, user) {
    if (reaction.emoji.name !== '📰' || reaction.count > 1) {
      return;
    }

    const message = reaction.message;

    // Wrap in root span for tracing entry point
    return withRootSpan('discord.reaction.news', {
      [DISCORD.USER_ID]: user.id,
      [DISCORD.USER_TAG]: user.tag || user.username,
      [DISCORD.CHANNEL_ID]: message.channel.id,
      [DISCORD.GUILD_ID]: message.guild?.id || 'dm',
      [DISCORD.MESSAGE_ID]: message.id,
      [REACTION.OPERATION]: 'handle_news_reaction',
      [REACTION.EMOJI]: reaction.emoji.name,
    }, async (span) => {
      logger.info(`Newspaper reaction by ${user.tag} on message: ${message.content}`);

      const urls = UrlUtils.extractUrlsFromText(message.content);
      span.setAttribute(REACTION.URLS_FOUND, urls.length);

      if (urls.length === 0) {
        logger.info('No URLs found in message');
        return;
      }

      // Process each URL
      for (const url of urls) {
        try {
          await this.summarizationService.processUrl(url, message, user);

          // Update reaction count in DB
          if (reaction.emoji.name) {
            const totalReactions = reaction.count;
            await this.mongoService.updateArticleReactions(url, reaction.emoji.name, totalReactions);
          }
        } catch (error) {
          logger.error(`Error processing URL ${url}: ${error.message}`);
          span.setAttributes({
            [ERROR.TYPE]: error.name || 'Error',
            [ERROR.MESSAGE]: error.message,
          });
        }
      }
    });
  }
}

module.exports = ReactionHandler;