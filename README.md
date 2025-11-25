# Discord Article Bot

A powerful Discord bot that monitors for article links in channels, archives them using Linkwarden (self-hosted), and uses OpenAI-compatible APIs to automatically generate summaries of linked articles with advanced features.

## Features

### Content Enhancement

- 🎯 **Smart Content Analysis**:
  - **Topic Detection**: Automatically tags articles with topics (e.g., politics, tech, sports).
  - **Sentiment Analysis**: Adds emoji reactions based on article mood (😢 for sad news, 🎉 for positive).
  - **Reading Time Estimator**: Provides estimated reading time (e.g., "📖 ~3 min read").
  - **Fact-Check Integration**: Flags articles from questionable sources with ⚠️.

- 🔗 **URL Intelligence**:
  - **Duplicate Detection**: Notifies if an article was already shared, including by whom and when.
  - **Force Re-summarization**: Use `!resummarize` to bypass duplicate check and get a fresh summary.
  - **Related Articles**: Suggests similar articles shared previously.
  - **Source Credibility**: Rates sources with star ratings (⭐⭐⭐⭐⭐).

### Interactive Features

- 📊 **Community Engagement**:
  - **Article Polls**: Auto-generates quick polls (e.g., "Do you agree with this take? 👍/👎").
  - **Discussion Starters**: Generates thought-provoking questions about the article.
  - **Quote of the Day**: Extracts and highlights interesting quotes from shared articles.

### Utility & Convenience

- 🤖 **Smart Notifications**:
  - **Breaking News Alerts**: Monitors RSS feeds and auto-posts urgent news.
  - **Follow-up Tracker**: Allows users to mark stories for follow-up and get updates.
  - **Personalized Feeds**: Users can subscribe to specific topics for tailored alerts.
  - **Reminder Bot**: (Planned) "You saved this article to read later 📚".

- 📈 **Analytics & Insights**:
  - **Server News Trends**: Shows weekly hot topics and article counts.
  - **Reading Habits**: Provides personal stats like "You've read 47 summaries this month!".
  - **Popular Sources**: Displays which news outlets are most preferred by the server.
  - **Controversy Meter**: Detects articles that generate lots of debate.

### Fun & Quirky Features

- 🎭 **Personality Modes**:
  - **Summary Styles**: Summaries in various styles (e.g., Pirate, Shakespeare, Gen Z, Academic).
  - **Mood-Based Summaries**: Summaries with different moods (e.g., cheerful, serious).
  - **Celebrity Narrator**: Summaries narrated in the style of a chosen celebrity.
  - **Historical Perspective**: Summaries from a specific historical viewpoint (e.g., 1950s, Victorian).

### Advanced Features

- 🧠 **AI-Powered Extras**:
  - **Bias Detection**: Highlights potentially biased language or framing.
  - **Alternative Perspectives**: Provides summaries from different political or ideological viewpoints.
  - **Prediction Tracker**: (Planned) Tracks how AI predictions about future events pan out.
  - **Context Provider**: Provides historical or background context for topics.

### Multi-Language Support

- 🌐 **Multi-Language Support**:
  - **Auto-Translation**: Summarizes foreign articles in English.
  - **Language Learning**: Provides summaries in multiple languages for practice.
  - **Cultural Context**: Explains cultural references for international news.

### Core Features

- 📰 **Reaction-based Summarization**: React with 📰 emoji to any message containing URLs to trigger automatic summarization.
- 🗃️ **Linkwarden Integration**: Self-hosted archiving solution that supports authenticated/paywalled content via browser extension.
- 🤖 **AI-Powered Summaries**: Uses OpenAI-compatible APIs (including Ollama) to generate concise 1500-character summaries.
- 🔍 **Smart URL Detection**: Filters out images and GIF links automatically.
- 📝 **Configurable System Prompts**: Customize the AI's summarization behavior via `prompt.txt`.
- 💰 **Cost Tracking**: Real-time token usage and cost breakdown for each summary (OpenAI models).
- 📊 **Token Counting**: Accurate token estimation using tiktoken library.
- 🔗 **Link Sanitization**: Removes URLs from summaries to prevent Discord auto-expansion.
- 🛡️ **Robust Error Handling**: Graceful handling of invalid URLs, failed requests, and API errors.
- 🎮 **Command System**: Modular command architecture with aliases and built-in help system.
- 💾 **MongoDB Persistence**: Stores article summaries, user preferences, and analytics data.

