(async () => {
  const { Client, Intents } = await import('discord.js');
  const axios = (await import('axios')).default;
  const dotenv = (await import('dotenv')).default;
  const OpenAI = (await import('openai')).default;
  const fs = (await import('fs')).promises;
  const logger = require('./logger'); // Import the logger

  function isArchiveUrl(urlString) {
    const archiveHostnames = [
      'archive.is',
      'archive.today',
      'archive.ph',
      'archive.li',
      'archive.vn',
      'archive.md',
      'archive.fo',
      'archive.gg',
      'archive.wiki',
    ];
    try {
      const url = new URL(urlString);
      return archiveHostnames.includes(url.hostname);
    } catch (error) {
      // Invalid URL or other error
      logger.warn(`isArchiveUrl: Error parsing URL '${urlString}': ${error.message}`);
      return false;
    }
  }

  dotenv.config();

  const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS
  ],
  });

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1/', // Get baseURL from environment variable
  });

  const systemPrompt = await fs.readFile('prompt.txt', 'utf-8');

  client.once('ready', () => {
    logger.info('Bot is online and connected to Discord APIs!');
  });

  client.on('shardError', (error) => {
    logger.error('A WebSocket connection encountered an error:', error);
  });

  client.on('debug', (info) => {
    logger.debug(`DEBUG: ${info}`);
  });

  client.on('warn', (warning) => {
    logger.warn(`WARNING: ${warning}`);
  });

  client.on('error', (error) => {
    logger.error('An error occurred:', error);
  });

  client.on('disconnect', (event) => {
    logger.error(`Disconnected from Discord Gateway with code: ${event.code}, reason: ${event.reason}`);
  });

  client.on('reconnecting', () => {
    logger.info('Reconnecting to Discord Gateway...');
  });

  // ... (logger and other imports) ...

  function transformArchiveUrl(archiveUrlString) {
    // Input: an archiveUrlString that isArchiveUrl has already confirmed to be an archive URL.
    // Output:
    //  - { status: 'success', resultUrl: 'https://archive.today/TEXT/...' }
    //  - { status: 'error', message: 'User-facing error message', errorLog: 'Detailed error for logging' }
    // This function does NOT send discord messages.
    try {
      const parsedUrl = new URL(archiveUrlString);
      const pathSegments = parsedUrl.pathname.split('/');
      let originalUrlPathIndex = -1;

      for (let i = 0; i < pathSegments.length; i++) {
        if (pathSegments[i].startsWith('http:') || pathSegments[i].startsWith('https:')) {
          originalUrlPathIndex = i;
          break;
        }
      }

      if (originalUrlPathIndex !== -1) {
        let originalUrl = pathSegments.slice(originalUrlPathIndex).join('/');
        if (originalUrl.startsWith('http:/') && !originalUrl.startsWith('http://')) {
          originalUrl = originalUrl.replace('http:/', 'http://');
        } else if (originalUrl.startsWith('https:/') && !originalUrl.startsWith('https://')) {
          originalUrl = originalUrl.replace('https:/', 'https://');
        }

        try {
          new URL(originalUrl); // Validate
          const resultUrl = `https://archive.today/TEXT/${originalUrl}`;
          logger.info(`[transformArchiveUrl] Transformed '${archiveUrlString}' to '${resultUrl}'`);
          return { status: 'success', resultUrl };
        } catch (e) {
          const errorLog = `[transformArchiveUrl] Failed to validate extracted original URL '${originalUrl}' from archive link: ${archiveUrlString}. Error: ${e.message}`;
          const message = `Sorry, I could not correctly process the archive link: ${archiveUrlString}. The embedded link appears invalid.`;
          return { status: 'error', message, errorLog };
        }
      } else {
        const errorLog = `[transformArchiveUrl] Could not find an embedded URL in the path of archive link: ${archiveUrlString}. Path: ${parsedUrl.pathname}`;
        const message = `Sorry, I could not correctly process the archive link: ${archiveUrlString}. The structure is unrecognized.`;
        return { status: 'error', message, errorLog };
      }
    } catch (e) {
      // Error parsing the archiveUrlString itself
      const errorLog = `[transformArchiveUrl] Error parsing the archive URL '${archiveUrlString}' itself. Error: ${e.message}`;
      const message = `Sorry, the archive link ${archiveUrlString} appears to be malformed.`;
      return { status: 'error', message, errorLog };
    }
  }


  // ... (client setup, other event handlers) ...

