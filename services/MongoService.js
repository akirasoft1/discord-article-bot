
const { MongoClient } = require('mongodb');
const logger = require('../logger');

class MongoService {
    constructor() {
        this.client = new MongoClient(process.env.MONGO_URI);
        this.db = null;
    }

    async connect() {
        try {
            await this.client.connect();
            this.db = this.client.db('discord-article-bot');
            logger.info('Connected to MongoDB');
        } catch (error) {
            logger.error('Error connecting to MongoDB:', error);
        }
    }

    async persistData(data) {
        try {
            const collection = this.db.collection('summaries');
            await collection.insertOne(data);
        } catch (error) {
            logger.error('Error persisting data to MongoDB:', error);
        }
    }
}

module.exports = new MongoService();
