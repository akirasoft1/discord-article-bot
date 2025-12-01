// services/ChatService.js
// Handles personality-based chat conversations with memory

const logger = require('../logger');
const personalityManager = require('../personalities');
const { countTokens, wouldExceedLimit } = require('../utils/tokenCounter');

// Conversation limits
const LIMITS = {
  MAX_MESSAGES: 100,
  MAX_TOKENS: 150000,
  IDLE_TIMEOUT_MINUTES: 30
};

class ChatService {
  constructor(openaiClient, config, mongoService) {
    this.openaiClient = openaiClient;
    this.config = config;
    this.mongoService = mongoService;
  }

  /**
   * Build enhanced system prompt for group conversations
   * @param {Object} personality - Personality object
   * @returns {string} Enhanced system prompt
   */
  _buildGroupSystemPrompt(personality) {
    return `${personality.systemPrompt}

You are in a group conversation with multiple users in a Discord channel.
Their names appear before their messages like "[Username]: message".
Address users by name when relevant. Do not announce when new users join the conversation.`;
  }

  /**
   * Format conversation history for OpenAI API
   * @param {Array} messages - Raw messages from database
   * @returns {Array} Formatted messages for API
   */
  _formatMessagesForAPI(messages) {
    return messages.map(msg => {
      if (msg.role === 'user' && msg.username) {
        return {
          role: 'user',
          content: `[${msg.username}]: ${msg.content}`
        };
      }
      return {
        role: msg.role,
        content: msg.content
      };
    });
  }

  /**
   * Check conversation limits and status
   * @param {string} channelId - Discord channel ID
   * @param {string} personalityId - Personality identifier
   * @returns {Object} Limit check result
   */
  async _checkConversationLimits(channelId, personalityId) {
    const status = await this.mongoService.getConversationStatus(channelId, personalityId);

    // No existing conversation
    if (!status.exists) {
      return { allowed: true, reason: null };
    }

    // Expired or reset conversations should start fresh with !chat
    // Users can use !chatresume to continue an expired conversation with history
    if (status.status === 'expired' || status.status === 'reset') {
      return { allowed: true, reason: null, startFresh: true };
    }

    // Check idle timeout - if idle, expire and allow fresh start
    const isIdle = await this.mongoService.isConversationIdle(channelId, personalityId, LIMITS.IDLE_TIMEOUT_MINUTES);
    if (isIdle) {
      // Expire the conversation
      await this.mongoService.expireConversation(channelId, personalityId);
      return { allowed: true, reason: null, startFresh: true };
    }

    // Check message count limit
    if (status.messageCount >= LIMITS.MAX_MESSAGES) {
      return {
        allowed: false,
        reason: 'message_limit',
        message: `This conversation has reached ${LIMITS.MAX_MESSAGES} messages. An admin can reset it with \`!chatreset ${personalityId}\`.`
      };
    }

    // Check token limit
    if (status.totalTokens >= LIMITS.MAX_TOKENS) {
      return {
        allowed: false,
        reason: 'token_limit',
        message: `This conversation has reached the ${LIMITS.MAX_TOKENS.toLocaleString()} token limit. An admin can reset it with \`!chatreset ${personalityId}\`.`
      };
    }

    return { allowed: true, reason: null };
  }

