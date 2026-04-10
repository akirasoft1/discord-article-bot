// services/CatchMeUpService.js
// Synthesizes a "catch me up" summary of what happened while a user was away

const logger = require('../logger');

// Default lookback when no last-seen record exists (3 days)
const DEFAULT_LOOKBACK_DAYS = 3;
// Minimum lookback in hours (to avoid near-zero ranges)
const MIN_LOOKBACK_HOURS = 1;

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
   * @param {Object} options - Options
   * @param {number} options.days - Override lookback period in days
   * @returns {Promise<{success: boolean, message?: string, nothingNew?: boolean, error?: string}>}
   */
  async generateCatchUp(userId, guildId, options = {}) {
    try {
      // 1. Determine time range
      const lastSeen = await this.mongoService.getUserLastSeen(userId, guildId);
      let lookbackDays;

      if (options.days) {
        // User explicitly requested a lookback period
        lookbackDays = options.days;
      } else if (lastSeen) {
        // Calculate from actual time away (can be fractional — hours matter)
        const hoursAway = (Date.now() - new Date(lastSeen.lastSeenAt).getTime()) / (1000 * 60 * 60);
        lookbackDays = Math.max(MIN_LOOKBACK_HOURS / 24, hoursAway / 24);
      } else {
        lookbackDays = DEFAULT_LOOKBACK_DAYS;
      }

      const activeChannels = lastSeen?.activeChannels || [];

      const lookbackLabel = lookbackDays >= 1
        ? `${Math.round(lookbackDays)} day${Math.round(lookbackDays) !== 1 ? 's' : ''}`
        : `${Math.round(lookbackDays * 24)} hour${Math.round(lookbackDays * 24) !== 1 ? 's' : ''}`;
      logger.info(`Generating catch-up for user ${userId}: lookback ${lookbackLabel}, ${activeChannels.length} active channels`);

      // 2. Gather data in parallel
      const voiceProfile = await (this.voiceProfileService?.getProfile().catch(() => null) || Promise.resolve(null));

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
      const hasMessages = channelContexts.some(c => c.context.length > 0);

      if (!hasMessages) {
        return {
          success: true,
          nothingNew: true,
          message: "Things have been pretty quiet — nothing notable since you were last around."
        };
      }

      // 5. Build context for synthesis
      const contextParts = [];

      for (const { context } of channelContexts) {
        if (context) {
          contextParts.push(`**Recent Chat:**\n${context}`);
        }
      }

      const gatheredContext = contextParts.join('\n\n');

      // 6. Build system prompt with voice styling
      let systemPrompt = `You are summarizing what happened in a Discord server while a user was away (approximately ${lookbackLabel}).

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