## Prerequisites

- Node.js v16.9.0 or higher
- npm or yarn
- Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- OpenAI API Key or Ollama instance
- MongoDB database (local or cloud)
- Linkwarden instance (self-hosted) with browser extension for article archiving

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd discord-article-bot
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   
   Create a `.env` file in the root directory:
   ```env
   # Required
   DISCORD_TOKEN=your_discord_bot_token
   OPENAI_API_KEY=your_openai_api_key
   MONGO_URI=mongodb://localhost:27017/discord-bot
   
   # Optional - See Configuration section for all options
   OPENAI_BASE_URL=https://api.openai.com/v1
   OPENAI_METHOD=completion
   OPENAI_MODEL=gpt-4.1-mini
   DEBUG=false
   ```

4. **Create system prompt file:**
   
   Create a `prompt.txt` file in the root directory with your desired summarization instructions. A comprehensive prompt is included in the repository.

## Project Structure

```
discord-article-bot/
├── bot.js                        # Main bot entry point
├── logger.js                     # Winston logger configuration
├── prompt.txt                    # AI system prompt
├── .env                          # Environment variables
├── package.json                  # Project dependencies
├── config/
│   └── config.js                 # Configuration management
├── commands/                     # Command system
│   ├── CommandHandler.js         # Command registry and executor
│   ├── base/
│   │   └── BaseCommand.js        # Base command class
│   ├── subscription/             # Subscription commands
│   ├── analytics/                # Analytics commands
│   ├── summarization/            # Summarization commands
│   └── utility/                  # Utility commands
├── services/
│   ├── LinkwardenService.js      # Linkwarden API integration
│   ├── LinkwardenPollingService.js # Monitors Linkwarden for new links
│   ├── SummarizationService.js   # Main summarization orchestration
│   ├── TokenService.js           # Token counting and estimation
│   ├── CostService.js            # Cost calculation and tracking
│   ├── ResponseParser.js         # API response parsing and formatting
│   ├── AnalyticsService.js       # Analytics and insights generation
│   ├── FollowUpService.js        # Follow-up tracking and notifications
│   ├── PollService.js            # Poll and discussion question generation
│   ├── RssService.js             # RSS feed monitoring
│   ├── SourceCredibilityService.js # Source credibility rating
│   ├── SubscriptionService.js    # User topic subscriptions
│   └── MongoService.js           # MongoDB database operations
├── handlers/
│   └── ReactionHandler.js        # Discord reaction handling
└── utils/
    ├── urlUtils.js               # URL parsing and validation
    ├── textUtils.js              # Text utility functions
    └── linkwardenRedirect.js     # Linkwarden redirect utilities
```

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Your Discord bot token from the Developer Portal |
| `OPENAI_API_KEY` | OpenAI API key or key for compatible service |
| `MONGO_URI` | MongoDB connection string |

### Optional Environment Variables

#### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_PREFIX` | `!` | Command prefix for bot commands |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API endpoint URL (change for Ollama/custom) |
| `OPENAI_METHOD` | `completion` | API method: 'completion' or 'response' |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Model to use for summarization |
| `DEBUG` | `false` | Enable verbose Discord.js debugging |

#### Feature Toggles