  /**
   * Generate a response from a personality with conversation memory
   * @param {string} personalityId - The personality ID to use
   * @param {string} userMessage - The user's message
   * @param {Object} user - Discord user object
   * @param {string} channelId - Discord channel ID
   * @param {string} guildId - Discord guild ID
   * @returns {Object} Response with message and token usage
   */
  async chat(personalityId, userMessage, user, channelId = null, guildId = null) {
    const personality = personalityManager.get(personalityId);

    if (!personality) {
      return {
        success: false,
        error: `Unknown personality: ${personalityId}`,
        availablePersonalities: personalityManager.list()
      };
    }

    // If no channelId provided, fall back to stateless mode (backwards compatibility)
    if (!channelId || !this.mongoService) {
      return this._statelessChat(personality, userMessage, user);
    }

    try {
      // Check conversation limits
      const limitCheck = await this._checkConversationLimits(channelId, personalityId);
      if (!limitCheck.allowed) {
        return {
          success: false,
          error: limitCheck.message,
          reason: limitCheck.reason,
          personality: {
            id: personality.id,
            name: personality.name,
            emoji: personality.emoji
          }
        };
      }

      // If starting fresh (expired/reset conversation), reset it first
      if (limitCheck.startFresh) {
        await this.mongoService.resetConversation(channelId, personalityId);
        logger.info(`Starting fresh conversation with ${personalityId} in channel ${channelId} (previous was expired/reset)`);
      }

      // Get or create conversation
      const conversation = await this.mongoService.getOrCreateConversation(channelId, personalityId, guildId);
      if (!conversation) {
        logger.error('Failed to get/create conversation');
        return this._statelessChat(personality, userMessage, user);
      }

      logger.info(`Chat request from ${user.username} using personality: ${personality.name} (channel: ${channelId})`);

      // Build system prompt and format history
      const systemPrompt = this._buildGroupSystemPrompt(personality);
      const historyMessages = this._formatMessagesForAPI(conversation.messages || []);

      // Format current user message
      const formattedUserMessage = `[${user.username}]: ${userMessage}`;

      // Build input text from history for responses API
      const historyText = historyMessages.length > 0
        ? historyMessages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n') + '\n\n'
        : '';
      const inputText = `${historyText}User: ${formattedUserMessage}`;

      // Check if adding this message would exceed token limit
      const estimatedTokens = countTokens(systemPrompt) + countTokens(inputText);
      if (wouldExceedLimit(0, estimatedTokens, LIMITS.MAX_TOKENS)) {
        return {
          success: false,
          error: `This conversation is approaching the token limit. An admin can reset it with \`!chatreset ${personalityId}\`.`,
          reason: 'token_limit',
          personality: {
            id: personality.id,
            name: personality.name,
            emoji: personality.emoji
          }
        };
      }

      // Call OpenAI Responses API
      const response = await this.openaiClient.responses.create({
        model: this.config.openai.model || 'gpt-5-mini',
        instructions: systemPrompt,
        input: inputText,
      });

      const assistantMessage = response.output_text;
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;

      // Store user message in conversation (with original content, not formatted)
      await this.mongoService.addMessageToConversation(
        channelId,
        personalityId,
        'user',
        userMessage,
        user.id,
        user.username,
        countTokens(formattedUserMessage)
      );

      // Store assistant response
      await this.mongoService.addMessageToConversation(
        channelId,
        personalityId,
        'assistant',
        assistantMessage,
        null,
        null,
        outputTokens
      );

      // Record per-user token usage
      await this.mongoService.recordTokenUsage(
        user.id,
        user.tag || user.username,
        inputTokens,
        outputTokens,
        `chat_${personalityId}`,
        this.config.openai.model || 'gpt-5-mini'
      );

      logger.info(`Chat response generated: ${inputTokens} in, ${outputTokens} out (conversation: ${conversation.messageCount + 2} messages)`);

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
          total: totalTokens
        },
        conversation: {
          messageCount: (conversation.messageCount || 0) + 2,
          totalTokens: (conversation.totalTokens || 0) + totalTokens
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
   * Stateless chat (no memory) - backwards compatibility
   * @private
   */
  async _statelessChat(personality, userMessage, user) {
    try {
      logger.info(`Stateless chat request from ${user.username} using personality: ${personality.name}`);

      const response = await this.openaiClient.responses.create({
        model: this.config.openai.model || 'gpt-5-mini',
        instructions: personality.systemPrompt,
        input: userMessage,
      });

      const assistantMessage = response.output_text;
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;

      // Record token usage if mongoService available
      if (this.mongoService) {
        await this.mongoService.recordTokenUsage(
          user.id,
          user.tag || user.username,
          inputTokens,
          outputTokens,
          `chat_${personality.id}`,
          this.config.openai.model || 'gpt-5-mini'
        );
      }

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
      logger.error(`Stateless chat error: ${error.message}`);
      return {
        success: false,
        error: `Failed to generate response: ${error.message}`
      };
    }
  }

  /**
   * Resume an expired conversation
   * @param {string} personalityId - Personality ID
   * @param {string} userMessage - User's message
   * @param {Object} user - Discord user object
   * @param {string} channelId - Discord channel ID
   * @param {string} guildId - Discord guild ID
   * @returns {Object} Response with message and token usage
   */
  async resumeChat(personalityId, userMessage, user, channelId, guildId) {
    const personality = personalityManager.get(personalityId);

    if (!personality) {
      return {
        success: false,
        error: `Unknown personality: ${personalityId}`,
        availablePersonalities: personalityManager.list()
      };
    }

    // Check if there's an expired conversation to resume
    const status = await this.mongoService.getConversationStatus(channelId, personalityId);

    if (!status.exists) {
      return {
        success: false,
        error: `No conversation found with ${personality.name} in this channel. Start a new one with \`!chat ${personalityId} <message>\`.`
      };
    }

    if (status.status === 'active') {
      return {
        success: false,
        error: `The conversation with ${personality.name} is still active. Just use \`!chat ${personalityId} <message>\`.`
      };
    }

    if (status.status === 'reset') {
      return {
        success: false,
        error: `The conversation with ${personality.name} was reset. Start a new one with \`!chat ${personalityId} <message>\`.`
      };
    }

    // Resume the expired conversation
    const resumed = await this.mongoService.resumeConversation(channelId, personalityId);
    if (!resumed) {
      return {
        success: false,
        error: `Failed to resume conversation with ${personality.name}.`
      };
    }

    logger.info(`Resumed conversation with ${personalityId} in channel ${channelId}`);

    // Now continue with normal chat
    return this.chat(personalityId, userMessage, user, channelId, guildId);
  }

  /**
   * Reset a conversation (requires admin role - checked by command)
   * @param {string} channelId - Discord channel ID
   * @param {string} personalityId - Personality ID
   * @returns {Object} Result
   */
  async resetConversation(channelId, personalityId) {
    const personality = personalityManager.get(personalityId);

    if (!personality) {
      return {
        success: false,
        error: `Unknown personality: ${personalityId}`
      };
    }

    const status = await this.mongoService.getConversationStatus(channelId, personalityId);

    if (!status.exists) {
      return {
        success: false,
        error: `No conversation found with ${personality.name} in this channel.`
      };
    }

    const reset = await this.mongoService.resetConversation(channelId, personalityId);

    if (reset) {
      return {
        success: true,
        message: `Conversation with ${personality.emoji} ${personality.name} has been reset. Start fresh with \`!chat ${personalityId} <message>\`.`,
        personality: {
          id: personality.id,
          name: personality.name,
          emoji: personality.emoji
        }
      };
    }

    return {
      success: false,
      error: `Failed to reset conversation with ${personality.name}.`
    };
  }

  /**
   * Get conversation info for a channel + personality
   * @param {string} channelId - Discord channel ID
   * @param {string} personalityId - Personality ID
   * @returns {Object} Conversation info
   */
  async getConversationInfo(channelId, personalityId) {
    const personality = personalityManager.get(personalityId);
    const status = await this.mongoService.getConversationStatus(channelId, personalityId);

    return {
      personality: personality ? {
        id: personality.id,
        name: personality.name,
        emoji: personality.emoji
      } : null,
      ...status,
      limits: LIMITS
    };
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
