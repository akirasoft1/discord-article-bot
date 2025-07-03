// bot.js - Cleaned up version
const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs').promises;
const config = require('./config/config');
const logger = require('./logger');
const SummarizationService = require('./services/SummarizationService');
const ReactionHandler = require('./handlers/ReactionHandler');

class DiscordBot {
  constructor() {
    logger.info('Creating DiscordBot v0.6 instance');
    logger.info(`OpenAI API Key: ${config.openai.apiKey ? 'Loaded' : 'Not Loaded'}`);
    
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
      ]
    });

    this.openaiClient = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseURL,
    });

    this.summarizationService = new SummarizationService(this.openaiClient, config);
    this.reactionHandler = new ReactionHandler(this.summarizationService);
    
    this.setupEventHandlers();
  }

  async start() {
    try {
      logger.info(`Attempting to login with token: ${config.discord.token.substring(0, 10)}...`);
      await this.client.login(config.discord.token);
      logger.info('Bot login successful');
    } catch (error) {
      logger.error('Failed to start bot:', error);
      process.exit(1);
    }
  }

  setupEventHandlers() {
    this.client.once('ready', async () => {
      logger.info('Discord client ready event fired');

      try {
        const systemPrompt = await fs.readFile(config.bot.systemPromptFile, 'utf-8');
        this.summarizationService.setSystemPrompt(systemPrompt);
        logger.info('System prompt loaded successfully');
      } catch (error) {
        logger.error('Failed to load system prompt:', error);
        process.exit(1);
      }
      
      logger.info(`Bot is online! Logged in as ${this.client.user.tag}`);
    });

    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      
      try {
        if (reaction.partial) {
          await reaction.fetch();
        }
        if (reaction.message.partial) {
          await reaction.message.fetch();
        }
        
        await this.reactionHandler.handleNewsReaction(reaction, user);
      } catch (error) {
        logger.error('Error handling reaction:', error);
      }
    });

    // Error handlers
    this.client.on('shardError', error => logger.error('WebSocket error:', error));
    this.client.on('error', error => logger.error('Client error:', error));
    this.client.on('warn', warning => logger.warn(warning));
    this.client.on('shardDisconnect', (event, shardId) => 
      logger.error(`Shard ${shardId} disconnected: ${event.code} - ${event.reason}`)
    );
    this.client.on('shardReconnecting', (shardId) => logger.info(`Shard ${shardId} reconnecting...`));
    
    if (process.env.DEBUG === 'true') {
      this.client.on('debug', info => logger.debug(info));
    }
  }
}

if (require.main === module) {
  logger.info('Starting bot from main module');
  const bot = new DiscordBot();
  bot.start().catch(error => {
    logger.error('Unhandled error during bot startup:', error);
    process.exit(1);
  });
}

module.exports = DiscordBot;