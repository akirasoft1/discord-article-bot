// bot.js - Cleaned up version
const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs').promises;
const config = require('./config/config');
const logger = require('./logger');
const SummarizationService = require('./services/SummarizationService');
const ReactionHandler = require('./handlers/ReactionHandler');
const RssService = require('./services/RssService');
const FollowUpService = require('./services/FollowUpService');
const SubscriptionService = require('./services/SubscriptionService');
const AnalyticsService = require('./services/AnalyticsService');
const MessageService = require('./services/MessageService');
const CommandHandler = require('./commands/CommandHandler');

// Import all command classes
const SubscribeCommand = require('./commands/subscription/SubscribeCommand');
const UnsubscribeCommand = require('./commands/subscription/UnsubscribeCommand');
const MySubscriptionsCommand = require('./commands/subscription/MySubscriptionsCommand');
const NewsTrendsCommand = require('./commands/analytics/NewsTrendsCommand');
const MyReadingHabitsCommand = require('./commands/analytics/MyReadingHabitsCommand');
const PopularSourcesCommand = require('./commands/analytics/PopularSourcesCommand');
const ControversyMeterCommand = require('./commands/analytics/ControversyMeterCommand');
const SummarizeCommand = require('./commands/summarization/SummarizeCommand');
const MoodSummarizeCommand = require('./commands/summarization/MoodSummarizeCommand');
const NarrateSummarizeCommand = require('./commands/summarization/NarrateSummarizeCommand');
const HistoricalSummarizeCommand = require('./commands/summarization/HistoricalSummarizeCommand');
const PerspectiveSummarizeCommand = require('./commands/summarization/PerspectiveSummarizeCommand');
const LearnLanguageCommand = require('./commands/summarization/LearnLanguageCommand');
const CulturalSummarizeCommand = require('./commands/summarization/CulturalSummarizeCommand');
const SummarizeWithContextCommand = require('./commands/summarization/SummarizeWithContextCommand');
const PollCommand = require('./commands/utility/PollCommand');
const DiscussionQuestionsCommand = require('./commands/utility/DiscussionQuestionsCommand');
const HelpCommand = require('./commands/utility/HelpCommand');

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
    this.subscriptionService = new SubscriptionService(this.summarizationService.mongoService);
    this.analyticsService = new AnalyticsService(this.summarizationService.mongoService);
    
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
    // Register subscription commands
    this.commandHandler.register(new SubscribeCommand(this.subscriptionService));
    this.commandHandler.register(new UnsubscribeCommand(this.subscriptionService));
    this.commandHandler.register(new MySubscriptionsCommand(this.subscriptionService));

    // Register analytics commands
    this.commandHandler.register(new NewsTrendsCommand(this.analyticsService));
    this.commandHandler.register(new MyReadingHabitsCommand(this.analyticsService));
    this.commandHandler.register(new PopularSourcesCommand(this.analyticsService));
    this.commandHandler.register(new ControversyMeterCommand(this.analyticsService));

    // Register summarization commands
    this.commandHandler.register(new SummarizeCommand(this.summarizationService));
    this.commandHandler.register(new MoodSummarizeCommand(this.summarizationService));
    this.commandHandler.register(new NarrateSummarizeCommand(this.summarizationService));
    this.commandHandler.register(new HistoricalSummarizeCommand(this.summarizationService));
    this.commandHandler.register(new PerspectiveSummarizeCommand(this.summarizationService));
    this.commandHandler.register(new LearnLanguageCommand(this.summarizationService));
    this.commandHandler.register(new CulturalSummarizeCommand(this.summarizationService));
    this.commandHandler.register(new SummarizeWithContextCommand(this.summarizationService));

    // Register utility commands
    this.commandHandler.register(new PollCommand(this.summarizationService));
    this.commandHandler.register(new DiscussionQuestionsCommand(this.summarizationService));
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

      if (config.bot.rssFeeds.enabled) {
        this.startRssFeedMonitoring();
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
  bot.start().catch(error => {
    logger.error('Unhandled error during bot startup:', error);
    process.exit(1);
  });
}

module.exports = DiscordBot;