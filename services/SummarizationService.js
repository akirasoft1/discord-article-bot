// ===== services/SummarizationService.js =====
const axios = require('axios');
const logger = require('../logger');
const ArchiveService = require('./ArchiveService');
const UrlUtils = require('../utils/urlUtils');
const TokenService = require('./TokenService');
const CostService = require('./CostService');
const ResponseParser = require('./ResponseParser');
const TextUtils = require('../utils/textUtils');
const MongoService = require('./MongoService');
const PaywallService = require('./PaywallService');
const SourceCredibilityService = require('./SourceCredibilityService');
const PollService = require('./PollService');
const BingoService = require('./BingoService');

class SummarizationService {
  constructor(openaiClient, config, discordClient) {
    this.openaiClient = openaiClient;
    this.config = config;
    this.discordClient = discordClient;
    this.systemPrompt = null;
    this.isProcessing = false;
    this.mongoService = new MongoService(config.mongo.uri);
    this.sourceCredibilityService = new SourceCredibilityService(config);
    this.pollService = new PollService(openaiClient);
    this.bingoService = new BingoService(openaiClient);
    
    // Initialize services
    this.tokenService = new TokenService();
    this.costService = new CostService();
    this.responseParser = ResponseParser;
    
    // HTTP client for fetching archive content
    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: { 'User-Agent': 'Discord-Bot/1.0' }
    });

    

    
  }

  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
  }

  async processUrl(url, message, user, style = null, mood = null, narrator = null, historicalPerspective = null) {
    if (this.isProcessing) {
      logger.info('Already processing a URL, skipping.');
      return;
    }

    this.isProcessing = true;

    try {
      logger.info(`Processing URL: ${url}`);

      const existingArticle = await this.mongoService.findArticleByUrl(url);
      if (existingArticle) {
        const timeSince = new Date(existingArticle.createdAt).toLocaleDateString();
        await message.channel.send(`This article was already shared on ${timeSince} by @${existingArticle.username}.`);
        return;
      }

      if (UrlUtils.shouldSkipUrl(url)) {
        logger.info(`Skipping URL (image/gif): ${url}`);
        return;
      }

      if (this.isQuestionableSource(url)) {
        logger.info(`Flagging questionable source: ${url}`);
        await message.react('⚠️');
      }

      let processedUrl = url;
      if (await PaywallService.detectPaywall(url)) {
        logger.info(`Paywall detected for ${url}. Attempting to find an archived version.`);
        const archiveUrl = await PaywallService.findArchiveUrl(url);
        if (archiveUrl) {
          logger.info(`Found archived version: ${archiveUrl}`);
          processedUrl = archiveUrl;
          await message.channel.send(`Paywall detected. I'll use an archived version of the article.`);
        } else {
          logger.warn(`Could not find an archived version for ${url}.`);
          await message.channel.send(`I detected a paywall but couldn't find an archived version. I'll try to summarize it anyway.`);
        }
      }

      const finalUrl = await this.preprocessUrl(processedUrl, message);
      if (!finalUrl) return;

      let content = await this.fetchContent(finalUrl, message);
      if (content === false) return;

      let wasTranslated = false;
      let detectedLanguage = 'N/A';

      if (this.config.bot.autoTranslation.enabled) {
        const translationResult = await this.detectAndTranslate(content);
        content = translationResult.translatedText;
        wasTranslated = translationResult.wasTranslated;
        detectedLanguage = translationResult.detectedLanguage;
      }
      
      const result = await this.generateSummary(content, processedUrl, style, mood, narrator, historicalPerspective);
      
      if (!result) {
        await message.channel.send('Sorry, I could not generate a summary for this article.');
        return;
      }

      const enhancedResult = await this.enhanceSummary(result.summary, content);

      let relatedArticles = [];
      if (enhancedResult.topic) {
        relatedArticles = await this.mongoService.findRelatedArticles(enhancedResult.topic, url);
      }

      const sourceCredibility = this.sourceCredibilityService.rateSource(url);

      let context = null;
      if (enhancedResult.topic) {
        context = await this.provideContext(enhancedResult.topic);
      }

      const responseMessage = ResponseParser.buildDiscordMessage({
        ...result,
        ...enhancedResult,
        relatedArticles,
        sourceCredibility,
        context,
        wasTranslated,
        detectedLanguage,
      });
      
      if (!responseMessage) {
        logger.error('Failed to build response message');
        await message.channel.send('Sorry, I could not format the summary properly.');
        return;
      }

      await this.mongoService.persistData({
        userId: user.id,
        username: user.tag,
        url,
        inputTokens: result.tokens.input,
        outputTokens: result.tokens.output,
        topic: enhancedResult.topic, // Persist the topic
      });

      // Check and notify for follow-ups
      if (enhancedResult.topic) {
        await this.checkAndNotifyFollowUps(url, enhancedResult.topic, result.summary);
      }
      
      await message.reply({
        content: responseMessage,
        allowedMentions: { repliedUser: false }
      });

      // Generate and send poll
      const pollQuestion = await this.pollService.generatePoll(result.summary);
      if (pollQuestion) {
        await this.pollService.createDiscordPoll(message.channel, pollQuestion);
      }

      // Generate discussion questions
      const discussionQuestions = await this.pollService.generateDiscussionQuestions(result.summary);
      if (discussionQuestions) {
        await message.channel.send(`**Discussion Starters:**\n${discussionQuestions}`);
      }

      // Extract and send quote of the day
      const quote = await this.extractQuote(content || result.summary);
      if (quote) {
        await message.channel.send(`**Quote of the Day:**\n>>> ${quote}`);
      }

      // Generate and send Article Bingo card
      const bingoCard = await this.bingoService.generateBingoCard(result.summary);
      if (bingoCard) {
        const formattedBingoCard = this.bingoService.formatBingoCard(bingoCard);
        await message.channel.send(`**Article Bingo:**\n${formattedBingoCard}`);
      }
    } catch (error) {
      logger.error(`Error processing URL ${url}: ${error.message}`);
      await message.channel.send(`An unexpected error occurred while processing ${url}.`);
    } finally {
      this.isProcessing = false;
    }
  }

  async preprocessUrl(url, message) {
    if (!UrlUtils.isArchiveUrl(url)) {
      return url;
    }

    logger.info(`Processing archive URL: ${url}`);
    const result = ArchiveService.transformArchiveUrl(url);

    if (result.success) {
      return result.url;
    }

    await message.channel.send(result.userMessage);
    
    if (result.isShortlink) {
      logger.info(result.userMessage);
    } else {
      logger.error(`Archive URL transformation failed: ${result.error}`);
    }

    return null;
  }

  async fetchContent(url, message) {
    if (!url.startsWith('https://archive.today/TEXT/')) {
      return null; // Let OpenAI fetch it
    }

    try {
      logger.info(`Fetching content from: ${url}`);
      const response = await this.axiosInstance.get(url);
      logger.info(`Content fetched successfully. Length: ${response.data?.length || 0}`);
      return response.data;
    } catch (error) {
      logger.error(`Failed to fetch content from ${url}: ${error.message}`);
      await message.channel.send(`Sorry, I could not retrieve the content from the archive link.`);
      return false;
    }
  }

  async generateSummary(content, url, style = null, mood = null, narrator = null, historicalPerspective = null) {
    if (!this.systemPrompt) {
      logger.error('System prompt not loaded');
      return null;
    }

    const isContentProvided = Boolean(content);
    
    if (this.config.openai.method === 'response') {
      return await this.generateResponseSummary(content, url, isContentProvided, style, mood, narrator, historicalPerspective);
    } else {
      return await this.generateCompletionSummary(content, url, isContentProvided, style, mood, narrator, historicalPerspective);
    }
  }

  async generateResponseSummary(content, url, isContentProvided, style, mood, narrator, historicalPerspective) {
    let tokenData = null;
    let costData = null;
    let summary = null;
    
    try {
      const inputText = this.buildInputText(content, url, isContentProvided);
      let systemPrompt = this.systemPrompt;

      if (style && this.config.bot.summaryStyles.enabled && this.config.bot.summaryStyles.styles[style]) {
        systemPrompt += ` ${this.config.bot.summaryStyles.styles[style]}`;
      }

      if (mood && this.config.bot.moodBasedSummaries.enabled && this.config.bot.moodBasedSummaries.moods[mood]) {
        systemPrompt += ` ${this.config.bot.moodBasedSummaries.moods[mood]}`;
      }

      if (narrator && this.config.bot.celebrityNarrators.enabled && this.config.bot.celebrityNarrators.narrators[narrator]) {
        systemPrompt += ` ${this.config.bot.celebrityNarrators.narrators[narrator]}`;
      }

      if (historicalPerspective && this.config.bot.historicalPerspectives.enabled && this.config.bot.historicalPerspectives.perspectives[historicalPerspective]) {
        systemPrompt += ` ${this.config.bot.historicalPerspectives.perspectives[historicalPerspective]}`;
      }
      
      // Estimate tokens
      const inputTokenEstimate = this.tokenService.countTokens(inputText);
      const systemPromptTokens = this.tokenService.countTokens(systemPrompt);
      const totalInputTokensEstimate = (inputTokenEstimate || 0) + (systemPromptTokens || 0);
      
      logger.info(`Estimated input tokens: ${totalInputTokensEstimate} (content: ${inputTokenEstimate}, system: ${systemPromptTokens})`);

      // Call OpenAI API
      const response = await this.callOpenAIResponsesAPI(inputText, systemPrompt);
      
      // Process usage data if available
      if (response.usage) {
        const usageData = this.processUsageData(response.usage, totalInputTokensEstimate);
        tokenData = usageData.tokens;
        costData = usageData.costs;
      } else {
        logger.warn('No usage data in OpenAI response');
      }
      
      // Extract summary
      summary = ResponseParser.extractSummaryFromResponse(response);
      
      if (!summary) {
        return null;
      }

      // Log output token estimation
      if (response.usage?.output_tokens) {
        const estimatedOutputTokens = this.tokenService.countTokens(summary);
        this.tokenService.logTokenUsage(estimatedOutputTokens, response.usage.output_tokens, 'Output');
      }

      return {
        summary,
        tokens: tokenData,
        costs: costData
      };
    } catch (error) {
      logger.error('OpenAI API error (response method):', error);
      logger.error('Error stack:', error.stack);
      if (error.response) {
        logger.error(`Error response status: ${error.response.status}`);
        logger.error(`Error response data: ${JSON.stringify(error.response.data)}`);
      }
      return null;
    }
  }

  async generateCompletionSummary(content, url, isContentProvided, style, mood, narrator, historicalPerspective) {
    try {
      const userMessage = this.buildUserMessage(content, url, isContentProvided);
      let systemPrompt = this.systemPrompt;

      if (style && this.config.bot.summaryStyles.enabled && this.config.bot.summaryStyles.styles[style]) {
        systemPrompt += ` ${this.config.bot.summaryStyles.styles[style]}`;
      }

      if (mood && this.config.bot.moodBasedSummaries.enabled && this.config.bot.moodBasedSummaries.moods[mood]) {
        systemPrompt += ` ${this.config.bot.moodBasedSummaries.moods[mood]}`;
      }

      if (narrator && this.config.bot.celebrityNarrators.enabled && this.config.bot.celebrityNarrators.narrators[narrator]) {
        systemPrompt += ` ${this.config.bot.celebrityNarrators.narrators[narrator]}`;
      }

      if (historicalPerspective && this.config.bot.historicalPerspectives.enabled && this.config.bot.historicalPerspectives.perspectives[historicalPerspective]) {
        systemPrompt += ` ${this.config.bot.historicalPerspectives.perspectives[historicalPerspective]}`;
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ];
      
      // Estimate tokens
      const estimatedTokens = this.tokenService.estimateMessageTokens(messages);
      logger.info(`Estimated input tokens for completion method: ${estimatedTokens}`);

      // Call OpenAI/Ollama API
      const completion = await this.callCompletionAPI(messages);
      
      if (completion.error) {
        logger.error(`OpenAI API error: ${completion.error}`);
        return null;
      }

      // Log token usage if available (Ollama typically doesn't provide this)
      if (completion.usage) {
        logger.info(`Actual token usage - Input: ${completion.usage.prompt_tokens}, Output: ${completion.usage.completion_tokens}, Total: ${completion.usage.total_tokens}`);
      } else {
        logger.info('No token usage data available from Ollama');
      }

      const summary = ResponseParser.extractSummaryFromCompletion(completion);
      
      if (!summary) {
        logger.error('No summary text in response');
        return null;
      }

      // Log estimated output tokens
      const outputTokens = this.tokenService.countTokens(summary);
      logger.info(`Output token count (estimated with OpenAI tokenizer): ${outputTokens}`);

      return {
        summary,
        tokens: null, // Ollama doesn't provide token usage
        costs: null   // No cost data for local models
      };
    } catch (error) {
      logger.error('API error (completion method):', error);
      return null;
    }
  }

  // Helper methods
  buildInputText(content, url, isContentProvided) {
    return isContentProvided
      ? `Summarize the following text per your system prompt: ${content}`
      : `Summarize this article per your system prompt: ${url}`;
  }

  buildUserMessage(content, url, isContentProvided) {
    return isContentProvided
      ? `Summarize the following text in ${this.config.bot.maxSummaryLength} characters or less: ${content}`
      : `Summarize this article in ${this.config.bot.maxSummaryLength} characters or less: ${url}`;
  }

  async callOpenAIResponsesAPI(inputText, systemPrompt) {
    const startTime = Date.now();
    
    const response = await this.openaiClient.responses.create({
      model: this.config.openai.model, // Use model from config
      tools: [{ type: "web_search_preview" }],
      instructions: systemPrompt,
      input: inputText,
    });

    const duration = Date.now() - startTime;
    logger.info(`OpenAI API Response received (response method) - Duration: ${duration}ms`);
    
    return response;
  }

  async callCompletionAPI(messages) {
    const startTime = Date.now();

    const completion = await this.openaiClient.chat.completions.create({
      model: this.config.openai.model, // Use model from config
      messages: messages,
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: this.config.bot.maxSummaryLength,
    });

    const duration = Date.now() - startTime;
    logger.info(`API Response received (completion method) - Duration: ${duration}ms`);
    
    return completion;
  }

  processUsageData(usage, estimatedTokens) {
    const inputTokens = usage.input_tokens;
    const outputTokens = usage.output_tokens;
    const totalTokens = usage.total_tokens;
    const cachedTokens = usage.input_tokens_details?.cached_tokens || 0;
    
    logger.info(`Actual token usage - Input: ${inputTokens}, Output: ${outputTokens}, Total: ${totalTokens}`);
    
    if (cachedTokens > 0) {
      logger.info(`Cached tokens: ${cachedTokens}`);
    }
    
    // Calculate costs
    const costs = this.costService.calculateCosts(usage);
    this.costService.logCostBreakdown(costs, {
      regular: inputTokens - cachedTokens,
      cached: cachedTokens
    });
    
    // Update cumulative costs
    this.costService.updateCumulative(costs);
    
    // Log token estimation accuracy
    if (estimatedTokens) {
      this.tokenService.logTokenUsage(estimatedTokens, inputTokens, 'Input');
    }
    
    // Format for return
    const tokenData = {
      input: inputTokens,
      output: outputTokens,
      total: totalTokens,
      cached: cachedTokens
    };
    
    const costData = this.costService.formatCostBreakdown(costs);
    
    return { tokens: tokenData, costs: costData };
  }

  isQuestionableSource(url) {
    if (!this.config.bot.factChecker.enabled) {
      return false;
    }

    const { questionableSources } = this.config.bot.factChecker;
    if (!questionableSources || questionableSources.length === 0) {
      return false;
    }

    try {
      const { hostname } = new URL(url);
      return questionableSources.some(source => hostname.includes(source));
    } catch (error) {
      logger.error(`Invalid URL for fact-checking: ${url}`);
      return false;
    }
  }

  async enhanceSummary(summary, content) {
    const readingTime = TextUtils.calculateReadingTime(content || summary);

    let biasAnalysis = null;
    if (this.config.bot.biasDetection.enabled) {
      biasAnalysis = await this.analyzeBias(content || summary);
    }

    try {
      const enhancementPrompt = `Analyze the following text and provide:
1.  **Topic**: A single, relevant topic (e.g., Technology, Politics, Sports).
2.  **Sentiment**: A brief sentiment description (e.g., Positive, Negative, Neutral).

Text: """${summary}"""`;

      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: enhancementPrompt }],
        max_tokens: 50,
        temperature: 0.2,
      });

      const [topic, sentiment] = response.choices[0].message.content.split('\n').map(line => line.split(': ')[1]);

      return {
        readingTime,
        topic,
        sentiment,
        biasAnalysis,
      };
    } catch (error) {
      logger.error('Failed to enhance summary:', error);
      return {
        readingTime,
        topic: 'N/A',
        sentiment: 'N/A',
        biasAnalysis: null,
      };
    }
  }

  async analyzeBias(text) {
    try {
      const biasPrompt = `Analyze the following text for potential biases. Identify any specific types of bias (e.g., political, gender, racial, corporate) and provide a brief explanation for each. If no significant bias is detected, state that.

Text: """${text}"""

Bias Analysis:`;

      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: biasPrompt }],
        max_tokens: 200,
        temperature: 0.5,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Failed to analyze bias:', error);
      return 'N/A';
    }
  }

  async getAlternativePerspectiveSummary(content, url, perspective) {
    if (!this.config.bot.alternativePerspectives.enabled || !this.config.bot.alternativePerspectives.perspectives[perspective]) {
      return null;
    }

    try {
      const perspectivePrompt = this.config.bot.alternativePerspectives.perspectives[perspective];
      const userMessage = this.buildUserMessage(content, url, Boolean(content));
      const messages = [
        { role: 'system', content: perspectivePrompt },
        { role: 'user', content: userMessage },
      ];

      const completion = await this.callCompletionAPI(messages);
      if (completion.error) {
        logger.error(`OpenAI API error for alternative perspective: ${completion.error}`);
        return null;
      }
      return ResponseParser.extractSummaryFromCompletion(completion);
    } catch (error) {
      logger.error(`Failed to generate alternative perspective summary for ${perspective}: ${error.message}`);
      return null;
    }
  }

  async extractQuote(text) {
    try {
      const quotePrompt = `From the following text, extract a single, interesting, and thought-provoking quote. The quote should be directly from the text and stand alone well.

Text: """${text}"""

Quote:`;

      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: quotePrompt }],
        max_tokens: 150,
        temperature: 0.7,
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error('Failed to extract quote:', error);
      return null;
    }
  }
  async checkAndNotifyFollowUps(newArticleUrl, newArticleTopic, newArticleSummary) {
    if (!this.config.bot.followUpTracker.enabled || !newArticleTopic) {
      return;
    }

    try {
      const pendingFollowUps = await this.mongoService.getArticlesForFollowUp();

      for (const oldArticle of pendingFollowUps) {
        // Simple topic-based matching for now. Can be enhanced with more sophisticated similarity checks.
        if (oldArticle.topic && oldArticle.topic === newArticleTopic) {
          logger.info(`Found potential follow-up: New article (${newArticleUrl}) related to old article (${oldArticle.url})`);

          const notificationMessage = `**Follow-up Alert!**\nThere's a new article related to a story you were following:\nOld Article: <${oldArticle.url}>\nNew Article: <${newArticleUrl}>\n\n**Summary of New Article:**\n${newArticleSummary}\n\nThis follow-up has been marked as complete.`;

          for (const userId of oldArticle.followUpUsers) {
            try {
              const user = await this.discordClient.users.fetch(userId);
              if (user) {
                await user.send(notificationMessage);
                logger.info(`Notified user ${userId} about follow-up for ${oldArticle.url}`);
              }
            }
 catch (userError) {
              logger.error(`Could not send DM to user ${userId}: ${userError.message}`);
            }
          }
          await this.mongoService.updateFollowUpStatus(oldArticle.url, 'completed');
        }
      }
    }
 catch (error) {
      logger.error(`Error in checkAndNotifyFollowUps: ${error.message}`);
    }
  }

  async provideContext(topic) {
    if (!this.config.bot.contextProvider.enabled || !topic) {
      return null;
    }

    try {
      const contextPrompt = `${this.config.bot.contextProvider.prompt} ${topic}`;
      const response = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: contextPrompt }],
        max_tokens: 200,
        temperature: 0.5,
      });
      return response.choices[0].message.content.trim();
    } catch (error) {
      logger.error(`Failed to provide context for topic ${topic}: ${error.message}`);
      return null;
    }
  }

  async detectAndTranslate(text) {
    if (!this.config.bot.autoTranslation.enabled) {
      return { translatedText: text, detectedLanguage: 'N/A', wasTranslated: false };
    }

    try {
      const languageDetectionPrompt = `Detect the language of the following text and respond with only the language name (e.g., "English", "Spanish").

Text: """${text}"""`;

      const langResponse = await this.openaiClient.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: languageDetectionPrompt }],
        max_tokens: 20,
        temperature: 0.1,
      });
      const detectedLanguage = langResponse.choices[0].message.content.trim();

      if (detectedLanguage.toLowerCase() !== this.config.bot.autoTranslation.targetLanguage.toLowerCase()) {
        logger.info(`Detected language: ${detectedLanguage}. Translating to ${this.config.bot.autoTranslation.targetLanguage}.`);
        const translationPrompt = `Translate the following text from ${detectedLanguage} to ${this.config.bot.autoTranslation.targetLanguage}.

Text: """${text}"""`;

        const transResponse = await this.openaiClient.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: translationPrompt }],
          max_tokens: 2000,
          temperature: 0.3,
        });
        const translatedText = transResponse.choices[0].message.content.trim();
        return { translatedText, detectedLanguage, wasTranslated: true };
      } else {
        logger.info(`Detected language: ${detectedLanguage}. No translation needed.`);
        return { translatedText: text, detectedLanguage, wasTranslated: false };
      }
    } catch (error) {
      logger.error(`Error during language detection or translation: ${error.message}`);
      return { translatedText: text, detectedLanguage: 'N/A', wasTranslated: false };
    }
  }

  async generateMultiLanguageSummary(content, url, targetLanguages) {
    if (!this.config.bot.languageLearning.enabled || !targetLanguages || targetLanguages.length === 0) {
      return null;
    }

    const summaries = {};
    for (const lang of targetLanguages) {
      try {
        const translationPrompt = `Summarize the following article in ${lang}.\n\nArticle: """${content}"""`;
        const response = await this.openaiClient.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: translationPrompt }],
          max_tokens: this.config.bot.maxSummaryLength,
          temperature: 0.7,
        });
        summaries[lang] = response.choices[0].message.content.trim();
      } catch (error) {
        logger.error(`Failed to generate ${lang} summary: ${error.message}`);
        summaries[lang] = `Could not generate summary in ${lang}.`;
      }
    }
    return summaries;
  }

  async generateCulturalContextSummary(content, url, culturalContext) {
    if (!this.config.bot.culturalContext.enabled || !this.config.bot.culturalContext.contexts[culturalContext]) {
      return null;
    }

    try {
      const contextPrompt = this.config.bot.culturalContext.contexts[culturalContext];
      const userMessage = this.buildUserMessage(content, url, Boolean(content));
      const messages = [
        { role: 'system', content: contextPrompt },
        { role: 'user', content: userMessage },
      ];

      const completion = await this.callCompletionAPI(messages);
      if (completion.error) {
        logger.error(`OpenAI API error for cultural context: ${completion.error}`);
        return null;
      }
      return ResponseParser.extractSummaryFromCompletion(completion);
    } catch (error) {
      logger.error(`Failed to generate cultural context summary for ${culturalContext}: ${error.message}`);
      return null;
    }
  }
}

module.exports = SummarizationService;