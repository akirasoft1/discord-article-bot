// ===== services/SummarizationService.js =====
const axios = require('axios');
const logger = require('../logger');
const ArchiveService = require('./ArchiveService');
const UrlUtils = require('../utils/urlUtils');

class SummarizationService {
  constructor(openaiClient, config) {
    this.openaiClient = openaiClient;
    this.config = config;
    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: { 'User-Agent': 'Discord-Bot/1.0' }
    });
    this.systemPrompt = null; // Store system prompt
  }

  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
  }

  async processUrl(url, message) {
    logger.info(`Processing URL: ${url}`);

    if (UrlUtils.shouldSkipUrl(url)) {
      logger.info(`Skipping URL (image/gif): ${url}`);
      return;
    }

    try {
      const processedUrl = await this.preprocessUrl(url, message);
      if (!processedUrl) return; // Error already handled

      const content = await this.fetchContent(processedUrl, message);
      if (content === false) return; // Error was already sent to user
      
      const summary = await this.generateSummary(content, processedUrl);
      
      if (!summary) {
        await message.channel.send('Sorry, I could not generate a summary for this article.');
        return;
      }
      
      await message.reply({
        content: `Summary: ${summary}`,
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
      return false; // Signal that error was handled
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
    try {
      const inputText = isContentProvided
        ? `Summarize the following text per your system prompt: ${content}`
        : `Summarize this article per your system prompt: ${url}`;

      const response = await this.openaiClient.responses.create({
        model: 'gpt-4.1-mini',
        tools: [{ type: "web_search_preview" }],
        instructions: this.systemPrompt,
        input: inputText,
      });

      logger.info('OpenAI API Response received (response method)');
      
      const summary = response.output_text?.trim();
      if (!summary) {
        logger.error('No summary text in OpenAI response');
        return null;
      }

      return summary;
    } catch (error) {
      logger.error('OpenAI API error (response method):', error);
      return null;
    }
  }

  async generateCompletionSummary(content, url, isContentProvided) {
    try {
      const userMessage = isContentProvided
        ? `Summarize the following text in ${this.config.bot.maxSummaryLength} characters or less: ${content}`
        : `Summarize this article in ${this.config.bot.maxSummaryLength} characters or less: ${url}`;

      const completion = await this.openaiClient.chat.completions.create({
        model: 'gemma3:27b',
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: this.config.bot.maxSummaryLength,
      });

      logger.info('OpenAI API Response received (completion method)');

      if (completion.error) {
        logger.error(`OpenAI API error: ${completion.error}`);
        return null;
      }

      const summary = completion.choices[0]?.message?.content?.trim();
      if (!summary) {
        logger.error('No summary text in OpenAI response');
        return null;
      }

      return summary;
    } catch (error) {
      logger.error('OpenAI API error (completion method):', error);
      return null;
    }
  }
}

module.exports = SummarizationService;