async function processUrlForSummarization(url, message, openaiClient, currentSystemPrompt, axiosInstance, localLogger) {
  localLogger.info(`[processUrlForSummarization] Processing URL: ${url}`);
  let urlToFetchContentFrom = url;

  if (isArchiveUrl(url)) {
    localLogger.info(`[processUrlForSummarization] Archive URL detected: ${url}`);
    const transformResult = transformArchiveUrl(url); // transformArchiveUrl uses its own logger calls

    if (transformResult.status === 'success') {
      urlToFetchContentFrom = transformResult.resultUrl;
    } else {
      localLogger.error(`[processUrlForSummarization] Original error log: ${transformResult.errorLog}`);
      message.channel.send(transformResult.message);
      return; // Skip this URL
    }
  }

  try {
    let articleContent = null;
    if (urlToFetchContentFrom.startsWith('https://archive.today/TEXT/')) {
      localLogger.info(`[processUrlForSummarization] Fetching content directly from text-only archive URL: ${urlToFetchContentFrom}`);
      try {
        const response = await axiosInstance.get(urlToFetchContentFrom);
        articleContent = response.data;
        localLogger.info(`[processUrlForSummarization] Successfully fetched content from ${urlToFetchContentFrom}. Content length: ${articleContent?.length}`);
      } catch (fetchError) {
        localLogger.error(`[processUrlForSummarization] Error fetching content from ${urlToFetchContentFrom}: ${fetchError.message}`);
        message.channel.send(`Sorry, I could not retrieve the content from the archive link: ${url}. It might be unavailable or there was an issue.`);
        return; // Skip this URL
      }
    }

    let responseInputContent;
    let chatCompletionUserMessage;

    if (articleContent) {
      localLogger.info('[processUrlForSummarization] Sending fetched article content to OpenAI for summarization.');
      responseInputContent = `Summarize the following text per your system prompt: ${articleContent}`;
      chatCompletionUserMessage = `Summarize the following text in 1500 characters or less: ${articleContent}`;
    } else {
      localLogger.info(`[processUrlForSummarization] Sending URL to OpenAI for summarization: ${urlToFetchContentFrom}`);
      responseInputContent = `Summarize this article per your system prompt: ${urlToFetchContentFrom}`;
      chatCompletionUserMessage = `Summarize this article in 1500 characters or less: ${urlToFetchContentFrom}`;
    }

    const method = process.env.OPENAI_METHOD || 'completion'; // Default to 'completion'

    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    // Use original 'url' for image and GIF checks, not 'urlToFetchContentFrom'
    const isImageUrl = imageExtensions.some(ext => url.toLowerCase().endsWith(ext));

    if (isImageUrl) {
      localLogger.info(`[processUrlForSummarization] Skipping image URL: ${url}`);
      return; // Skip this URL
    }

    const gifHosts = ['tenor.com', 'giphy.com', 'imgur.com'];
    const isGifHost = gifHosts.some(host => url.toLowerCase().includes(host));

    if (isGifHost) {
      localLogger.info(`[processUrlForSummarization] Skipping GIF hosting URL: ${url}`);
      return; // Skip this URL
    }

    if (method === 'response') {
      const response = await openaiClient.responses.create({
        model: 'gpt-4.1-nano',
        instructions: currentSystemPrompt,
        input: responseInputContent,
      });

      localLogger.info('[processUrlForSummarization] OpenAI API Response (response method):', response);
      const summary = response.output_text?.trim();

      if (!summary) {
        localLogger.error('[processUrlForSummarization] No summary text found in OpenAI response (response method).');
        message.channel.send('Sorry, I could not generate a summary for this article.');
        return;
      }
      message.reply({ content: `Summary: ${summary}`, allowedMentions: { repliedUser: false } });
    } else { // completion method
      const completion = await openaiClient.chat.completions.create({
        model: 'gemma3:27b',
        messages: [
          { role: 'system', content: currentSystemPrompt },
          { role: 'user', content: chatCompletionUserMessage },
        ],
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 1500,
      });

      localLogger.info('[processUrlForSummarization] OpenAI API Response (completion method):', completion);
      if (completion.error) {
        localLogger.error('[processUrlForSummarization] Error from OpenAI API (completion method):', completion.error);
        message.channel.send('Sorry, I could not summarize this article at the moment.');
        return;
      }

      const summary = completion.choices[0].message.content.trim();

      if (!summary) {
        localLogger.error('[processUrlForSummarization] No summary text found in OpenAI response (completion method).');
        message.channel.send('Sorry, I could not generate a summary for this article.');
        return;
      }
      message.reply({ content: `Summary: ${summary}`, allowedMentions: { repliedUser: false } });
    }
  } catch (error) {
    localLogger.error(`[processUrlForSummarization] Error summarizing the article for URL ${url}: ${error.message}`, error);
    message.channel.send(`An unexpected error occurred while trying to summarize ${url}.`);
  }
}

  client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.emoji.name !== '📰') return; // Check if the reaction is the newspaper emoji
    if (reaction.count > 1) return; // Ensure it's the first reaction

    const message = reaction.message;
    // Ensure axios and openai are the instances initialized in the IIFE
    const localAxios = axios; 
    const localOpenAI = openai;

    logger.info(`Newspaper emoji reaction added by ${user.tag} to message: ${message.content}`);

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);

    if (!urls) {
      logger.info('No URL found in the message. Skipping summarization.');
      return;
    }

    for (const url of urls) {
      // Call the refactored processing function for each URL
      // Pass the correct logger instance (the one initialized in the IIFE)
      await processUrlForSummarization(url, message, localOpenAI, systemPrompt, localAxios, logger);
    }
  });

  client.on('messageReactionAdd', (reaction, user) => {
    logger.info(`Reaction added: ${reaction.emoji.name} by ${user.tag} to message: ${reaction.message.content}`);
  });

  client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.emoji.name !== 'Rocking') return; // Check if the reaction is the newspaper emoji
    if (reaction.count > 1) return; // Ensure it's the first reaction
    const message = reaction.message;
    message.reply({ content: `heh heh heh heh heh`, allowedMentions: { repliedUser: false } });
  });


  client.login(process.env.DISCORD_TOKEN);
})();

module.exports = { isArchiveUrl, transformArchiveUrl, processUrlForSummarization };