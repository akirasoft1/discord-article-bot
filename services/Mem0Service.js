// services/Mem0Service.js
// Memory management service using Mem0 SDK for persistent AI conversation memory

const { Memory } = require('mem0ai/oss');
const logger = require('../logger');

class Mem0Service {
  /**
   * Initialize Mem0Service with configuration
   * @param {Object} config - Application configuration
   */
  constructor(config) {
    // Validate configuration
    if (!config.mem0?.enabled) {
      throw new Error('Mem0 service is disabled');
    }

    if (!config.mem0.openaiApiKey) {
      throw new Error('OpenAI API key is required for Mem0 memory extraction');
    }

    this.config = config.mem0;

    // Build Mem0 configuration
    const mem0Config = {
      version: 'v1.1',
      embedder: {
        provider: 'openai',
        config: {
          apiKey: this.config.openaiApiKey,
          model: this.config.embeddingModel || 'text-embedding-3-small',
        },
      },
      vectorStore: {
        provider: 'qdrant',
        config: {
          host: this.config.qdrantHost || 'localhost',
          port: this.config.qdrantPort || 6333,
          collectionName: this.config.collectionName || 'discord_memories',
        },
      },
      llm: {
        provider: 'openai',
        config: {
          apiKey: this.config.openaiApiKey,
          model: this.config.llmModel || 'gpt-4o-mini',
          temperature: 0.1, // Low temperature for consistent memory extraction
        },
      },
      // Disable local SQLite history - we manage history in MongoDB
      disableHistory: true,
    };

    // Initialize Memory instance
    this.memory = new Memory(mem0Config);
    this._enabled = true;

    logger.info(`Mem0Service initialized with Qdrant at ${this.config.qdrantHost}:${this.config.qdrantPort}`);
  }

  /**
   * Check if the service is enabled and initialized
   * @returns {boolean}
   */
  isEnabled() {
    return this._enabled;
  }

  /**
   * Add memories from conversation messages
   * Mem0 will automatically extract facts and preferences from the conversation
   *
   * @param {Array<{role: string, content: string}>} messages - Conversation messages
   * @param {string} userId - Discord user ID
   * @param {Object} metadata - Additional context
   * @param {string} metadata.channelId - Discord channel ID
   * @param {string} metadata.personalityId - Bot personality ID
   * @param {string} metadata.channelName - Channel name for context
   * @param {string} metadata.guildId - Discord guild/server ID
   * @returns {Promise<{results: Array, error?: string}>}
   */
  async addMemory(messages, userId, metadata = {}) {
    try {
      const result = await this.memory.add(messages, {
        userId: userId,
        agentId: metadata.personalityId || 'default',
        runId: metadata.channelId,
        metadata: {
          channelName: metadata.channelName,
          guildId: metadata.guildId,
          timestamp: new Date().toISOString(),
        },
      });

      if (result.results && result.results.length > 0) {
        logger.debug(`Added ${result.results.length} memories for user ${userId}`);
      }

      return result;
    } catch (error) {
      logger.error(`Error adding memory: ${error.message}`);
      return { results: [], error: error.message };
    }
  }

  /**
   * Search for relevant memories based on a query
   *
   * @param {string} query - Search query (typically the user's current message)
   * @param {string} userId - Discord user ID
   * @param {Object} options - Search options
   * @param {number} options.limit - Maximum number of results (default: 5)
   * @param {string} options.personalityId - Filter by personality
   * @param {string} options.channelId - Filter by channel
   * @returns {Promise<{results: Array}>}
   */
  async searchMemories(query, userId, options = {}) {
    try {
      const searchConfig = {
        userId: userId,
        limit: options.limit || 5,
      };

      // Add optional filters
      if (options.personalityId) {
        searchConfig.agentId = options.personalityId;
      }
      if (options.channelId) {
        searchConfig.runId = options.channelId;
      }

      const result = await this.memory.search(query, searchConfig);

      if (result.results && result.results.length > 0) {
        logger.debug(`Found ${result.results.length} relevant memories for user ${userId}`);
      }

      return result;
    } catch (error) {
      logger.error(`Error searching memories: ${error.message}`);
      return { results: [] };
    }
  }

  /**
   * Get all memories for a user
   *
   * @param {string} userId - Discord user ID
   * @param {Object} options - Options
   * @param {number} options.limit - Maximum number of results
   * @param {string} options.personalityId - Filter by personality
   * @returns {Promise<{results: Array}>}
   */
  async getUserMemories(userId, options = {}) {
    try {
      const config = {
        userId: userId,
      };

      if (options.limit) {
        config.limit = options.limit;
      }
      if (options.personalityId) {
        config.agentId = options.personalityId;
      }

      const result = await this.memory.getAll(config);
      return result;
    } catch (error) {
      logger.error(`Error getting user memories: ${error.message}`);
      return { results: [] };
    }
  }

  /**
   * Delete a specific memory by ID
   *
   * @param {string} memoryId - Memory ID to delete
   * @returns {Promise<{message: string}>}
   */
  async deleteMemory(memoryId) {
    try {
      const result = await this.memory.delete(memoryId);
      logger.info(`Deleted memory: ${memoryId}`);
      return result;
    } catch (error) {
      logger.error(`Error deleting memory: ${error.message}`);
      return { message: `Error: ${error.message}` };
    }
  }

  /**
   * Delete all memories for a user (GDPR compliance)
   *
   * @param {string} userId - Discord user ID
   * @returns {Promise<{message: string}>}
   */
  async deleteAllUserMemories(userId) {
    try {
      const result = await this.memory.deleteAll({ userId: userId });
      logger.info(`Deleted all memories for user: ${userId}`);
      return result;
    } catch (error) {
      logger.error(`Error deleting all user memories: ${error.message}`);
      return { message: `Error: ${error.message}` };
    }
  }

  /**
   * Format memories for injection into system prompt context
   *
   * @param {Array<{memory: string}>} memories - Array of memory objects
   * @returns {string} Formatted context string
   */
  formatMemoriesForContext(memories) {
    if (!memories || memories.length === 0) {
      return '';
    }

    const memoryLines = memories
      .map(m => `- ${m.memory}`)
      .join('\n');

    return `\n\nRelevant things you remember about this user:\n${memoryLines}\n`;
  }
}

module.exports = Mem0Service;
