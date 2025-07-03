
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
            const collection = this.db.collection('summaries');
            await collection.insertOne(data);
        } catch (error) {
            logger.error('Error persisting data to MongoDB:', error);
        }
    }
}

module.exports = MongoService;
