# Discord Article Bot

A Discord bot that monitors for article links, archives them using Linkwarden (self-hosted), and uses OpenAI-compatible APIs to automatically generate summaries. Features personality-based chat for fun interactions.

## Features

### Core Features

- **Article Summarization**: Summarize articles via command or reaction
- **Linkwarden Integration**: Self-hosted archiving with paywall bypass via browser extension
- **AI-Powered Summaries**: Uses OpenAI-compatible APIs (including Ollama) for concise summaries
- **Duplicate Detection**: Notifies if an article was already shared
- **Source Credibility**: Rates sources with star ratings
- **Token Usage Tracking**: Per-user token consumption tracking

### Personality Chat

- **Character Conversations**: Chat with unique AI personalities
- **5 Built-in Personalities**:
  - 📚 **Professor Grimsworth** - Grumpy historian who relates everything to obscure historical events
  - 🕵️ **Jack Shadows** - Hardboiled 1940s detective with noir prose
  - 🏈 **Chad McCommentary** - Enthusiastic sports commentator
  - 🤔 **Erik the Existentialist** - Philosophy grad student who spirals into existential questions
  - 📯 **Bartholomew the Bold** - Medieval town crier announcing everything as proclamations
- **Extensible**: Add new personalities by dropping a `.js` file in `personalities/`
- **Channel-Scoped Memory**: All users in a channel share a conversation with each personality
- **Reply to Continue**: Reply directly to bot messages to continue conversations naturally
- **Conversation Limits**: 100 messages, 150k tokens, or 30 min idle timeout
- **Resume/Reset**: Continue expired conversations or reset them (admin only)

### Additional Features

- **Article Follow-up Questions**: Reply to summaries to ask follow-up questions about the article
- **RSS Feed Monitoring**: Auto-post articles from configured feeds
- **Follow-up Tracker**: Mark stories for updates
- **OpenTelemetry Tracing**: Distributed tracing for Dynatrace integration

## Prerequisites

- Node.js v16.9.0 or higher
- Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- OpenAI API Key or Ollama instance
- MongoDB database
- Linkwarden instance (optional, for article archiving)

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

   Create a `.env` file:
   ```env
   # Required
   DISCORD_TOKEN=your_discord_bot_token
   OPENAI_API_KEY=your_openai_api_key
   MONGO_URI=mongodb://localhost:27017/discord-bot

   # Optional
   OPENAI_BASE_URL=https://api.openai.com/v1
   OPENAI_MODEL=gpt-4o-mini
   DEBUG=false
   ```

4. **Create system prompt file:**

   Create a `prompt.txt` file with your summarization instructions.

## Project Structure

```
discord-article-bot/
├── bot.js                        # Main bot entry point
├── tracing.js                    # OpenTelemetry configuration
├── logger.js                     # Winston logger
├── prompt.txt                    # AI system prompt
├── config/
│   └── config.js                 # Configuration management
├── commands/
│   ├── CommandHandler.js         # Command registry
│   ├── base/
│   │   └── BaseCommand.js        # Base command class
│   ├── summarization/
│   │   ├── SummarizeCommand.js   # !summarize
│   │   └── ReSummarizeCommand.js # !resummarize
│   ├── chat/
│   │   ├── ChatCommand.js        # !chat
│   │   ├── PersonalitiesCommand.js # !personalities
│   │   ├── ResetChatCommand.js   # !chatreset (admin)
│   │   └── ResumeChatCommand.js  # !chatresume
│   └── utility/
│       └── HelpCommand.js        # !help
├── personalities/                # Personality definitions
│   ├── index.js                  # Personality manager
│   ├── grumpy-historian.js
│   ├── noir-detective.js
│   ├── sports-bro.js
│   ├── existential-philosopher.js
│   └── medieval-herald.js
├── services/
│   ├── SummarizationService.js   # Main summarization logic
│   ├── ChatService.js            # Personality chat handling
│   ├── LinkwardenService.js      # Linkwarden API
│   ├── LinkwardenPollingService.js
│   ├── MongoService.js           # Database operations
│   ├── TokenService.js           # Token counting
│   ├── CostService.js            # Cost tracking
│   └── ...
├── handlers/
│   ├── ReactionHandler.js        # Discord reactions
│   └── ReplyHandler.js           # Reply handling for chats and summaries
└── utils/
    ├── urlUtils.js
    ├── textUtils.js
    └── tokenCounter.js           # Token counting for limits
```

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Discord bot token |
| `OPENAI_API_KEY` | OpenAI API key |
| `MONGO_URI` | MongoDB connection string |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_PREFIX` | `!` | Command prefix |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | API endpoint |
| `OPENAI_MODEL` | `gpt-5.1` | Model for summarization |
| `BOT_ADMIN_USER_IDS` | `` | Comma-separated Discord user IDs for bot admins |
| `DEBUG` | `false` | Enable verbose logging |

### Linkwarden Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `LINKWARDEN_ENABLED` | `false` | Enable Linkwarden |
| `LINKWARDEN_URL` | `http://localhost:3000` | Linkwarden URL |
| `LINKWARDEN_API_TOKEN` | `` | API token |
| `LINKWARDEN_SOURCE_COLLECTION_ID` | `0` | Collection to monitor |
| `LINKWARDEN_DISCORD_CHANNEL_ID` | `` | Channel for posts |
| `LINKWARDEN_POLL_INTERVAL_MS` | `60000` | Poll interval |

## Commands

### Summarization
| Command | Aliases | Description |
|---------|---------|-------------|
| `!summarize <url>` | `!sum` | Summarize an article |
| `!resummarize <url>` | `!resum` | Force re-summarization |

### Personality Chat
| Command | Aliases | Description |
|---------|---------|-------------|
| `!chat <personality> <message>` | `!c`, `!talk` | Chat with a personality |
| `!personalities` | `!chars` | List available personalities |
| `!chatresume <personality> <message>` | `!resumechat` | Resume an expired conversation |
| `!chatreset <personality>` | `!resetchat`, `!cr` | Reset a conversation (admin only) |

### Utility
| Command | Aliases | Description |
|---------|---------|-------------|
| `!help [command]` | `!h` | Show help |

## Adding New Personalities

Create a new file in `personalities/` with this structure:

```javascript
// personalities/my-character.js
module.exports = {
  id: 'my-character',
  name: 'Character Name',
  emoji: '🎭',
  description: 'Short description for the list',
  systemPrompt: `Full personality prompt here...`,
  exampleResponses: [
    "Example response 1",
    "Example response 2"
  ]
};
```

The personality will be automatically loaded on bot startup.

## Deployment

### Docker

```bash
docker build -t discord-article-bot .
docker run -d --env-file .env discord-article-bot
```

### Kubernetes

See [kubernetes.md](kubernetes.md) for Kubernetes deployment with Kustomize overlays.

## Monitoring

The bot includes OpenTelemetry tracing for Dynatrace integration:
- Traces for Linkwarden polling and article processing
- Spans for OpenAI API calls with token counts
- Auto-instrumentation for HTTP and MongoDB

## License

MIT License - see [LICENSE.md](LICENSE.md)