| Variable | Default | Description |
|----------|---------|-------------|
| `FACT_CHECKER_ENABLED` | `true` | Enable fact-checking for questionable sources |
| `SOURCE_CREDIBILITY_ENABLED` | `true` | Enable source credibility ratings |
| `RSS_FEEDS_ENABLED` | `false` | Enable RSS feed monitoring |
| `FOLLOW_UP_TRACKER_ENABLED` | `false` | Enable follow-up tracking |
| `SUMMARY_STYLES_ENABLED` | `true` | Enable style-based summaries |
| `MOOD_BASED_SUMMARIES_ENABLED` | `true` | Enable mood-based summaries |
| `CELEBRITY_NARRATORS_ENABLED` | `true` | Enable celebrity narrator summaries |
| `HISTORICAL_PERSPECTIVES_ENABLED` | `true` | Enable historical perspective summaries |
| `BIAS_DETECTION_ENABLED` | `false` | Enable bias detection in articles |
| `ALTERNATIVE_PERSPECTIVES_ENABLED` | `false` | Enable alternative perspective summaries |
| `CONTEXT_PROVIDER_ENABLED` | `false` | Enable historical/background context |
| `AUTO_TRANSLATION_ENABLED` | `true` | Enable auto-translation of foreign articles |
| `LANGUAGE_LEARNING_ENABLED` | `true` | Enable multi-language summaries |
| `CULTURAL_CONTEXT_ENABLED` | `true` | Enable cultural context summaries |

#### Feature Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `QUESTIONABLE_SOURCES` | `[]` | Comma-separated list of questionable domains |
| `TRUSTED_SOURCES` | `{}` | JSON object of trusted sources with ratings |
| `RSS_INTERVAL_MINUTES` | `60` | RSS feed check interval |
| `RSS_FEEDS` | `[]` | JSON array of RSS feed configurations |
| `FOLLOW_UP_INTERVAL_MINUTES` | `1440` | Follow-up check interval (24 hours) |
| `BIAS_THRESHOLD` | `0.7` | Bias detection sensitivity threshold |
| `BIAS_TYPES` | `political,gender,racial,corporate` | Types of bias to detect |
| `CONTEXT_MIN_KEYWORDS` | `3` | Minimum keywords for context generation |
| `AUTO_TRANSLATION_TARGET_LANGUAGE` | `English` | Target language for translations |
| `AUTO_TRANSLATION_SUPPORTED_LANGUAGES` | `English,Spanish,French,German,Italian,Portuguese` | Supported languages |
| `LANGUAGE_LEARNING_TARGET_LANGUAGES` | `Spanish,French` | Default languages for learning mode |
| `LANGUAGE_LEARNING_PRESENTATION_STYLE` | `side-by-side` | How to present multiple languages |

#### Linkwarden Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `LINKWARDEN_ENABLED` | `false` | Enable Linkwarden integration |
| `LINKWARDEN_URL` | `http://localhost:3000` | Base URL of your Linkwarden instance |
| `LINKWARDEN_API_TOKEN` | `` | API token from Linkwarden (Settings → Access Tokens) |
| `LINKWARDEN_SOURCE_COLLECTION_ID` | `0` | ID of collection to monitor for new links |
| `LINKWARDEN_POSTED_TAG_NAME` | `posted` | Tag name to mark processed links |
| `LINKWARDEN_DISCORD_CHANNEL_ID` | `` | Discord channel ID for posting archived articles |
| `LINKWARDEN_POLL_INTERVAL_MS` | `60000` | How often to poll Linkwarden (milliseconds) |

### Linkwarden Setup

Linkwarden provides self-hosted article archiving with support for authenticated/paywalled content.

