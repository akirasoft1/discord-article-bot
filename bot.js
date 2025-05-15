const { Client, Intents } = require('discord.js');
const axios = require('axios');
const dotenv = require('dotenv');
const { Configuration, OpenAIApi } = require('openai');

dotenv.config();

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

client.once('ready', () => {
  console.log('Bot is online!');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = message.content.match(urlRegex);

  if (urls) {
    for (const url of urls) {
      console.log(`URL found: ${url}`);
      try {
        const archiveResponse = await axios.post('https://archive.is/submit/', { url });
        const archiveUrl = archiveResponse.data.url;

        const prompt = `Summarize this article in 1500 characters: ${url}`;
        console.log(`Prompt: ${prompt}`);

        const summaryResponse = await openai.createCompletion({
          model: 'text-davinci-002',
          prompt: prompt,
          max_tokens: 1500,
        });

        const summary = summaryResponse.data.choices[0].text.trim();

        message.channel.send(`Archived URL: ${archiveUrl}\nSummary: ${summary}`);
      } catch (error) {
        console.error('Error archiving or summarizing the article:', error);
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
