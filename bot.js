// bot.js - Cleaned up version
// IMPORTANT: Tracing must be initialized FIRST before any other modules
// to ensure all HTTP calls and operations are properly instrumented
require('./tracing');

const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs').promises;
const config = require('./config/config');
const logger = require('./logger');
const { shutdownTracing } = require('./tracing');
const SummarizationService = require('./services/SummarizationService');
const ReactionHandler = require('./handlers/ReactionHandler');
const ReplyHandler = require('./handlers/ReplyHandler');
const RssService = require('./services/RssService');
const FollowUpService = require('./services/FollowUpService');
const MessageService = require('./services/MessageService');
const CommandHandler = require('./commands/CommandHandler');
const LinkwardenService = require('./services/LinkwardenService');
const LinkwardenPollingService = require('./services/LinkwardenPollingService');
const ChatService = require('./services/ChatService');

// Import command classes
const SummarizeCommand = require('./commands/summarization/SummarizeCommand');
const ReSummarizeCommand = require('./commands/summarization/ReSummarizeCommand');
const HelpCommand = require('./commands/utility/HelpCommand');
const ChatCommand = require('./commands/chat/ChatCommand');
const PersonalitiesCommand = require('./commands/chat/PersonalitiesCommand');
const ResetChatCommand = require('./commands/chat/ResetChatCommand');
const ResumeChatCommand = require('./commands/chat/ResumeChatCommand');

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

    this.messageService = new MessageService(this.openaiClient);
    this.summarizationService = new SummarizationService(this.openaiClient, config, this.client, this.messageService);
    this.reactionHandler = new ReactionHandler(this.summarizationService, this.summarizationService.mongoService);
    this.rssService = new RssService(this.summarizationService.mongoService, this.summarizationService, this.client);
    this.followUpService = new FollowUpService(this.summarizationService.mongoService, this.summarizationService, this.client);
    this.chatService = new ChatService(this.openaiClient, config, this.summarizationService.mongoService);
    this.replyHandler = new ReplyHandler(this.chatService, this.summarizationService, this.openaiClient, config);

    // Initialize Linkwarden services for self-hosted article archiving
    this.linkwardenService = null;
    this.linkwardenPollingService = null;
    if (config.linkwarden.enabled) {
      logger.info('Linkwarden integration is enabled');
      this.linkwardenService = new LinkwardenService(config);
      this.linkwardenPollingService = new LinkwardenPollingService(
        this.linkwardenService,
        this.summarizationService,
        this.client,
        config
      );
    }

    // Initialize command handler
    this.commandHandler = new CommandHandler();
    this.registerCommands();

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

  registerCommands() {
    // Register summarization commands
    this.commandHandler.register(new SummarizeCommand(this.summarizationService));
    this.commandHandler.register(new ReSummarizeCommand(this.summarizationService));

    // Register chat/personality commands
    this.commandHandler.register(new ChatCommand(this.chatService));
    this.commandHandler.register(new PersonalitiesCommand(this.chatService));
    this.commandHandler.register(new ResetChatCommand(this.chatService));
    this.commandHandler.register(new ResumeChatCommand(this.chatService));

    // Register utility commands
    this.commandHandler.register(new HelpCommand(this.commandHandler));

    logger.info(`Registered ${this.commandHandler.getAllCommands().length} commands`);
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

      // Start RSS feed monitoring if enabled
      if (config.bot.rssFeeds.enabled) {
        this.startRssFeedMonitoring();
      }

      // Start Linkwarden polling service if enabled
      if (config.linkwarden.enabled && this.linkwardenPollingService) {
        logger.info('Starting Linkwarden polling service...');
        const started = await this.linkwardenPollingService.start();
        if (started) {
          logger.info('Linkwarden polling service started successfully');
        } else {
          logger.error('Failed to start Linkwarden polling service - check configuration');
        }
      }
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

        // Handle follow-up reaction
        if (reaction.emoji.name === '📚') {
          const messageContent = reaction.message.content;
          const urlMatch = messageContent.match(/(https?:\/\/[^\s]+)/);
          if (urlMatch) {
            const url = urlMatch[0];
            const success = await this.followUpService.markForFollowUp(url, user.id);
            if (success) {
              await reaction.message.channel.send(`${user.username}, I'll keep an eye on this story for you!`);
            }
          }
        }

      } catch (error) {
        logger.error('Error handling reaction:', error);
      }
    });

    this.client.on('messageCreate', async message => {
      if (message.author.bot) return;

      // Check if this is a reply to a bot message
      if (message.reference && message.reference.messageId) {
        try {
          const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
          if (referencedMessage && referencedMessage.author.id === this.client.user.id) {
            const handled = await this.replyHandler.handleReply(message, referencedMessage);
            if (handled) return; // Reply was handled, don't process as command
          }
        } catch (error) {
          logger.error(`Error fetching referenced message: ${error.message}`);
        }
      }

      // Handle commands
      if (!message.content.startsWith(config.discord.prefix)) return;

      const args = message.content.slice(config.discord.prefix.length).trim().split(/ +/);
      const commandName = args.shift().toLowerCase();

      // Pass the bot context which includes all services
      const context = {
        bot: this,
        config: config
      };

      await this.commandHandler.execute(message, commandName, args, context);
    });

    this.client.on('interactionCreate', async interaction => {
      if (!interaction.isButton()) return;

      if (interaction.customId === 'poll_yes' || interaction.customId === 'poll_no') {
        await interaction.reply({ content: `You voted ${interaction.customId === 'poll_yes' ? 'Yes' : 'No'}!`, ephemeral: true });
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

  startRssFeedMonitoring() {
    const { rssFeeds } = config.bot;
    if (!rssFeeds.enabled || rssFeeds.feeds.length === 0) {
      logger.info('RSS feed monitoring is disabled or no feeds configured.');
      return;
    }

    logger.info(`Starting RSS feed monitoring for ${rssFeeds.feeds.length} feeds every ${rssFeeds.intervalMinutes} minutes.`);

    const checkFeeds = async () => {
      for (const feedConfig of rssFeeds.feeds) {
        try {
          const newArticles = await this.rssService.getNewArticles(feedConfig.url);
          if (newArticles.length > 0) {
            logger.info(`Found ${newArticles.length} new articles from ${feedConfig.url}`);
            const targetChannel = await this.client.channels.fetch(feedConfig.channelId);
            if (targetChannel && targetChannel.isTextBased()) {
              for (const article of newArticles) {
                // Summarize and post the article
                await this.summarizationService.processUrl(article.link, { channel: targetChannel }, this.client.user);
              }
            } else {
              logger.error(`Target channel ${feedConfig.channelId} not found or is not a text channel.`);
            }
          }
        } catch (error) {
          logger.error(`Error processing RSS feed ${feedConfig.url}: ${error.message}`);
        }
      }
    };

    // Run immediately and then set interval
    checkFeeds();
    setInterval(checkFeeds, rssFeeds.intervalMinutes * 60 * 1000);

    // Start follow-up monitoring
    if (config.bot.followUpTracker.enabled) {
      logger.info(`Starting follow-up monitoring every ${config.bot.followUpTracker.intervalMinutes} minutes.`);
      setInterval(() => this.followUpService.checkFollowUps(), config.bot.followUpTracker.intervalMinutes * 60 * 1000);
    }
  }
}

if (require.main === module) {
  logger.info('Starting bot from main module');
  const bot = new DiscordBot();

  // Graceful shutdown handler
  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, initiating graceful shutdown...`);
    try {
      // Stop Linkwarden polling if active
      if (bot.linkwardenPollingService) {
        bot.linkwardenPollingService.stop();
      }
      // Destroy Discord client
      bot.client.destroy();
      // Shutdown tracing to flush any pending spans
      await shutdownTracing();
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  bot.start().catch(error => {
    logger.error('Unhandled error during bot startup:', error);
    process.exit(1);
  });
}

module.exports = DiscordBot;