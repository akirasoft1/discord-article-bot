
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
}
}

module.exports = MongoService;
