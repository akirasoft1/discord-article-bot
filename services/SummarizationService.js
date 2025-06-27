// ===== services/SummarizationService.js =====
const axios = require('axios');
const logger = require('../logger');
const ArchiveService = require('./ArchiveService');
const UrlUtils = require('../utils/urlUtils');
const TokenService = require('./TokenService');
const CostService = require('./CostService');
const ResponseParser = require('./ResponseParser');
const MongoService = require('./MongoService');

class SummarizationService {
  constructor(openaiClient, config) {
    this.openaiClient = openaiClient;
    this.config = config;
    this.systemPrompt = null;
    
    // Initialize services
    this.tokenService = new TokenService();
    this.costService = new CostService();
    
    // HTTP client for fetching archive content
    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: { 'User-Agent': 'Discord-Bot/1.0' }
    });

    // Connect to MongoDB
    MongoService.connect();
  }

  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
  }

  async processUrl(url, message, user) {
    logger.info(`Processing URL: ${url}`);

    if (UrlUtils.shouldSkipUrl(url)) {
      logger.info(`Skipping URL (image/gif): ${url}`);
      return;
    }

    try {
      const processedUrl = await this.preprocessUrl(url, message);
      if (!processedUrl) return;

      const content = await this.fetchContent(processedUrl, message);
      if (content === false) return;
      
      const result = await this.generateSummary(content, processedUrl);
      
      if (!result) {
        await message.channel.send('Sorry, I could not generate a summary for this article.');
        return;
      }
      
      const responseMessage = ResponseParser.buildDiscordMessage(result);
      
      if (!responseMessage) {
        logger.error('Failed to build response message');
        await message.channel.send('Sorry, I could not format the summary properly.');
        return;
      }

      await MongoService.persistData({
        userId: user.id,
        username: user.tag,
        url,
        inputTokens: result.tokens.input,
        outputTokens: result.tokens.output,
      });
      
      await message.reply({
        content: responseMessage,
        allowedMentions: { repliedUser: false }
      });
    } catch (error) {
      logger.error(`Error processing URL ${url}: ${error.message}`);
      await message.channel.send(`An unexpected error occurred while processing ${url}.`);
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

  async generateSummary(content, url) {
    if (!this.systemPrompt) {
      logger.error('System prompt not loaded');
      return null;
    }

    const isContentProvided = Boolean(content);
    
    if (this.config.openai.method === 'response') {
      return await this.generateResponseSummary(content, url, isContentProvided);
    } else {
      return await this.generateCompletionSummary(content, url, isContentProvided);
    }
  }

  async generateResponseSummary(content, url, isContentProvided) {
    let tokenData = null;
    let costData = null;
    let summary = null;
    
    try {
      const inputText = this.buildInputText(content, url, isContentProvided);
      
      // Estimate tokens
      const inputTokenEstimate = this.tokenService.countTokens(inputText);
      const systemPromptTokens = this.tokenService.countTokens(this.systemPrompt);
      const totalInputTokensEstimate = (inputTokenEstimate || 0) + (systemPromptTokens || 0);
      
      logger.info(`Estimated input tokens: ${totalInputTokensEstimate} (content: ${inputTokenEstimate}, system: ${systemPromptTokens})`);

      // Call OpenAI API
      const response = await this.callOpenAIResponsesAPI(inputText);
      
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

  async generateCompletionSummary(content, url, isContentProvided) {
    try {
      const userMessage = this.buildUserMessage(content, url, isContentProvided);
      const messages = [
        { role: 'system', content: this.systemPrompt },
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

  async callOpenAIResponsesAPI(inputText) {
    const startTime = Date.now();
    
    const response = await this.openaiClient.responses.create({
      model: 'gpt-4.1-mini',
      tools: [{ type: "web_search_preview" }],
      instructions: this.systemPrompt,
      input: inputText,
    });

    const duration = Date.now() - startTime;
    logger.info(`OpenAI API Response received (response method) - Duration: ${duration}ms`);
    
    return response;
  }

  async callCompletionAPI(messages) {
    const startTime = Date.now();

    const completion = await this.openaiClient.chat.completions.create({
      model: 'gemma3:27b',
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
}

module.exports = SummarizationService;