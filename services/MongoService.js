
const { MongoClient } = require('mongodb');
const logger = require('../logger');

class MongoService {
    constructor(mongoUri) {
        logger.info('Initializing MongoDB Service...');
        if (!mongoUri) {
            const errorMessage = 'mongoUri parameter is not provided to MongoService constructor';
            logger.error(errorMessage);
            throw new Error(errorMessage);
        }
        
        logger.info('Attempting to connect to MongoDB...');
        this.client = new MongoClient(mongoUri);
        this.db = null;
        this.connect();
    }

    async connect() {
        try {
            await this.client.connect();
            this.db = this.client.db('discord');
            logger.info('Successfully connected to MongoDB.');
        } catch (error) {
            logger.error('Error connecting to MongoDB:', error);
        }
    }

    async persistData(data) {
        if (!this.db) {
            logger.error('Cannot persist data: Not connected to MongoDB.');
            return;
        }
        try {
            const collection = this.db.collection('articles');
            const articleData = {
                ...data,
                createdAt: new Date(),
                followUpStatus: 'none', // 'none', 'pending', 'completed'
                followUpUsers: [], // Array of user IDs who want follow-ups
                reactions: {}, // Store reactions for controversy meter
            };
            await collection.insertOne(articleData);
        } catch (error) {
            logger.error('Error persisting data to MongoDB:', error);
        }
    }

    async updateFollowUpStatus(url, status) {
        if (!this.db) {
            logger.error('Cannot update follow-up status: Not connected to MongoDB.');
            return;
        }
        try {
            const collection = this.db.collection('articles');
            await collection.updateOne({ url }, { $set: { followUpStatus: status } });
        } catch (error) {
            logger.error('Error updating follow-up status in MongoDB:', error);
        }
    }

    async addFollowUpUser(url, userId) {
        if (!this.db) {
            logger.error('Cannot add follow-up user: Not connected to MongoDB.');
            return;
        }
        try {
            const collection = this.db.collection('articles');
            await collection.updateOne({ url }, { $addToSet: { followUpUsers: userId } });
        } catch (error) {
            logger.error('Error adding follow-up user in MongoDB:', error);
        }
    }

    async updateArticleReactions(url, emoji, count) {
        if (!this.db) {
            logger.error('Cannot update article reactions: Not connected to MongoDB.');
            return;
        }
        try {
            const collection = this.db.collection('articles');
            const updateField = `reactions.${emoji}`;
            await collection.updateOne({ url }, { $set: { [updateField]: count } });
            logger.info(`Updated reactions for ${url}: ${emoji} = ${count}`);
        } catch (error) {
            logger.error(`Error updating reactions for article ${url} in MongoDB: ${error.message}`);
        }
    }

    async getArticlesForFollowUp() {
        if (!this.db) {
            logger.error('Cannot get articles for follow-up: Not connected to MongoDB.');
            return [];
        }
        try {
            const collection = this.db.collection('articles');
            return await collection.find({ followUpStatus: 'pending' }).toArray();
        } catch (error) {
            logger.error('Error getting articles for follow-up in MongoDB:', error);
            return [];
        }
    }

    async subscribeUserToTopic(userId, topic) {
        if (!this.db) {
            logger.error('Cannot subscribe user: Not connected to MongoDB.');
            return;
        }
        try {
            const collection = this.db.collection('users');
            await collection.updateOne(
                { userId },
                { $addToSet: { subscribedTopics: topic } },
                { upsert: true }
            );
            logger.info(`User ${userId} subscribed to topic: ${topic}`);
        } catch (error) {
            logger.error(`Error subscribing user ${userId} to topic ${topic}: ${error.message}`);
        }
    }

    async unsubscribeUserFromTopic(userId, topic) {
        if (!this.db) {
            logger.error('Cannot unsubscribe user: Not connected to MongoDB.');
            return;
        }
        try {
            const collection = this.db.collection('users');
            await collection.updateOne(
                { userId },
                { $pull: { subscribedTopics: topic } }
            );
            logger.info(`User ${userId} unsubscribed from topic: ${topic}`);
        } catch (error) {
            logger.error(`Error unsubscribing user ${userId} from topic ${topic}: ${error.message}`);
        }
    }

