// ===== services/FollowUpService.js =====
const logger = require('../logger');

class FollowUpService {
  constructor(mongoService, summarizationService, discordClient) {
    this.mongoService = mongoService;
    this.summarizationService = summarizationService;
    this.discordClient = discordClient;
  }

  async markForFollowUp(url, userId) {
    try {
      await this.mongoService.addFollowUpUser(url, userId);
      await this.mongoService.updateFollowUpStatus(url, 'pending');
      logger.info(`Article ${url} marked for follow-up by user ${userId}`);
      return true;
    } catch (error) {
      logger.error(`Error marking article ${url} for follow-up: ${error.message}`);
      return false;
    }
  }

  async checkFollowUps() {
    logger.info('Checking for articles marked for follow-up...');
    const articlesToFollow = await this.mongoService.getArticlesForFollowUp();

    for (const article of articlesToFollow) {
      try {
        // For simplicity, re-summarize and notify. A more advanced approach might compare content.
        logger.info(`Processing follow-up for article: ${article.url}`);
        const dummyMessage = { channel: { send: (msg) => logger.info(`Follow-up notification: ${msg}`) } }; // Dummy for summarization service
        const dummyUser = { id: 'bot', tag: 'bot' };

        // Re-summarize the article to get fresh content/analysis
        const result = await this.summarizationService.generateSummary(null, article.url);
        if (result && result.summary) {
          const enhancedResult = await this.summarizationService.enhanceSummary(result.summary, null);
          const responseMessage = ResponseParser.buildDiscordMessage({
            ...result,
            ...enhancedResult,
          });

          for (const userId of article.followUpUsers) {
            try {
              const user = await this.discordClient.users.fetch(userId);
              if (user) {
                await user.send(`**Follow-up Alert!**\nHere's an update on a story you were following: ${article.url}\n\n${responseMessage}`);
                logger.info(`Notified user ${userId} about follow-up for ${article.url}`);
              }
            } catch (userError) {
              logger.error(`Could not send DM to user ${userId}: ${userError.message}`);
            }
          }
          // Mark as completed after notifying all users
          await this.mongoService.updateFollowUpStatus(article.url, 'completed');
        }
      }
 catch (error) {
        logger.error(`Error checking follow-up for ${article.url}: ${error.message}`);
      }
    }
  }
}

module.exports = FollowUpService;
