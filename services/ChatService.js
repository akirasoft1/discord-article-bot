// services/ChatService.js
// Handles personality-based chat conversations

const logger = require('../logger');
const personalityManager = require('../personalities');

class ChatService {
  constructor(openaiClient, config, mongoService) {
    this.openaiClient = openaiClient;
    this.config = config;
    this.mongoService = mongoService;
  }

  /**
   * Generate a response from a personality
   * @param {string} personalityId - The personality ID to use
   * @param {string} userMessage - The user's message
   * @param {Object} user - Discord user object
   * @returns {Object} Response with message and token usage
   */
  async chat(personalityId, userMessage, user) {
    const personality = personalityManager.get(personalityId);

    if (!personality) {
      return {
        success: false,
        error: `Unknown personality: ${personalityId}`,
        availablePersonalities: personalityManager.list()
      };
    }

    try {
      logger.info(`Chat request from ${user.username} using personality: ${personality.name}`);

      const response = await this.openaiClient.chat.completions.create({
        model: this.config.openai.model || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: personality.systemPrompt
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 1000,
        temperature: 0.9, // Higher temperature for more creative/varied responses
      });

      const assistantMessage = response.choices[0]?.message?.content;
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;

      // Record token usage
      if (this.mongoService) {
        await this.mongoService.recordTokenUsage(
          user.id,
          user.tag || user.username,
          inputTokens,
          outputTokens,
          `chat_${personalityId}`,
          this.config.openai.model || 'gpt-4o-mini'
        );
      }

      logger.info(`Chat response generated: ${inputTokens} in, ${outputTokens} out`);

      return {
        success: true,
        message: assistantMessage,
        personality: {
          id: personality.id,
          name: personality.name,
          emoji: personality.emoji
        },
        tokens: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens
        }
      };

    } catch (error) {
      logger.error(`Chat error with personality ${personalityId}: ${error.message}`);
      return {
        success: false,
        error: `Failed to generate response: ${error.message}`
      };
    }
  }

  /**
   * List all available personalities
   * @returns {Array} List of personalities
   */
  listPersonalities() {
    return personalityManager.list();
  }

  /**
   * Get a specific personality's details
   * @param {string} personalityId - The personality ID
   * @returns {Object|null} Personality details or null
   */
  getPersonality(personalityId) {
    return personalityManager.get(personalityId);
  }

  /**
   * Check if a personality exists
   * @param {string} personalityId - The personality ID
   * @returns {boolean} True if exists
   */
  personalityExists(personalityId) {
    return personalityManager.exists(personalityId);
  }
}

module.exports = ChatService;