    async getUserSubscriptions(userId) {
        if (!this.db) {
            logger.error('Cannot get user subscriptions: Not connected to MongoDB.');
            return [];
        }
        try {
            const collection = this.db.collection('users');
            const user = await collection.findOne({ userId });
            return user ? user.subscribedTopics || [] : [];
        } catch (error) {
            logger.error(`Error getting subscriptions for user ${userId}: ${error.message}`);
            return [];
        }
    }

    async getUsersSubscribedToTopic(topic) {
        if (!this.db) {
            logger.error('Cannot get users subscribed to topic: Not connected to MongoDB.');
            return [];
        }
        try {
            const collection = this.db.collection('users');
            const users = await collection.find({ subscribedTopics: topic }).toArray();
            return users.map(user => user.userId);
        } catch (error) {
            logger.error(`Error getting users subscribed to topic ${topic}: ${error.message}`);
            return [];
        }
    }

    async getArticleTrends(days = 7) {
        if (!this.db) {
            logger.error('Cannot get article trends: Not connected to MongoDB.');
            return [];
        }
        try {
            const collection = this.db.collection('articles');
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - days);

            const trends = await collection.aggregate([
                { $match: { createdAt: { $gte: sevenDaysAgo }, topic: { $ne: null } } },
                { $group: { _id: '$topic', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 }
            ]).toArray();
            return trends;
        } catch (error) {
            logger.error(`Error getting article trends from MongoDB: ${error.message}`);
            return [];
        }
    }

    async findArticleByUrl(url) {
        if (!this.db) {
            logger.error('Cannot find article: Not connected to MongoDB.');
            return null;
        }
        try {
            const collection = this.db.collection('articles');
            return await collection.findOne({ url });
        } catch (error) {
            logger.error('Error finding article in MongoDB:', error);
            return null;
        }
    }

    async findRelatedArticles(topic, currentUrl, limit = 3) {
        if (!this.db) {
            logger.error('Cannot find related articles: Not connected to MongoDB.');
            return [];
        }
        try {
            const collection = this.db.collection('articles');
            const query = {
                topic: topic,
                url: { $ne: currentUrl } // Exclude the current article
            };
            return await collection.find(query).sort({ createdAt: -1 }).limit(limit).toArray();
        } catch (error) {
            logger.error('Error finding related articles in MongoDB:', error);
            return [];
        }
    }

