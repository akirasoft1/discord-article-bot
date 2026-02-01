// services/ChatService.js
// Handles personality-based chat conversations with memory

const logger = require('../logger');
const personalityManager = require('../personalities');
const { countTokens, wouldExceedLimit } = require('../utils/tokenCounter');
const { withSpan } = require('../tracing');
const localLlmService = require('./LocalLlmService');

// Conversation limits
const LIMITS = {
  MAX_MESSAGES: 100,
  MAX_TOKENS: 150000,
  IDLE_TIMEOUT_MINUTES: 30
};

class ChatService {
  constructor(openaiClient, config, mongoService, mem0Service = null) {
    this.openaiClient = openaiClient;
    this.config = config;
    this.mongoService = mongoService;
    this.mem0Service = mem0Service;
    this.channelContextService = null;
  }

  /**
   * Set the channel context service (called after bot initialization)
   * @param {Object} channelContextService - ChannelContextService instance
   */
  setChannelContextService(channelContextService) {
    this.channelContextService = channelContextService;
  }

  /**
   * Build enhanced system prompt for group conversations
   * @param {Object} personality - Personality object
   * @param {string} memoryContext - Optional personal memory context to include
   * @param {string} channelContext - Optional channel conversation context
   * @param {string} sharedContext - Optional shared channel memory context
   * @returns {string} Enhanced system prompt
   */
  _buildGroupSystemPrompt(personality, memoryContext = '', channelContext = '', sharedContext = '') {
    return `${personality.systemPrompt}

You are in a group conversation with multiple users in a Discord channel.
Their names appear before their messages like "[Username]: message".
Address users by name when relevant. Do not announce when new users join the conversation.${memoryContext}${sharedContext}${channelContext}`;
  }

  /**
   * Get channel conversation context from ChannelContextService
   * @param {string} channelId - Discord channel ID
   * @param {string} userMessage - Current user message for semantic relevance
   * @returns {Promise<string>} Channel context string for prompt injection
   * @private
   */
  async _getChannelContext(channelId, userMessage) {
    if (!this.channelContextService?.isChannelTracked(channelId)) {
      return '';
    }

    try {
      const context = await this.channelContextService.buildHybridContext(channelId, userMessage);
      if (!context) return '';

      return `

${context}`;
    } catch (error) {
      logger.debug(`Error getting channel context: ${error.message}`);
      return '';
    }
  }

  /**
   * Extract generated images from the OpenAI Responses API output
   * @param {Object} response - The full response from OpenAI Responses API
   * @returns {Array<{id: string, base64: string}>} Array of generated images
   * @private
   */
  _extractGeneratedImages(response) {
    if (!response?.output || !Array.isArray(response.output)) {
      return [];
    }

    const images = [];
    for (const item of response.output) {
      if (item.type === 'image_generation_call' &&
          item.status === 'completed' &&
          item.result) {
        images.push({
          id: item.id,
          base64: item.result
        });
        logger.info(`Extracted generated image from response: ${item.id}`);
      }
    }

    return images;
  }

