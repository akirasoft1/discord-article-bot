const { Client, Intents } = require('discord.js'); // Assuming CommonJS for discord.js if imports are mixed
const axios = require('axios'); // Assuming CommonJS
const dotenv = require('dotenv');
const OpenAI = require('openai'); // Assuming CommonJS
const fs = require('fs').promises;
const logger = require('./logger'); // Import the logger

// Define helper functions in the module scope
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

dotenv.config(); // Configure dotenv early

// Moved transformArchiveUrl to module scope
function transformArchiveUrl(archiveUrlString) {
  // Input: an archiveUrlString that isArchiveUrl has already confirmed to be an archive URL.
  // Output:
  //  - { status: 'success', resultUrl: 'https://archive.today/TEXT/...' }
  //  - { status: 'error', message: 'User-facing error message', errorLog: 'Detailed error for logging' }
  // This function does NOT send discord messages.
  try {
    const parsedUrl = new URL(archiveUrlString);
    const pathOfArchiveUrl = parsedUrl.pathname;
    
    let extractedOriginalUrlString;
    const httpMarker = '/http://';
    const httpsMarker = '/https://';

    let httpIndex = pathOfArchiveUrl.indexOf(httpMarker);
    let httpsIndex = pathOfArchiveUrl.indexOf(httpsMarker);

    let startIndex = -1;

    if (httpIndex !== -1 && (httpsIndex === -1 || httpIndex < httpsIndex)) {
        startIndex = httpIndex;
    } else if (httpsIndex !== -1) {
        startIndex = httpsIndex;
    }

    if (startIndex !== -1) {
      // Extract the embedded URL string starting after the initial '/' of the marker
      extractedOriginalUrlString = pathOfArchiveUrl.substring(startIndex + 1);

      // Apply protocol fixup
      if (extractedOriginalUrlString.startsWith('http:/') && !extractedOriginalUrlString.startsWith('http://')) {
        extractedOriginalUrlString = extractedOriginalUrlString.replace('http:/', 'http://');
      } else if (extractedOriginalUrlString.startsWith('https:/') && !extractedOriginalUrlString.startsWith('https://')) {
        extractedOriginalUrlString = extractedOriginalUrlString.replace('https:/', 'https://');
      }

      try {
        const originalUrlObj = new URL(extractedOriginalUrlString); // Validate and parse

        // Add new validation checks here
        if (originalUrlObj.protocol !== 'http:' && originalUrlObj.protocol !== 'https:') {
          const errorLog = `[transformArchiveUrl] Invalid embedded URL protocol for '${extractedOriginalUrlString}'. Protocol: '${originalUrlObj.protocol}'.`;
          const message = `Sorry, I could not correctly process the archive link: ${archiveUrlString}. The embedded link has an unsupported protocol.`;
          return { status: 'error', resultUrl: archiveUrlString, message, errorLog };
        }

        if (!originalUrlObj.hostname) {
          const errorLog = `[transformArchiveUrl] Invalid embedded URL (empty hostname) for '${extractedOriginalUrlString}'. Hostname: '${originalUrlObj.hostname}'.`;
          const message = `Sorry, I could not correctly process the archive link: ${archiveUrlString}. The embedded link is missing a hostname.`;
          return { status: 'error', resultUrl: archiveUrlString, message, errorLog };
        }
        
        // Optional stricter hostname check: (uncomment if needed, for now, the above are primary)
        // if (!originalUrlObj.hostname.includes('.') && originalUrlObj.hostname !== 'localhost') {
        //   const errorLog = `[transformArchiveUrl] Invalid embedded URL hostname (no dot and not localhost) for '${extractedOriginalUrlString}'. Hostname: '${originalUrlObj.hostname}'.`;
        //   const message = `Sorry, I could not correctly process the archive link: ${archiveUrlString}. The embedded link hostname appears invalid.`;
        //   return { status: 'error', resultUrl: archiveUrlString, message, errorLog };
        // }

        // Reconstruct the full original URL string including search (query) and hash
        const reconstructedEmbeddedUrl = originalUrlObj.protocol + '//' + 
                                        originalUrlObj.host + // .host includes hostname and port if any
                                        originalUrlObj.pathname + 
                                        originalUrlObj.search + 
                                        originalUrlObj.hash;
        
        const resultUrl = `https://archive.today/TEXT/${reconstructedEmbeddedUrl}`;
        logger.info(`[transformArchiveUrl] Transformed '${archiveUrlString}' to '${resultUrl}'`);
        return { status: 'success', resultUrl };
      } catch (e) {
        // This catch block now primarily handles errors from `new URL(extractedOriginalUrlString)` itself (e.g., completely unparseable string)
        const errorLog = `[transformArchiveUrl] Failed to parse extracted original URL '${extractedOriginalUrlString}' from archive link: ${archiveUrlString}. Error: ${e.message}`;
        const message = `Sorry, I could not correctly process the archive link: ${archiveUrlString}. The embedded link appears invalid or unparseable.`;
        return { status: 'error', resultUrl: archiveUrlString, message, errorLog };
      }
    } else {
      // No 'http:' or 'https:' found in path segments. This could be a shortlink or a malformed path.
      const pathSegmentsFiltered = pathSegments.filter(Boolean); // Filter out empty strings from split
      if (pathSegmentsFiltered.length === 1 && pathSegmentsFiltered[0].length > 0 && !pathSegmentsFiltered[0].includes('.')) {
        // Likely a shortlink, e.g., /vdNld (no dots, single segment)
        const errorLog = `[transformArchiveUrl] Archive link ${archiveUrlString} is a shortlink. No embedded URL found in path. Pathname: ${parsedUrl.pathname}`;
        const message = `Archive link ${archiveUrlString} appears to be a shortlink and cannot be directly converted to a text-only version. Please try accessing it in a browser first.`;
        return {
          status: 'untransformable_shortlink',
          resultUrl: archiveUrlString, // The original shortlink
          message,
          errorLog
        };
      } else {
        // Not a clear shortlink, and no embedded URL found
        const errorLog = `[transformArchiveUrl] Could not find an embedded URL in the path of archive link: ${archiveUrlString}. Path: ${parsedUrl.pathname}`;
        const message = `Sorry, I could not correctly process the archive link: ${archiveUrlString}. The structure is unrecognized or does not contain an embedded URL.`;
        return { status: 'error', message, errorLog };
      }
    }
  } catch (e) {
    // Error parsing the archiveUrlString itself
    const errorLog = `[transformArchiveUrl] Error parsing the archive URL '${archiveUrlString}' itself. Error: ${e.message}`;
    const message = `Sorry, the archive link ${archiveUrlString} appears to be malformed.`;
    return { status: 'error', message, errorLog };
  }
}

