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

    this.summarizationService = new SummarizationService(this.openaiClient, config, this.client);
    this.reactionHandler = new ReactionHandler(this.summarizationService, this.summarizationService.mongoService);
    this.rssService = new RssService(this.summarizationService.mongoService, this.summarizationService, this.client);
    this.followUpService = new FollowUpService(this.summarizationService.mongoService, this.summarizationService, this.client);
    this.subscriptionService = new SubscriptionService(this.summarizationService.mongoService);
    this.analyticsService = new AnalyticsService(this.summarizationService.mongoService);
    
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

      const args = message.content.slice(config.discord.prefix.length).trim().split(/ +/);
      const command = args.shift().toLowerCase();

      if (command === 'subscribe') {
        const topic = args.join(' ');
        const { success, message: replyMessage } = await this.subscriptionService.subscribe(message.author.id, topic);
        await message.reply(replyMessage);
      } else if (command === 'unsubscribe') {
        const topic = args.join(' ');
        const { success, message: replyMessage } = await this.subscriptionService.unsubscribe(message.author.id, topic);
        await message.reply(replyMessage);
      } else if (command === 'my_subscriptions') {
        const { success, message: replyMessage } = await this.subscriptionService.listSubscriptions(message.author.id);
        await message.reply(replyMessage);
      } else if (command === 'news_trends') {
        const trendsMessage = await this.analyticsService.getServerNewsTrends();
        await message.channel.send(trendsMessage);
      } else if (command === 'my_reading_habits') {
        const readingHabitsMessage = await this.analyticsService.getUserReadingHabits(message.author.id);
        await message.reply(readingHabitsMessage);
      } else if (command === 'popular_sources') {
        const popularSourcesMessage = await this.analyticsService.getPopularSources();
        await message.channel.send(popularSourcesMessage);
      } else if (command === 'controversy_meter') {
        const controversyMessage = await this.analyticsService.getControversyMeter();
        await message.channel.send(controversyMessage);
      } else if (command === 'summarize') {
        const url = args[0];
        const style = args[1]; // Optional style argument
        if (!url) {
          await message.reply('Please provide a URL to summarize.');
          return;
        }
        if (style && !config.bot.summaryStyles.styles[style]) {
          await message.reply(`Invalid summary style. Available styles: ${Object.keys(config.bot.summaryStyles.styles).join(', ')}`);
          return;
        }
        await this.summarizationService.processUrl(url, message, message.author, style);
      } else if (command === 'mood_summarize') {
        const url = args[0];
        const mood = args[1]; // Optional mood argument
        if (!url) {
          await message.reply('Please provide a URL to summarize.');
          return;
        }
        if (mood && !config.bot.moodBasedSummaries.moods[mood]) {
          await message.reply(`Invalid mood. Available moods: ${Object.keys(config.bot.moodBasedSummaries.moods).join(', ')}`);
          return;
        }
        await this.summarizationService.processUrl(url, message, message.author, null, mood);
      } else if (command === 'narrate_summarize') {
        const url = args[0];
        const narrator = args[1]; // Optional narrator argument
        if (!url) {
          await message.reply('Please provide a URL to summarize.');
          return;
        }
        if (narrator && !config.bot.celebrityNarrators.narrators[narrator]) {
          await message.reply(`Invalid narrator. Available narrators: ${Object.keys(config.bot.celebrityNarrators.narrators).join(', ')}`);
          return;
        }
        await this.summarizationService.processUrl(url, message, message.author, null, null, narrator);
      } else if (command === 'historical_summarize') {
        const url = args[0];
        const perspective = args[1]; // Optional historical perspective argument
        if (!url) {
          await message.reply('Please provide a URL to summarize.');
          return;
        }
        if (perspective && !config.bot.historicalPerspectives.perspectives[perspective]) {
          await message.reply(`Invalid historical perspective. Available perspectives: ${Object.keys(config.bot.historicalPerspectives.perspectives).join(', ')}`);
          return;
        }
        await this.summarizationService.processUrl(url, message, message.author, null, null, null, perspective);
      } else if (command === 'perspective_summarize') {
        const url = args[0];
        const perspective = args[1];
        if (!url || !perspective) {
          await message.reply('Please provide a URL and a perspective (e.g., liberal, conservative).');
          return;
        }
        if (!config.bot.alternativePerspectives.perspectives[perspective]) {
          await message.reply(`Invalid perspective. Available perspectives: ${Object.keys(config.bot.alternativePerspectives.perspectives).join(', ')}`);
          return;
        }
        const content = await this.summarizationService.fetchContent(url, message);
        if (content === false) return;
        const summary = await this.summarizationService.getAlternativePerspectiveSummary(content, url, perspective);
        if (summary) {
          await message.channel.send(`**Summary from ${perspective} perspective:**\n${summary}`);
        } else {
          await message.channel.send(`Sorry, I could not generate a summary from the ${perspective} perspective.`);
        }
      } else if (command === 'learn_language') {
        const url = args[0];
        const languages = args.slice(1).map(lang => lang.toLowerCase());
        if (!url || languages.length === 0) {
          await message.reply('Please provide a URL and at least one target language (e.g., !learn_language <url> Spanish French).');
          return;
        }
        const content = await this.summarizationService.fetchContent(url, message);
        if (content === false) return;
        const multiLanguageSummaries = await this.summarizationService.generateMultiLanguageSummary(content, url, languages);
        if (multiLanguageSummaries) {
          let responseMessage = '**Multi-language Summaries:**\n';
          for (const lang in multiLanguageSummaries) {
            responseMessage += `\n**${lang.charAt(0).toUpperCase() + lang.slice(1)}:**\n${multiLanguageSummaries[lang]}\n`;
          }
          await message.channel.send(responseMessage);
        } else {
          await message.channel.send('Sorry, I could not generate multi-language summaries.');
        }
      } else if (command === 'cultural_summarize') {
        const url = args[0];
        const culturalContext = args[1];
        if (!url || !culturalContext) {
          await message.reply('Please provide a URL and a cultural context (e.g., japanese, indian).');
          return;
        }
        if (!config.bot.culturalContext.contexts[culturalContext]) {
          await message.reply(`Invalid cultural context. Available contexts: ${Object.keys(config.bot.culturalContext.contexts).join(', ')}`);
          return;
        }
        const content = await this.summarizationService.fetchContent(url, message);
        if (content === false) return;
        const summary = await this.summarizationService.generateCulturalContextSummary(content, url, culturalContext);
        if (summary) {
          await message.channel.send(`**Summary from ${culturalContext} cultural context:**\n${summary}`);
        } else {
          await message.channel.send(`Sorry, I could not generate a summary with the ${culturalContext} cultural context.`);
        }
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