    async getUserReadingCount(userId, days = 30) {
        if (!this.db) {
            logger.error('Cannot get user reading count: Not connected to MongoDB.');
            return 0;
        }
        try {
            const collection = this.db.collection('articles');
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - days);

            const count = await collection.countDocuments({
                userId: userId,
                createdAt: { $gte: thirtyDaysAgo }
            });
            return count;
        } catch (error) {
            logger.error(`Error getting reading count for user ${userId}: ${error.message}`);
            return 0;
        }
    }

    async getPopularSources(days = 30) {
        if (!this.db) {
            logger.error('Cannot get popular sources: Not connected to MongoDB.');
            return [];
        }
        try {
            const collection = this.db.collection('articles');
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - days);

            const sources = await collection.aggregate([
                { $match: { createdAt: { $gte: thirtyDaysAgo }, source: { $ne: null } } },
                { $group: { _id: '$source', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 }
            ]).toArray();
            return sources;
        } catch (error) {
            logger.error(`Error getting popular sources from MongoDB: ${error.message}`);
            return [];
        }
    }

    async getControversialArticles(days = 7, minReactions = 5) {
        if (!this.db) {
            logger.error('Cannot get controversial articles: Not connected to MongoDB.');
            return [];
        }
        try {
            const collection = this.db.collection('articles');
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - days);

            const controversialArticles = await collection.aggregate([
                { $match: { createdAt: { $gte: sevenDaysAgo }, 'reactions.total': { $gte: minReactions } } },
                { $sort: { 'reactions.total': -1 } },
                { $limit: 5 }
            ]).toArray();
            return controversialArticles;
        } catch (error) {
            logger.error(`Error getting controversial articles from MongoDB: ${error.message}`);
            return [];
        }
    }

    // ========== Token Usage Tracking ==========

    /**
     * Record token usage for a Discord user
     * @param {string} userId - Discord user ID
     * @param {string} username - Discord username
     * @param {number} inputTokens - Number of input tokens used
     * @param {number} outputTokens - Number of output tokens used
     * @param {string} commandType - Type of command (e.g., 'summarize', 'chat', 'personality')
     * @param {string} model - Model used (e.g., 'gpt-5.1')
     */
    async recordTokenUsage(userId, username, inputTokens, outputTokens, commandType, model = 'gpt-5.1') {
        if (!this.db) {
            logger.error('Cannot record token usage: Not connected to MongoDB.');
            return false;
        }
        try {
            const collection = this.db.collection('token_usage');
            await collection.insertOne({
                userId,
                username,
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
                commandType,
                model,
                timestamp: new Date()
            });
            logger.debug(`Recorded token usage for user ${username}: ${inputTokens} in, ${outputTokens} out`);
            return true;
        } catch (error) {
            logger.error(`Error recording token usage for user ${userId}: ${error.message}`);
            return false;
        }
    }

    /**
     * Get token usage statistics for a specific user
     * @param {string} userId - Discord user ID
     * @param {number} days - Number of days to look back (default: 30)
     * @returns {Object} Usage statistics
     */
    async getUserTokenUsage(userId, days = 30) {
        if (!this.db) {
            logger.error('Cannot get user token usage: Not connected to MongoDB.');
            return null;
        }
        try {
            const collection = this.db.collection('token_usage');
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const stats = await collection.aggregate([
                {
                    $match: {
                        userId,
                        timestamp: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: '$userId',
                        totalInputTokens: { $sum: '$inputTokens' },
                        totalOutputTokens: { $sum: '$outputTokens' },
                        totalTokens: { $sum: '$totalTokens' },
                        requestCount: { $sum: 1 },
                        byCommand: {
                            $push: {
                                commandType: '$commandType',
                                tokens: '$totalTokens'
                            }
                        }
                    }
                }
            ]).toArray();

            if (stats.length === 0) {
                return {
                    userId,
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    totalTokens: 0,
                    requestCount: 0,
                    commandBreakdown: {}
                };
            }

            // Calculate command breakdown
            const commandBreakdown = {};
            for (const item of stats[0].byCommand) {
                if (!commandBreakdown[item.commandType]) {
                    commandBreakdown[item.commandType] = { count: 0, tokens: 0 };
                }
                commandBreakdown[item.commandType].count++;
                commandBreakdown[item.commandType].tokens += item.tokens;
            }

            return {
                userId,
                totalInputTokens: stats[0].totalInputTokens,
                totalOutputTokens: stats[0].totalOutputTokens,
                totalTokens: stats[0].totalTokens,
                requestCount: stats[0].requestCount,
                commandBreakdown
            };
        } catch (error) {
            logger.error(`Error getting token usage for user ${userId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Get token usage leaderboard (top users by token consumption)
     * @param {number} days - Number of days to look back (default: 30)
     * @param {number} limit - Number of users to return (default: 10)
     * @returns {Array} Top users by token usage
     */
    async getTokenUsageLeaderboard(days = 30, limit = 10) {
        if (!this.db) {
            logger.error('Cannot get token leaderboard: Not connected to MongoDB.');
            return [];
        }
        try {
            const collection = this.db.collection('token_usage');
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const leaderboard = await collection.aggregate([
                {
                    $match: {
                        timestamp: { $gte: startDate }
                    }
                },
                {
                    $group: {
                        _id: '$userId',
                        username: { $first: '$username' },
                        totalTokens: { $sum: '$totalTokens' },
                        requestCount: { $sum: 1 }
                    }
                },
                { $sort: { totalTokens: -1 } },
                { $limit: limit }
            ]).toArray();

            return leaderboard.map(entry => ({
                userId: entry._id,
                username: entry.username,
                totalTokens: entry.totalTokens,
                requestCount: entry.requestCount
            }));
        } catch (error) {
            logger.error(`Error getting token leaderboard: ${error.message}`);
            return [];
        }
    }

    // ========== Chat Conversation Memory ==========

    /**
     * Generate conversation ID from channel and personality
     * @param {string} channelId - Discord channel ID
     * @param {string} personalityId - Personality identifier
     * @returns {string} Composite conversation ID
     */
    _getConversationId(channelId, personalityId) {
        return `${channelId}_${personalityId}`;
    }

    /**
     * Get or create a conversation for a channel + personality
     * @param {string} channelId - Discord channel ID
     * @param {string} personalityId - Personality identifier
     * @param {string} guildId - Discord guild/server ID
     * @returns {Object} Conversation document
     */
    async getOrCreateConversation(channelId, personalityId, guildId) {
        if (!this.db) {
            logger.error('Cannot get/create conversation: Not connected to MongoDB.');
            return null;
        }
        try {
            const collection = this.db.collection('chat_conversations');
            const conversationId = this._getConversationId(channelId, personalityId);

            // Try to find existing active conversation
            let conversation = await collection.findOne({
                conversationId,
                status: 'active'
            });

            if (!conversation) {
                // Create new conversation
                const newConversation = {
                    conversationId,
                    channelId,
                    guildId,
                    personalityId,
                    messages: [],
                    status: 'active',
                    lastActivity: new Date(),
                    messageCount: 0,
                    totalTokens: 0,
                    createdAt: new Date()
                };
                await collection.insertOne(newConversation);
                conversation = newConversation;
                logger.info(`Created new conversation: ${conversationId}`);
            }

            return conversation;
        } catch (error) {
            logger.error(`Error getting/creating conversation: ${error.message}`);
            return null;
        }
    }

    /**
     * Add a message to a conversation
     * @param {string} channelId - Discord channel ID
     * @param {string} personalityId - Personality identifier
     * @param {string} role - Message role ('user' or 'assistant')
     * @param {string} content - Message content
     * @param {string} userId - Discord user ID (for user messages)
     * @param {string} username - Discord username (for user messages)
     * @param {number} tokens - Token count for this message
     * @returns {boolean} Success status
     */
    async addMessageToConversation(channelId, personalityId, role, content, userId = null, username = null, tokens = 0) {
        if (!this.db) {
            logger.error('Cannot add message: Not connected to MongoDB.');
            return false;
        }
        try {
            const collection = this.db.collection('chat_conversations');
            const conversationId = this._getConversationId(channelId, personalityId);

            const message = {
                role,
                content,
                timestamp: new Date()
            };

            if (role === 'user' && userId) {
                message.userId = userId;
                message.username = username;
            }

            await collection.updateOne(
                { conversationId, status: 'active' },
                {
                    $push: { messages: message },
                    $inc: { messageCount: 1, totalTokens: tokens },
                    $set: { lastActivity: new Date() }
                }
            );

            logger.debug(`Added ${role} message to conversation ${conversationId}`);
            return true;
        } catch (error) {
            logger.error(`Error adding message to conversation: ${error.message}`);
            return false;
        }
    }

    /**
     * Get conversation history for API calls
     * @param {string} channelId - Discord channel ID
     * @param {string} personalityId - Personality identifier
     * @returns {Object|null} Conversation with messages or null
     */
    async getConversationHistory(channelId, personalityId) {
        if (!this.db) {
            logger.error('Cannot get conversation history: Not connected to MongoDB.');
            return null;
        }
        try {
            const collection = this.db.collection('chat_conversations');
            const conversationId = this._getConversationId(channelId, personalityId);

            const conversation = await collection.findOne({ conversationId });
            return conversation;
        } catch (error) {
            logger.error(`Error getting conversation history: ${error.message}`);
            return null;
        }
    }

    /**
     * Get conversation status
     * @param {string} channelId - Discord channel ID
     * @param {string} personalityId - Personality identifier
     * @returns {Object} Status info { exists, status, lastActivity, messageCount, totalTokens }
     */
    async getConversationStatus(channelId, personalityId) {
        if (!this.db) {
            logger.error('Cannot get conversation status: Not connected to MongoDB.');
            return { exists: false };
        }
        try {
            const collection = this.db.collection('chat_conversations');
            const conversationId = this._getConversationId(channelId, personalityId);

            // First try to find an active conversation (prioritize active over expired/reset)
            let conversation = await collection.findOne({ conversationId, status: 'active' });

            // If no active conversation, look for any conversation (expired/reset)
            if (!conversation) {
                conversation = await collection.findOne(
                    { conversationId },
                    { sort: { createdAt: -1 } }  // Get the most recent one
                );
            }

            if (!conversation) {
                return { exists: false };
            }

            return {
                exists: true,
                status: conversation.status,
                lastActivity: conversation.lastActivity,
                messageCount: conversation.messageCount,
                totalTokens: conversation.totalTokens
            };
        } catch (error) {
            logger.error(`Error getting conversation status: ${error.message}`);
            return { exists: false };
        }
    }

    /**
     * Reset a conversation (clear messages, mark as reset)
     * @param {string} channelId - Discord channel ID
     * @param {string} personalityId - Personality identifier
     * @returns {boolean} Success status
     */
    async resetConversation(channelId, personalityId) {
        if (!this.db) {
            logger.error('Cannot reset conversation: Not connected to MongoDB.');
            return false;
        }
        try {
            const collection = this.db.collection('chat_conversations');
            const conversationId = this._getConversationId(channelId, personalityId);

            // Mark existing conversation as reset
            await collection.updateOne(
                { conversationId, status: 'active' },
                { $set: { status: 'reset', resetAt: new Date() } }
            );

            logger.info(`Reset conversation: ${conversationId}`);
            return true;
        } catch (error) {
            logger.error(`Error resetting conversation: ${error.message}`);
            return false;
        }
    }

    /**
     * Expire a conversation due to idle timeout
     * @param {string} channelId - Discord channel ID
     * @param {string} personalityId - Personality identifier
     * @returns {boolean} Success status
     */
    async expireConversation(channelId, personalityId) {
        if (!this.db) {
            logger.error('Cannot expire conversation: Not connected to MongoDB.');
            return false;
        }
        try {
            const collection = this.db.collection('chat_conversations');
            const conversationId = this._getConversationId(channelId, personalityId);

            await collection.updateOne(
                { conversationId, status: 'active' },
                { $set: { status: 'expired', expiredAt: new Date() } }
            );

            logger.info(`Expired conversation: ${conversationId}`);
            return true;
        } catch (error) {
            logger.error(`Error expiring conversation: ${error.message}`);
            return false;
        }
    }

    /**
     * Resume an expired conversation
     * @param {string} channelId - Discord channel ID
     * @param {string} personalityId - Personality identifier
     * @returns {boolean} Success status
     */
    async resumeConversation(channelId, personalityId) {
        if (!this.db) {
            logger.error('Cannot resume conversation: Not connected to MongoDB.');
            return false;
        }
        try {
            const collection = this.db.collection('chat_conversations');
            const conversationId = this._getConversationId(channelId, personalityId);

            const result = await collection.updateOne(
                { conversationId, status: 'expired' },
                {
                    $set: { status: 'active', resumedAt: new Date() },
                    $unset: { expiredAt: '' }
                }
            );

            if (result.matchedCount === 0) {
                logger.warn(`No expired conversation found to resume: ${conversationId}`);
                return false;
            }

            logger.info(`Resumed conversation: ${conversationId}`);
            return true;
        } catch (error) {
            logger.error(`Error resuming conversation: ${error.message}`);
            return false;
        }
    }

    /**
     * Update conversation token count
     * @param {string} channelId - Discord channel ID
     * @param {string} personalityId - Personality identifier
     * @param {number} tokens - Tokens to add
     * @returns {boolean} Success status
     */
    async updateConversationTokenCount(channelId, personalityId, tokens) {
        if (!this.db) {
            logger.error('Cannot update token count: Not connected to MongoDB.');
            return false;
        }
        try {
            const collection = this.db.collection('chat_conversations');
            const conversationId = this._getConversationId(channelId, personalityId);

            await collection.updateOne(
                { conversationId, status: 'active' },
                {
                    $inc: { totalTokens: tokens },
                    $set: { lastActivity: new Date() }
                }
            );

            return true;
        } catch (error) {
            logger.error(`Error updating token count: ${error.message}`);
            return false;
        }
    }

    /**
     * Check if conversation has exceeded idle timeout
     * @param {string} channelId - Discord channel ID
     * @param {string} personalityId - Personality identifier
     * @param {number} timeoutMinutes - Idle timeout in minutes (default: 30)
     * @returns {boolean} True if conversation is idle/expired
     */
    async isConversationIdle(channelId, personalityId, timeoutMinutes = 30) {
        const status = await this.getConversationStatus(channelId, personalityId);

        if (!status.exists) return false;
        if (status.status !== 'active') return true;

        const lastActivity = new Date(status.lastActivity);
        const now = new Date();
        const diffMinutes = (now - lastActivity) / (1000 * 60);

        return diffMinutes > timeoutMinutes;
    }

    // ==================== IMAGE GENERATION TRACKING ====================

    /**
     * Record an image generation request
     * @param {string} userId - Discord user ID
     * @param {string} username - Discord username
     * @param {string} prompt - The prompt used for generation
     * @param {string} aspectRatio - The aspect ratio used
     * @param {string} model - The model used (e.g., 'gemini-3-pro-image-preview')
     * @param {boolean} success - Whether generation was successful
     * @param {string} error - Error message if generation failed
     * @param {number} imageSizeBytes - Size of generated image in bytes (if successful)
     * @returns {boolean} Success status
     */
    async recordImageGeneration(userId, username, prompt, aspectRatio, model, success, error = null, imageSizeBytes = 0) {
        if (!this.db) {
            logger.error('Cannot record image generation: Not connected to MongoDB.');
            return false;
        }
        try {
            const collection = this.db.collection('image_generations');
            await collection.insertOne({
                userId,
                username,
                prompt,
                aspectRatio,
                model,
                success,
                error,
                imageSizeBytes,
                timestamp: new Date()
            });
            logger.debug(`Recorded image generation for user ${username}: ${success ? 'success' : 'failed'}`);
            return true;
        } catch (err) {
            logger.error(`Error recording image generation for user ${userId}: ${err.message}`);
            return false;
        }
    }

    /**
     * Get image generation statistics for a specific user
     * @param {string} userId - Discord user ID
     * @param {number} days - Number of days to look back (default: 30)
     * @returns {Object} Generation statistics
     */
    async getImageGenerationStats(userId, days = 30) {
        if (!this.db) {
            logger.error('Cannot get image generation stats: Not connected to MongoDB.');
            return { totalGenerations: 0, successfulGenerations: 0, failedGenerations: 0, totalBytes: 0 };
        }
        try {
            const collection = this.db.collection('image_generations');
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);

            const pipeline = [
                {
                    $match: {
                        userId,
                        timestamp: { $gte: cutoffDate }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalGenerations: { $sum: 1 },
                        successfulGenerations: {
                            $sum: { $cond: ['$success', 1, 0] }
                        },
                        failedGenerations: {
                            $sum: { $cond: ['$success', 0, 1] }
                        },
                        totalBytes: { $sum: '$imageSizeBytes' }
                    }
                }
            ];

            const results = await collection.aggregate(pipeline).toArray();
            if (results.length === 0) {
                return { totalGenerations: 0, successfulGenerations: 0, failedGenerations: 0, totalBytes: 0 };
            }

            const { totalGenerations, successfulGenerations, failedGenerations, totalBytes } = results[0];
            return { totalGenerations, successfulGenerations, failedGenerations, totalBytes };
        } catch (error) {
            logger.error(`Error getting image generation stats for user ${userId}: ${error.message}`);
            return { totalGenerations: 0, successfulGenerations: 0, failedGenerations: 0, totalBytes: 0 };
        }
    }

    /**
     * Get recent image generations for a user
     * @param {string} userId - Discord user ID
     * @param {number} limit - Maximum number of records to return (default: 10)
     * @returns {Array} Recent image generations
     */
    async getRecentImageGenerations(userId, limit = 10) {
        if (!this.db) {
            logger.error('Cannot get recent image generations: Not connected to MongoDB.');
            return [];
        }
        try {
            const collection = this.db.collection('image_generations');
            return await collection
                .find({ userId })
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray();
        } catch (error) {
            logger.error(`Error getting recent image generations for user ${userId}: ${error.message}`);
            return [];
        }
    }

    // ==================== VIDEO GENERATION TRACKING ====================

    /**
     * Record a video generation request
     * @param {string} userId - Discord user ID
     * @param {string} username - Discord username
     * @param {string} prompt - The prompt used for generation
     * @param {number} duration - Video duration in seconds
     * @param {string} aspectRatio - The aspect ratio used
     * @param {string} model - The model used (e.g., 'veo-3.1-fast-generate-001')
     * @param {boolean} success - Whether generation was successful
     * @param {string} error - Error message if generation failed
     * @param {number} videoSizeBytes - Size of generated video in bytes (if successful)
     * @returns {boolean} Success status
     */
    async recordVideoGeneration(userId, username, prompt, duration, aspectRatio, model, success, error = null, videoSizeBytes = 0) {
        if (!this.db) {
            logger.error('Cannot record video generation: Not connected to MongoDB.');
            return false;
        }
        try {
            const collection = this.db.collection('video_generations');
            await collection.insertOne({
                userId,
                username,
                prompt,
                duration,
                aspectRatio,
                model,
                success,
                error,
                videoSizeBytes,
                timestamp: new Date()
            });
            logger.debug(`Recorded video generation for user ${username}: ${success ? 'success' : 'failed'}`);
            return true;
        } catch (err) {
            logger.error(`Error recording video generation for user ${userId}: ${err.message}`);
            return false;
        }
    }

    /**
     * Get video generation statistics for a specific user
     * @param {string} userId - Discord user ID
     * @param {number} days - Number of days to look back (default: 30)
     * @returns {Object} Generation statistics
     */
    async getVideoGenerationStats(userId, days = 30) {
        if (!this.db) {
            logger.error('Cannot get video generation stats: Not connected to MongoDB.');
            return { totalGenerations: 0, successfulGenerations: 0, failedGenerations: 0, totalBytes: 0 };
        }
        try {
            const collection = this.db.collection('video_generations');
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);

            const pipeline = [
                {
                    $match: {
                        userId,
                        timestamp: { $gte: cutoffDate }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalGenerations: { $sum: 1 },
                        successfulGenerations: {
                            $sum: { $cond: ['$success', 1, 0] }
                        },
                        failedGenerations: {
                            $sum: { $cond: ['$success', 0, 1] }
                        },
                        totalBytes: { $sum: '$videoSizeBytes' },
                        totalDurationSeconds: { $sum: '$duration' }
                    }
                }
            ];

            const results = await collection.aggregate(pipeline).toArray();
            if (results.length === 0) {
                return { totalGenerations: 0, successfulGenerations: 0, failedGenerations: 0, totalBytes: 0, totalDurationSeconds: 0 };
            }

            const { totalGenerations, successfulGenerations, failedGenerations, totalBytes, totalDurationSeconds } = results[0];
            return { totalGenerations, successfulGenerations, failedGenerations, totalBytes, totalDurationSeconds };
        } catch (error) {
            logger.error(`Error getting video generation stats for user ${userId}: ${error.message}`);
            return { totalGenerations: 0, successfulGenerations: 0, failedGenerations: 0, totalBytes: 0, totalDurationSeconds: 0 };
        }
    }

    /**
     * Get recent video generations for a user
     * @param {string} userId - Discord user ID
     * @param {number} limit - Maximum number of records to return (default: 10)
     * @returns {Array} Recent video generations
     */
    async getRecentVideoGenerations(userId, limit = 10) {
        if (!this.db) {
            logger.error('Cannot get recent video generations: Not connected to MongoDB.');
            return [];
        }
        try {
            const collection = this.db.collection('video_generations');
            return await collection
                .find({ userId })
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray();
        } catch (error) {
            logger.error(`Error getting recent video generations for user ${userId}: ${error.message}`);
            return [];
        }
    }
}

module.exports = MongoService;
