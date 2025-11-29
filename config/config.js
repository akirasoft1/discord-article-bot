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
    intents: ['Guilds', 'GuildMessages', 'GuildMessageReactions', 'MessageContent'],
    prefix: process.env.DISCORD_PREFIX || '!'
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || optionalEnvVars.OPENAI_BASE_URL,
    method: process.env.OPENAI_METHOD || optionalEnvVars.OPENAI_METHOD,
    model: process.env.OPENAI_MODEL || optionalEnvVars.OPENAI_MODEL
  },
  bot: {
    maxSummaryLength: 1500,
    systemPromptFile: 'prompt.txt',
    factChecker: {
      enabled: process.env.FACT_CHECKER_ENABLED === 'true' || true,
      questionableSources: process.env.QUESTIONABLE_SOURCES ? process.env.QUESTIONABLE_SOURCES.split(',') : []
    },
    sourceCredibility: {
      enabled: process.env.SOURCE_CREDIBILITY_ENABLED === 'true' || true,
      trustedSources: process.env.TRUSTED_SOURCES ? JSON.parse(process.env.TRUSTED_SOURCES) : {}
    },
    rssFeeds: {
      enabled: process.env.RSS_FEEDS_ENABLED === 'true' || false,
      intervalMinutes: parseInt(process.env.RSS_INTERVAL_MINUTES || '60', 10),
      feeds: process.env.RSS_FEEDS ? JSON.parse(process.env.RSS_FEEDS) : []
    },
    followUpTracker: {
      enabled: process.env.FOLLOW_UP_TRACKER_ENABLED === 'true' || false,
      intervalMinutes: parseInt(process.env.FOLLOW_UP_INTERVAL_MINUTES || '1440', 10) // Default to 24 hours
    },
    summaryStyles: {
      enabled: process.env.SUMMARY_STYLES_ENABLED === 'true' || true,
      styles: {
        pirate: "Summarize this article in the style of a pirate.",
        shakespeare: "Summarize this article in the style of William Shakespeare.",
        genz: "Summarize this article using Gen Z slang and internet culture references.",
        academic: "Summarize this article in a formal, academic tone, suitable for a research paper."
      }
    },
    moodBasedSummaries: {
      enabled: process.env.MOOD_BASED_SUMMARIES_ENABLED === 'true' || true,
      moods: {
        monday: "Summarize this article in a serious and formal tone.",
        friday: "Summarize this article in a cheerful and lighthearted tone.",
        neutral: "Summarize this article in a neutral and objective tone."
      },
      defaultMood: "neutral"
    },
    celebrityNarrators: {
      enabled: process.env.CELEBRITY_NARRATORS_ENABLED === 'true' || true,
      narrators: {
        gordon_ramsay: "Summarize this article as if Gordon Ramsay is narrating, with his characteristic intensity and expletives (bleeped, of course).",
        shakespeare: "Summarize this article as if William Shakespeare is narrating, using Elizabethan language and dramatic flair.",
        morgan_freeman: "Summarize this article as if Morgan Freeman is narrating, with his calm, authoritative, and deep voice."
      }
    },
    historicalPerspectives: {
      enabled: process.env.HISTORICAL_PERSPECTIVES_ENABLED === 'true' || true,
      perspectives: {
        '1950s': "Summarize this article as if it were being reported in the 1950s, using language and cultural references from that era.",
        'victorian': "Summarize this article as if it were being reported in the Victorian era, with formal language and a focus on societal norms.",
        'ancient_rome': "Summarize this article as if it were being discussed in Ancient Rome, focusing on aspects relevant to Roman citizens and using appropriate terminology."
      }
    },
    biasDetection: {
      enabled: process.env.BIAS_DETECTION_ENABLED === 'true' || false,
      threshold: parseFloat(process.env.BIAS_THRESHOLD || '0.7'), // Example threshold
      types: process.env.BIAS_TYPES ? process.env.BIAS_TYPES.split(',') : ['political', 'gender', 'racial', 'corporate']
    },
    alternativePerspectives: {
      enabled: process.env.ALTERNATIVE_PERSPECTIVES_ENABLED === 'true' || false,
      perspectives: {
        liberal: "Summarize this article from a liberal viewpoint.",
        conservative: "Summarize this article from a conservative viewpoint.",
        environmentalist: "Summarize this article from an environmentalist viewpoint.",
        economic: "Summarize this article from an economic viewpoint."
      }
    },
    contextProvider: {
      enabled: process.env.CONTEXT_PROVIDER_ENABLED === 'true' || false,
      minKeywords: parseInt(process.env.CONTEXT_MIN_KEYWORDS || '3', 10),
      prompt: "Provide a brief historical or background context for the following topic/keywords: "
    },
    autoTranslation: {
      enabled: process.env.AUTO_TRANSLATION_ENABLED === 'true' || true,
      targetLanguage: process.env.AUTO_TRANSLATION_TARGET_LANGUAGE || 'English',
      supportedLanguages: process.env.AUTO_TRANSLATION_SUPPORTED_LANGUAGES ? process.env.AUTO_TRANSLATION_SUPPORTED_LANGUAGES.split(',') : ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese']
    },
    languageLearning: {
      enabled: process.env.LANGUAGE_LEARNING_ENABLED === 'true' || true,
      targetLanguages: process.env.LANGUAGE_LEARNING_TARGET_LANGUAGES ? process.env.LANGUAGE_LEARNING_TARGET_LANGUAGES.split(',') : ['Spanish', 'French'],
      presentationStyle: process.env.LANGUAGE_LEARNING_PRESENTATION_STYLE || 'side-by-side' // 'side-by-side', 'alternating'
    },
    culturalContext: {
      enabled: process.env.CULTURAL_CONTEXT_ENABLED === 'true' || true,
      contexts: {
        japanese: "Summarize this article with a focus on Japanese cultural nuances and perspectives.",
        indian: "Summarize this article with a focus on Indian cultural nuances and perspectives.",
        western: "Summarize this article with a focus on Western cultural nuances and perspectives."
      }
    }
  },
  debug: process.env.DEBUG === 'true',
  mongo: {
    uri: mongoUri
  },
  // Linkwarden integration for self-hosted article archiving
  // Replaces the non-functional archive.today integration
  linkwarden: {
    // Enable/disable Linkwarden integration
    enabled: process.env.LINKWARDEN_ENABLED === 'true',
    // Base URL of your Linkwarden instance (e.g., https://links.example.com)
    baseUrl: process.env.LINKWARDEN_URL || 'http://localhost:3000',
    // External URL for user-facing links (e.g., https://linkwarden.aklabs.io)
    externalUrl: process.env.LINKWARDEN_EXTERNAL_URL || process.env.LINKWARDEN_URL || 'http://localhost:3000',
    // API token from Linkwarden (Settings -> Access Tokens)
    apiToken: process.env.LINKWARDEN_API_TOKEN || '',
    // Collection ID to monitor for new links (the "Discord Share" collection)
    sourceCollectionId: parseInt(process.env.LINKWARDEN_SOURCE_COLLECTION_ID || '0', 10),
    // Tag name to mark links as posted (will be created if it doesn't exist)
    postedTagName: process.env.LINKWARDEN_POSTED_TAG_NAME || 'posted',
    // Discord channel ID where archived articles will be posted
    discordChannelId: process.env.LINKWARDEN_DISCORD_CHANNEL_ID || '',
    // How often to poll Linkwarden for new links (in milliseconds)
    pollIntervalMs: parseInt(process.env.LINKWARDEN_POLL_INTERVAL_MS || '60000', 10)
  }
};