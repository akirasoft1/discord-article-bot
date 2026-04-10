// services/CatchMeUpService.js
// Synthesizes a "catch me up" summary of what happened while a user was away

const logger = require('../logger');

// Default lookback when no last-seen record exists (3 days)
const DEFAULT_LOOKBACK_DAYS = 3;

class CatchMeUpService {
  /**
   * @param {Object} mongoService - MongoService for articles, trends, user activity
   * @param {Object} channelContextService - ChannelContextService for recent Discord messages
   * @param {Object} voiceProfileService - VoiceProfileService for channel voice styling
   * @param {Object} openaiClient - OpenAI client for synthesis
   * @param {Object} config - Bot configuration
   */
  constructor(mongoService, channelContextService, voiceProfileService, openaiClient, config) {
    this.mongoService = mongoService;
    this.channelContextService = channelContextService;
    this.voiceProfileService = voiceProfileService;
    this.openaiClient = openaiClient;
    this.config = config;
  }

  /**
   * Generate a catch-up summary for a user
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID
   * @returns {Promise<{success: boolean, message?: string, nothingNew?: boolean, error?: string}>}
   */
  async generateCatchUp(userId, guildId) {
    try {
      // 1. Determine time range
      const lastSeen = await this.mongoService.getUserLastSeen(userId, guildId);
      const lookbackDays = lastSeen
        ? Math.max(1, Math.ceil((Date.now() - new Date(lastSeen.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24)))
        : DEFAULT_LOOKBACK_DAYS;
      const activeChannels = lastSeen?.activeChannels || [];

      logger.info(`Generating catch-up for user ${userId}: lookback ${lookbackDays} days, ${activeChannels.length} active channels`);

      // 2. Gather data in parallel
      const [articles, trends, voiceProfile] = await Promise.all([
        this.mongoService.getRecentArticleSummaries(lookbackDays),
        this.mongoService.getArticleTrends(lookbackDays),
        this.voiceProfileService?.getProfile().catch(() => null) || Promise.resolve(null)
      ]);

      // 3. Gather recent messages from active channels
      const channelContexts = [];
      for (const channelId of activeChannels.slice(0, 5)) { // Cap at 5 channels
        if (this.channelContextService?.isChannelTracked(channelId)) {
          const context = this.channelContextService.getRecentContext(channelId, 15);
          if (context) {
            channelContexts.push({ channelId, context });
          }
        }
      }

      // 4. Check if there's anything to report
      const hasArticles = articles.length > 0;
      const hasTrends = trends.length > 0;
      const hasMessages = channelContexts.some(c => c.context.length > 0);

      if (!hasArticles && !hasTrends && !hasMessages) {
        return {
          success: true,
          nothingNew: true,
          message: "Things have been pretty quiet — nothing notable since you were last around."
        };
      }

      // 5. Build context for synthesis
      const contextParts = [];

      if (hasArticles) {
        const articleList = articles.slice(0, 10).map(a =>
          `- "${a.title}" (${a.topic || 'General'}): ${a.summary?.substring(0, 150) || 'No summary'}...`
        ).join('\n');
        contextParts.push(`**Recent Articles (${articles.length} total):**\n${articleList}`);
      }

      if (hasTrends) {
        const trendList = trends.map(t => `${t._id}: ${t.count} articles`).join(', ');
        contextParts.push(`**Trending Topics:** ${trendList}`);
      }

      if (hasMessages) {
        for (const { context } of channelContexts) {
          contextParts.push(`**Recent Chat:**\n${context}`);
        }
      }

      const gatheredContext = contextParts.join('\n\n');

      // 6. Build system prompt with voice styling
      let systemPrompt = `You are summarizing what happened in a Discord server while a user was away (approximately ${lookbackDays} day${lookbackDays !== 1 ? 's' : ''}).

Your task:
- Provide a concise, engaging summary of what the user missed
- Highlight the most interesting articles, discussions, and trends
- Keep it under 500 words
- Use a natural, conversational tone — like a friend filling someone in
- Group related items together rather than listing everything chronologically
- If there are many articles, highlight the 3-5 most notable ones, not all of them`;

      if (voiceProfile) {
        systemPrompt += `\n\nStyle your response to match this group's communication style:\n${voiceProfile.voiceInstructions || ''}`;
        if (voiceProfile.toneKeywords?.length > 0) {
          systemPrompt += `\nTone: ${voiceProfile.toneKeywords.join(', ')}`;
        }
      }

      // 7. Synthesize
      const response = await this.openaiClient.responses.create({
        model: this.config.openai.model || 'gpt-4.1-mini',
        instructions: systemPrompt,
        input: gatheredContext
      });

      logger.info(`Catch-up generated for user ${userId}: ${response.usage?.output_tokens || 0} tokens`);

      return {
        success: true,
        message: response.output_text.trim()
      };

    } catch (error) {
      logger.error(`Error generating catch-up for user ${userId}: ${error.message}`);
      return {
        success: false,
        error: `Sorry, I encountered an error generating your catch-up: ${error.message}`
      };
    }
  }
}

module.exports = CatchMeUpService;
