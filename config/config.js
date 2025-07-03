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
  OPENAI_BASE_URL: 'https://api.openai.com/v1',
  OPENAI_METHOD: 'completion',
  OPENAI_MODEL: 'gpt-4.1-mini',
  DEBUG: 'false'
};

// Log warnings for optional vars if needed
Object.entries(optionalEnvVars).forEach(([key, defaultValue]) => {
  if (!process.env[key]) {
    console.warn(`Optional env var ${key} not set, using default: ${defaultValue}`);
  }
});

const mongoUri = process.env.MONGO_URI.replace('${MONGO_PASSWORD}', process.env.MONGO_PASSWORD);

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    intents: ['Guilds', 'GuildMessages', 'GuildMessageReactions', 'MessageContent']
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || optionalEnvVars.OPENAI_BASE_URL,
    method: process.env.OPENAI_METHOD || optionalEnvVars.OPENAI_METHOD,
    model: process.env.OPENAI_MODEL || optionalEnvVars.OPENAI_MODEL
  },
  bot: {
    maxSummaryLength: 1500,
    systemPromptFile: 'prompt.txt'
  },
  debug: process.env.DEBUG === 'true',
  mongo: {
    uri: mongoUri
  }
};