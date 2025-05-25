(async () => {
  const { Client, Intents } = await import('discord.js');
  const axios = (await import('axios')).default;
  const dotenv = (await import('dotenv')).default;
  const OpenAI = (await import('openai')).default;
  const fs = (await import('fs')).promises;
  const logger = require('./logger'); // Import the logger

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

  client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.emoji.name !== '📰') return; // Check if the reaction is the newspaper emoji
    if (reaction.count > 1) return; // Ensure it's the first reaction

    const message = reaction.message;
    logger.info(`Newspaper emoji reaction added by ${user.tag} to message: ${message.content}`);

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.content.match(urlRegex);

    if (!urls) {
      logger.info('No URL found in the message. Skipping summarization.');
      return;
    }

    for (const url of urls) {
      logger.info(`URL found: ${url}`);
      try {
        const prompt = `Summarize this article based on your system prompt: ${url}`;
        logger.info(`Prompt: ${prompt}`);

        const method = process.env.OPENAI_METHOD || 'completion'; // Default to 'completion'

        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
        const isImageUrl = imageExtensions.some(ext => url.toLowerCase().endsWith(ext));

        if (isImageUrl) {
          logger.info(`Skipping image URL: ${url}`);
          continue;
        }

        const gifHosts = ['tenor.com', 'giphy.com', 'imgur.com'];
        const isGifHost = gifHosts.some(host => url.toLowerCase().includes(host));

        if (isGifHost) {
          logger.info(`Skipping GIF hosting URL: ${url}`);
          continue;
        }

        if (method === 'response') {
          const response = await openai.responses.create({
            model: 'gpt-4.1-nano',
            instructions: systemPrompt, // Use the system prompt as instructions
            input: `Summarize this article per your system prompt: ${url}`, // User input
          });

          logger.info('API Response:', response);
          const summary = response.output_text?.trim();

          if (!summary) {
            logger.error('No summary text found in the response.');
            message.channel.send('Sorry, I could not generate a summary for this article.');
            return;
          }
          //message.channel.send(`Summary: ${summary}`);
          message.reply({ content: `Summary: ${summary}`, allowedMentions: { repliedUser: false } });
        } else {
          const completion = await openai.chat.completions.create({
            //model: 'gemma3:12b-it-qat',
            //model: 'gemma3:12b',
            model: 'gemma3:27b',
            // model: 'llama3.3:70b-instruct-q2_K',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Summarize this article in 1500 characters or less: ${url}` },
            ],
            temperature: 0.7,
            top_p: 0.95,              
            max_tokens: 1500,
          });

          logger.info('API Response:', completion);
          if (completion.error) {
            logger.error('Error from OpenAI API:', completion.error);
            message.channel.send('Sorry, I could not summarize this article at the moment.');
            return;
          }

          const summary = completion.choices[0].message.content.trim();

          if (!summary) {
            logger.error('No summary text found in the response.');
            message.channel.send('Sorry, I could not generate a summary for this article.');
            return;
          }

          //message.channel.send(`Summary: ${summary}`);
          message.reply({ content: `Summary: ${summary}`, allowedMentions: { repliedUser: false } });
        }
      } catch (error) {
        logger.error('Error summarizing the article:', error);
      }
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