  /**
   * Retrieve relevant memories for a user (if Mem0 is enabled)
   * Performs 3-way parallel search: personality + explicit + shared channel memories
   * @param {string} userMessage - The user's message to search for relevant memories
   * @param {string} userId - Discord user ID
   * @param {string} personalityId - Personality ID for filtering
   * @param {string} channelId - Optional channel ID for shared channel memories
   * @returns {Promise<{memories: Array, context: string, sharedContext: string}>}
   * @private
   */
  async _getRelevantMemories(userMessage, userId, personalityId, channelId = null) {
    if (!this.mem0Service || !this.mem0Service.isEnabled()) {
      return { memories: [], context: '', sharedContext: '' };
    }

    try {
      // 3-way parallel search: personality + explicit + shared channel memories
      const searches = [
        this.mem0Service.searchMemories(userMessage, userId, {
          personalityId: personalityId,
          limit: 3
        }),
        this.mem0Service.searchMemories(userMessage, userId, {
          personalityId: 'explicit_memory',
          limit: 3
        })
      ];

      // Add shared channel memory search if channelId is provided and method exists
      if (channelId && this.mem0Service.searchSharedChannelMemories) {
        searches.push(
          this.mem0Service.searchSharedChannelMemories(userMessage, channelId, { limit: 2 })
        );
      }

      const results = await Promise.all(searches);
      const [personalityResult, explicitResult, sharedResult] = results;

      // Combine results, deduplicating by memory ID
      // Priority order: explicit > shared > personality
      const seenIds = new Set();
      const combinedMemories = [];
      const sharedMemories = [];

      // Add explicit memories first (user-specified, highest priority)
      for (const memory of (explicitResult.results || [])) {
        if (memory.id && !seenIds.has(memory.id)) {
          seenIds.add(memory.id);
          combinedMemories.push(memory);
        }
      }

      // Add shared channel memories (team knowledge, second priority)
      if (sharedResult) {
        for (const memory of (sharedResult.results || [])) {
          if (memory.id && !seenIds.has(memory.id)) {
            seenIds.add(memory.id);
            combinedMemories.push(memory);
            sharedMemories.push(memory);
          }
        }
      }

      // Add personality-specific memories (lowest priority)
      for (const memory of (personalityResult.results || [])) {
        if (memory.id && !seenIds.has(memory.id)) {
          seenIds.add(memory.id);
          combinedMemories.push(memory);
        }
      }

      // Limit to top 5 total for personal context
      const memories = combinedMemories.slice(0, 5);
      const context = this.mem0Service.formatMemoriesForContext(memories);

      // Format shared channel memories separately if method exists
      const sharedContext = (sharedMemories.length > 0 && this.mem0Service.formatSharedMemoriesForContext)
        ? this.mem0Service.formatSharedMemoriesForContext(sharedMemories)
        : '';

      if (memories.length > 0) {
        logger.debug(`Found ${memories.length} relevant memories for user ${userId} (explicit + shared + ${personalityId})`);
      }

      return { memories, context, sharedContext };
    } catch (error) {
      logger.error(`Error retrieving memories: ${error.message}`);
      return { memories: [], context: '', sharedContext: '' };
    }
  }

  /**
   * Store new memories from a conversation exchange
   * @param {string} userMessage - The user's message
   * @param {string} assistantMessage - The assistant's response
   * @param {string} userId - Discord user ID
   * @param {Object} metadata - Conversation metadata
   * @private
   */
  async _storeMemories(userMessage, assistantMessage, userId, metadata) {
    if (!this.mem0Service || !this.mem0Service.isEnabled()) {
      return;
    }

    try {
      const messages = [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: assistantMessage }
      ];

      await this.mem0Service.addMemory(messages, userId, metadata);
    } catch (error) {
      logger.error(`Error storing memories: ${error.message}`);
      // Don't fail the chat response if memory storage fails
    }
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
   * Build input for OpenAI Responses API, optionally with an image
   * @param {string} textInput - The text input
   * @param {string|null} imageUrl - Optional image URL
   * @returns {string|Array} Input for the API
   */
  _buildApiInput(textInput, imageUrl = null) {
    if (!imageUrl) {
      return textInput;
    }

    // Multimodal input with image - must be wrapped in a message object
    return [{
      role: 'user',
      content: [
        { type: 'input_text', text: textInput },
        { type: 'input_image', image_url: imageUrl }
      ]
    }];
  }