1. **Deploy Linkwarden**: Set up your own [Linkwarden](https://linkwarden.app/) instance
2. **Create a collection**: Create a collection named "Discord Share" for articles to be posted
3. **Get the collection ID**: Found in the URL when viewing the collection
4. **Create an API token**: Settings → Access Tokens → Create with "Never" expiry
5. **Install browser extension**: Install the Linkwarden extension for your browser
6. **Configure the bot**: Add the environment variables above

**Workflow:**
1. User browses to an article (can be behind paywall if logged in)
2. User clicks Linkwarden extension → saves to "Discord Share" collection
3. Linkwarden archives the article (screenshot, PDF, readable text)
4. Bot polls Linkwarden and detects new link
5. Bot generates summary and posts to Discord with link to archived version
6. Bot marks link as "posted" to avoid duplicates

### RSS Feed Configuration

RSS feeds are configured via the `RSS_FEEDS` environment variable as a JSON array:

```json
[
  {
    "url": "https://example.com/rss",
    "channelId": "123456789012345678"
  }
]
```

### Trusted Sources Configuration

Trusted sources are configured via the `TRUSTED_SOURCES` environment variable as a JSON object:

```json
{
  "reuters.com": 5,
  "apnews.com": 5,
  "bbc.com": 4,
  "nytimes.com": 4
}
```

## Usage

1. **Start the bot:**
   ```bash
   npm start
   ```

   For development with auto-restart:
   ```bash
   npm run dev    # Requires nodemon
   ```

2. **Get help:**
   - Type `!help` to see all available commands
   - Type `!help <command>` for detailed help on a specific command

3. **Basic summarization:**
   - React to any message containing URLs with 📰 emoji
   - Or use `!summarize <url>` command

4. **Advanced features:**
   - Subscribe to topics: `!subscribe technology`
   - Check trends: `!news_trends`
   - Generate polls: `!poll <url>`
   - Multi-language: `!learn_language <url> Spanish French`

## Commands

### Core Commands
- `!help [command]` - Display help information
- `!summarize <url> [style]` - Summarize an article (alias: `!sum`)
- `!resummarize <url> [style]` - Force re-summarization of an article, bypassing duplicate check (alias: `!resum`)

### Subscription Commands
- `!subscribe <topic>` - Subscribe to a news topic
- `!unsubscribe <topic>` - Unsubscribe from a topic
- `!my_subscriptions` - List your subscriptions (aliases: `!mysubs`, `!subscriptions`)

### Analytics Commands
- `!news_trends` - View server news trends (alias: `!trends`)
- `!my_reading_habits` - View your reading stats (aliases: `!myhabits`, `!reading_habits`)
- `!popular_sources` - View popular news sources (alias: `!sources`)
- `!controversy_meter` - View controversial articles (alias: `!controversy`)

### Enhanced Summarization
- `!mood_summarize <url> [mood]` - Mood-based summary (alias: `!moodsum`)
- `!narrate_summarize <url> [narrator]` - Celebrity narrator (aliases: `!narratesum`, `!narrator`)
- `!historical_summarize <url> [perspective]` - Historical perspective (alias: `!histsum`)
- `!perspective_summarize <url> <perspective>` - Alternative perspective (aliases: `!perspsum`, `!perspective`)
- `!learn_language <url> <languages...>` - Multi-language (aliases: `!langsum`, `!multilang`)
- `!cultural_summarize <url> <context>` - Cultural context (aliases: `!cultsum`, `!cultural`)
- `!summarize_with_context <url> [style]` - Summary with historical/background context (aliases: `!sumctx`, `!contextsum`)

### Utility Commands
- `!poll <url>` - Generate a poll from an article
- `!discussion_questions <url>` - Generate discussion questions (aliases: `!discuss`, `!questions`)

## Deployment

### Docker Deployment

Create a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  bot:
    build: .
    environment:
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - MONGO_URI=mongodb://mongo:27017/discord-bot
    depends_on:
      - mongo
    restart: unless-stopped

  mongo:
    image: mongo:latest
    volumes:
      - mongo-data:/data/db
    restart: unless-stopped

volumes:
  mongo-data:
```

### Kubernetes Deployment

See [kubernetes.md](kubernetes.md) for detailed Kubernetes deployment instructions.

## Monitoring

The bot includes comprehensive logging:
- **Timestamp**: ISO format with milliseconds
- **Color coding**: Different colors for each log level
- **Cost tracking**: Individual and cumulative costs
- **Command logging**: All command executions
- **Error tracking**: Detailed error information

Enable debug mode for verbose logging:
```bash
DEBUG=true npm start
```

## Troubleshooting

### Common Issues

1. **Bot not responding to reactions**
   - Ensure bot has permissions: `Read Messages`, `Read Message History`, `Add Reactions`, `Send Messages`
   - Check that `MessageContent` intent is enabled in Discord Developer Portal

2. **429 Rate Limit Errors**
   - The bot includes concurrency limiting to prevent this
   - If persistent, reduce RSS feed frequency or implement additional rate limiting

3. **MongoDB Connection Issues**
   - Verify MongoDB is running and accessible
   - Check connection string format
   - Ensure network connectivity

4. **High token usage**
   - Adjust summary length in prompt.txt
   - Enable caching for frequently accessed content
   - Monitor usage with built-in cost tracking

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE.md) file for details.