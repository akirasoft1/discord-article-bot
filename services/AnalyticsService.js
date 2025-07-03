// ===== services/AnalyticsService.js =====
const logger = require('../logger');

class AnalyticsService {
  constructor(mongoService) {
    this.mongoService = mongoService;
  }

  async getServerNewsTrends(days = 7) {
    try {
      const trends = await this.mongoService.getArticleTrends(days);
      if (trends.length === 0) {
        return 'No significant news trends found for the specified period.';
      }

      let trendMessage = `**This week's hot topics (${days} days):**\n`;
      trends.forEach((trend, index) => {
        trendMessage += `${index + 1}. **${trend._id}** (${trend.count} articles)\n`;
      });
      return trendMessage;
    } catch (error) {
      logger.error(`Error generating server news trends: ${error.message}`);
      return 'An error occurred while fetching news trends.';
    }
  }

  async getUserReadingHabits(userId, days = 30) {
    try {
      const readingCount = await this.mongoService.getUserReadingCount(userId, days);
      return `You've read **${readingCount}** summaries this month!`;
    } catch (error) {
      logger.error(`Error generating user reading habits for user ${userId}: ${error.message}`);
      return 'An error occurred while fetching your reading habits.';
    }
  }

  async getPopularSources(days = 30) {
    try {
      const sources = await this.mongoService.getPopularSources(days);
      if (sources.length === 0) {
        return 'No popular sources found for the specified period.';
      }

      let sourceMessage = `**This month's popular sources (${days} days):**\n`;
      sources.forEach((source, index) => {
        sourceMessage += `${index + 1}. **${source._id}** (${source.count} articles)\n`;
      });
      return sourceMessage;
    } catch (error) {
      logger.error(`Error generating popular sources: ${error.message}`);
      return 'An error occurred while fetching popular sources.';
    }
  }

  async getControversyMeter(days = 7, minReactions = 5) {
    try {
      const controversialArticles = await this.mongoService.getControversialArticles(days, minReactions);
      if (controversialArticles.length === 0) {
        return 'No controversial articles found for the specified period.';
      }

      let controversyMessage = `**This week's most controversial articles (${days} days):**\n`;
      controversialArticles.forEach((article, index) => {
        const totalReactions = Object.values(article.reactions).reduce((sum, count) => sum + count, 0);
        controversyMessage += `${index + 1}. [${article.title || article.url}](${article.url}) - Total Reactions: ${totalReactions}\n`;
      });
      return controversyMessage;
    } catch (error) {
      logger.error(`Error generating controversy meter: ${error.message}`);
      return 'An error occurred while fetching controversial articles.';
    }
  }
}

module.exports = AnalyticsService;