  /**
   * Generate a response from a personality with conversation memory
   * @param {string} personalityId - The personality ID to use
   * @param {string} userMessage - The user's message
   * @param {Object} user - Discord user object
   * @param {string} channelId - Discord channel ID
   * @param {string} guildId - Discord guild ID
   * @param {string|null} imageUrl - Optional image URL for vision
   * @param {Object} options - Additional options
   * @param {boolean} options.useUncensored - Use local LLM for uncensored response
   * @returns {Object} Response with message and token usage
   */
  async chat(personalityId, userMessage, user, channelId = null, guildId = null, imageUrl = null, options = {}) {
    const { useUncensored = false } = options;
    const personality = personalityManager.get(personalityId);

    if (!personality) {
      // Check if personality exists but is unavailable (e.g., local LLM not running)
      const availability = personalityManager.checkAvailability(personalityId);
      if (availability.exists && !availability.available) {
        return {
          success: false,
          error: availability.reason
        };
      }
      return {
        success: false,
        error: `Unknown personality: ${personalityId}`,
        availablePersonalities: personalityManager.list()
      };
    }

    // Check if personality requires local LLM (or user explicitly requested uncensored)
    const shouldUseLocalLlm = useUncensored || personality.useLocalLlm;

    // If no channelId provided, fall back to stateless mode (backwards compatibility)
    if (!channelId || !this.mongoService) {
      return this._statelessChat(personality, userMessage, user, imageUrl);
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

      // Retrieve relevant memories for this user (if Mem0 is enabled)
      // 3-way search: personality memories + explicit memories + shared channel memories
      // Also retrieve channel context for conversation awareness (if enabled)
      const [{ context: memoryContext, sharedContext }, channelContext] = await Promise.all([
        this._getRelevantMemories(userMessage, user.id, personalityId, channelId),
        this._getChannelContext(channelId, userMessage)
      ]);

      // Build system prompt and format history
      const systemPrompt = this._buildGroupSystemPrompt(personality, memoryContext, channelContext, sharedContext);
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

      // Generate response - route to local LLM if uncensored, otherwise cloud
      let assistantMessage;
      let inputTokens = 0;
      let outputTokens = 0;
      let generatedImages = [];

      if (shouldUseLocalLlm && localLlmService.isAvailable()) {
        // Use local LLM for uncensored response or local-LLM-only personality
        // Get uncensored system prompt if available, otherwise use standard prompt
        const uncensoredSystemPrompt = personalityManager.getSystemPrompt(personalityId, true) || systemPrompt;

        // Build messages array for chat.completions API
        const messages = [
          { role: 'system', content: uncensoredSystemPrompt },
          ...historyMessages,
          { role: 'user', content: formattedUserMessage }
        ];

        logger.info(`Using local LLM for response (personality: ${personalityId}, reason: ${personality.useLocalLlm ? 'personality requires local LLM' : 'user requested uncensored'})`);
        assistantMessage = await localLlmService.generateCompletion(messages);

        // Local LLM doesn't provide token counts, estimate them
        inputTokens = countTokens(uncensoredSystemPrompt) + countTokens(inputText);
        outputTokens = countTokens(assistantMessage);

      } else {
        // Call OpenAI Responses API (cloud provider)
        const apiInput = this._buildApiInput(inputText, imageUrl);
        if (imageUrl) {
          logger.info(`Including image in chat request: ${imageUrl.substring(0, 50)}...`);
        }

        const model = this.config.openai.model || 'gpt-5.1';
        const response = await withSpan('openai.responses.create', {
          // GenAI semantic conventions
          'gen_ai.system': 'openai',
          'gen_ai.operation.name': 'chat',
          'gen_ai.request.model': model,
          // Chat context
          'chat.personality.id': personalityId,
          'chat.personality.name': personality.name,
          'chat.mode': 'stateful',
          'chat.has_image': !!imageUrl,
          'chat.tools_enabled': 'web_search',
          'chat.conversation.message_count': conversation.messageCount || 0,
          // Discord context
          'discord.channel.id': channelId,
          'discord.guild.id': guildId || '',
          'discord.user.id': user.id,
        }, async (span) => {
          const result = await this.openaiClient.responses.create({
            model: model,
            instructions: systemPrompt,
            input: apiInput,
            tools: [{ type: 'web_search' }]
          });

          // Add response attributes
          span.setAttributes({
            'gen_ai.response.id': result.id || '',
            'gen_ai.response.model': result.model || model,
            'gen_ai.usage.input_tokens': result.usage?.input_tokens || 0,
            'gen_ai.usage.output_tokens': result.usage?.output_tokens || 0,
          });

          return result;
        });

        assistantMessage = response.output_text;
        inputTokens = response.usage?.input_tokens || 0;
        outputTokens = response.usage?.output_tokens || 0;

        // Extract any generated images from the response
        generatedImages = this._extractGeneratedImages(response);
      }

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
        this.config.openai.model || 'gpt-5.1'
      );

      // Store conversation in Mem0 for long-term memory extraction
      await this._storeMemories(userMessage, assistantMessage, user.id, {
        channelId: channelId,
        personalityId: personalityId,
        guildId: guildId
      });

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
        },
        images: generatedImages // Base64 images generated by the model
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
   * @param {Object} personality - Personality object
   * @param {string} userMessage - User's message
   * @param {Object} user - Discord user object
   * @param {string|null} imageUrl - Optional image URL for vision
   * @private
   */
  async _statelessChat(personality, userMessage, user, imageUrl = null) {
    try {
      logger.info(`Stateless chat request from ${user.username} using personality: ${personality.name}`);

      const apiInput = this._buildApiInput(userMessage, imageUrl);
      if (imageUrl) {
        logger.info(`Including image in stateless chat request: ${imageUrl.substring(0, 50)}...`);
      }

      const model = this.config.openai.model || 'gpt-5.1';
      const response = await withSpan('openai.responses.create', {
        // GenAI semantic conventions
        'gen_ai.system': 'openai',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': model,
        // Chat context
        'chat.personality.id': personality.id,
        'chat.personality.name': personality.name,
        'chat.mode': 'stateless',
        'chat.has_image': !!imageUrl,
        'chat.tools_enabled': 'web_search',
        // Discord context
        'discord.user.id': user.id,
      }, async (span) => {
        const result = await this.openaiClient.responses.create({
          model: model,
          instructions: personality.systemPrompt,
          input: apiInput,
          tools: [{ type: 'web_search' }]
        });

        // Add response attributes
        span.setAttributes({
          'gen_ai.response.id': result.id || '',
          'gen_ai.response.model': result.model || model,
          'gen_ai.usage.input_tokens': result.usage?.input_tokens || 0,
          'gen_ai.usage.output_tokens': result.usage?.output_tokens || 0,
        });

        return result;
      });

      const assistantMessage = response.output_text;
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;

      // Extract any generated images from the response
      const generatedImages = this._extractGeneratedImages(response);

      // Record token usage if mongoService available
      if (this.mongoService) {
        await this.mongoService.recordTokenUsage(
          user.id,
          user.tag || user.username,
          inputTokens,
          outputTokens,
          `chat_${personality.id}`,
          this.config.openai.model || 'gpt-5.1'
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
        },
        images: generatedImages // Base64 images generated by the model
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

  /**
   * List resumable conversations for a user
   * @param {string} userId - Discord user ID
   * @param {string} guildId - Discord guild ID (optional)
   * @returns {Array} Array of conversation summaries with personality info
   */
  async listUserConversations(userId, guildId = null) {
    if (!this.mongoService) {
      return [];
    }

    const conversations = await this.mongoService.getUserConversations(userId, guildId);

    // Enrich with personality info
    return conversations.map(conv => {
      const personality = personalityManager.get(conv.personalityId);
      return {
        ...conv,
        personality: personality ? {
          id: personality.id,
          name: personality.name,
          emoji: personality.emoji
        } : {
          id: conv.personalityId,
          name: conv.personalityId,
          emoji: '🎭'
        }
      };
    });
  }
}

module.exports = ChatService;
