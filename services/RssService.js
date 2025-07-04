// ===== services/RssService.js =====
const Parser = require('rss-parser');
const logger = require('../logger');

class RssService {
  constructor(mongoService, summarizationService, discordClient) {
    this.parser = new Parser();
    this.mongoService = mongoService;
    this.summarizationService = summarizationService;
    this.discordClient = discordClient;
  }

  async fetchFeed(feedUrl) {
    try {
      const feed = await this.parser.parseURL(feedUrl);
      logger.info(`Fetched RSS feed from ${feedUrl}. Title: ${feed.title}`);
      return feed.items;
    } catch (error) {
      logger.error(`Error fetching RSS feed from ${feedUrl}: ${error.message}`);
      return [];
    }
  }

  async getNewArticles(feedUrl, channelId) {
    const items = await this.fetchFeed(feedUrl);
    const newArticles = [];

    for (const item of items) {
      const existingArticle = await this.mongoService.findArticleByUrl(item.link);
      if (!existingArticle) {
        newArticles.push(item);
        // Persist the new article to prevent re-posting
        await this.mongoService.persistData({
          url: item.link,
          title: item.title,
          published: item.pubDate ? new Date(item.pubDate) : new Date(),
          source: feedUrl,
        });

        // Summarize and enhance the article to get its topic
        const summaryResult = await this.summarizationService.generateSummary(null, item.link);
        if (summaryResult && summaryResult.summary) {
          const enhancedResult = await this.summarizationService.enhanceSummary(summaryResult.summary, null);
          if (enhancedResult.topic) {
            // Find users subscribed to this topic
            const subscribedUsers = await this.mongoService.getUsersSubscribedToTopic(enhancedResult.topic);
            for (const userId of subscribedUsers) {
              try {
                const user = await this.discordClient.users.fetch(userId);
                if (user) {
                  const personalizedMessage = `**Personalized News Alert!**\nHere's a new article on **${enhancedResult.topic}** that you subscribed to:\n${item.link}\n\n**Summary:**\n${summaryResult.summary}`;
                  await user.send(personalizedMessage);
                  logger.info(`Sent personalized news alert to user ${userId} for topic ${enhancedResult.topic}`);
                }
              } catch (userError) {
                logger.error(`Could not send personalized DM to user ${userId}: ${userError.message}`);
              }
            }
          }
        }
      }
    }
    return newArticles;
  }
}

module.exports = RssService;