// Moved processUrlForSummarization to module scope
async function processUrlForSummarization(url, message, openaiClient, currentSystemPrompt, axiosInstance, localLogger) {
  localLogger.info(`[processUrlForSummarization] Processing URL: ${url}`);
  let urlToFetchContentFrom = url;

  if (isArchiveUrl(url)) { // This call should now be fine
    localLogger.info(`[processUrlForSummarization] Archive URL detected: ${url}`);
    const transformResult = transformArchiveUrl(url); 

    if (transformResult.status === 'success') {
      urlToFetchContentFrom = transformResult.resultUrl;
    } else if (transformResult.status === 'untransformable_shortlink') {
      localLogger.info(`[processUrlForSummarization] ${transformResult.errorLog}`); // Using info as it's an expected case
      message.channel.send(transformResult.message);
      return; // Stop processing for this URL
    } else { // Handles 'error' status from transformArchiveUrl
      localLogger.error(`[processUrlForSummarization] Error during URL transformation: ${transformResult.errorLog}`);
      message.channel.send(transformResult.message);
      return; 
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
        return; 
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

    const method = process.env.OPENAI_METHOD || 'completion'; 

    // Check for GIF hosting sites first
    const gifHosts = ['tenor.com', 'giphy.com', 'imgur.com'];
    const isGifHost = gifHosts.some(host => url.toLowerCase().includes(host));

    if (isGifHost) {
      localLogger.info(`[processUrlForSummarization] Skipping GIF hosting URL: ${url}`);
      return; 
    }

    // Then check for image extensions, if not a GIF host
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    const isImageUrl = imageExtensions.some(ext => url.toLowerCase().endsWith(ext));

    if (isImageUrl) {
      localLogger.info(`[processUrlForSummarization] Skipping image URL: ${url}`);
      return; 
    }

    if (method === 'response') {
      const responseData = await openaiClient.responses.create({ // Renamed 'response' to 'responseData'
        model: 'gpt-4.1-nano',
        instructions: currentSystemPrompt,
        input: responseInputContent,
      });

      localLogger.info('[processUrlForSummarization] OpenAI API Response (response method):', responseData);
      const summary = responseData.output_text?.trim();

      if (!summary) {
        localLogger.error('[processUrlForSummarization] No summary text found in OpenAI response (response method).');
        message.channel.send('Sorry, I could not generate a summary for this article.');
        return;
      }
      message.reply({ content: `Summary: ${summary}`, allowedMentions: { repliedUser: false } });
    } else { 
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


// IIFE for client setup and event handling
(async () => {
  // Note: discord.js, axios, openai, fs are already required at the top level.
  // logger is also at the top level.
  // dotenv.config() has been called.

  const client = new Client({
    intents: [
      Intents.FLAGS.GUILDS,
      Intents.FLAGS.GUILD_MESSAGES,
      Intents.FLAGS.GUILD_MESSAGE_REACTIONS
    ]
  });

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1/',
  });

  let systemPromptContent = ''; // Initialize systemPromptContent

  client.once('ready', async () => { // Make ready handler async
    try {
      systemPromptContent = await fs.readFile('prompt.txt', 'utf-8');
      logger.info('System prompt loaded successfully.');
    } catch (err) {
      logger.error('Failed to load system prompt:', err);
      // Handle error appropriately, e.g., by setting a default prompt or exiting
    }
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
  
  client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.emoji.name !== '📰') return; 
    if (reaction.count > 1) return; 

    const message = reaction.message;
    // Axios and OpenAI are now from the module scope, no need for localAxios/localOpenAI
    
    logger.info(`Newspaper emoji reaction added by ${user.tag} to message: ${message.content}`);

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);

    if (!urls) {
      logger.info('No URL found in the message. Skipping summarization.');
      return;
    }

    for (const url of urls) {
      // Pass systemPromptContent which is loaded on 'ready'
      await processUrlForSummarization(url, message, openai, systemPromptContent, axios, logger);
    }
  });

  client.on('messageReactionAdd', (reaction, user) => { // This seems like a duplicate event listener.
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