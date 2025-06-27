// config/config.js
const dotenv = require('dotenv');
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['DISCORD_TOKEN', 'OPENAI_API_KEY', 'MONGO_URI'];
const missing = requiredEnvVars.filter(v => !process.env[v]);

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Please check your .env file');
  process.exit(1);
}

// Optional environment variables with defaults
const optionalEnvVars = {
  OPENAI_BASE_URL: 'http://localhost:11434/v1/',
  OPENAI_METHOD: 'completion',
  DEBUG: 'false'
};

// Log warnings for optional vars if needed
Object.entries(optionalEnvVars).forEach(([key, defaultValue]) => {
  if (!process.env[key]) {
    console.warn(`Optional env var ${key} not set, using default: ${defaultValue}`);
  }
});

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    intents: ['Guilds', 'GuildMessages', 'GuildMessageReactions', 'MessageContent']
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || optionalEnvVars.OPENAI_BASE_URL,
    method: process.env.OPENAI_METHOD || optionalEnvVars.OPENAI_METHOD
  },
  bot: {
    maxSummaryLength: 1500,
    systemPromptFile: 'prompt.txt'
  },
  debug: process.env.DEBUG === 'true',
  mongo: {
    uri: process.env.MONGO_URI
  }
};