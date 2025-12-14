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
  - 😊 **Friendly Assistant** - Helpful, informal assistant for casual chat and questions (default)
  - 📚 **Professor Grimsworth** - Grumpy historian who relates everything to obscure historical events
  - 🕵️ **Jack Shadows** - Hardboiled 1940s detective with noir prose
  - 🤔 **Erik the Existentialist** - Philosophy grad student who spirals into existential questions
  - 💾 **x0r_kid** - 90s IRC gamer kid with leet speak and old-school internet vibes
- **Default Personality**: Just use `!chat <message>` - defaults to friendly assistant
- **Image Vision**: Attach images to chat messages for the bot to analyze and discuss
- **Web Search**: Bot can search the web for current information when needed
- **Extensible**: Add new personalities by dropping a `.js` file in `personalities/`
- **Channel-Scoped Memory**: All users in a channel share a conversation with each personality
- **Reply to Continue**: Reply directly to bot messages to continue conversations naturally
- **Conversation Limits**: 100 messages, 150k tokens, or 30 min idle timeout
- **Resume/Reset/List**: Continue expired conversations, reset them, or list your resumable chats

### AI Memory (Mem0)

- **Long-Term Memory**: Bot remembers facts about users across conversations
- **Automatic Extraction**: Mem0 extracts preferences, facts, and context from conversations
- **Semantic Search**: Relevant memories are retrieved based on conversation context
- **Per-User Memories**: Each user has their own memory store
- **Personality-Scoped**: Memories can be filtered by personality for relevant context
- **Graceful Degradation**: Bot works normally if memory service is unavailable
- **Privacy Controls**: Users can request deletion of their memories (GDPR compliance)

### Image Generation (Nano Banana)

- **AI Image Generation**: Generate images from text prompts using Google's Gemini API
- **Reference Image Support**: Use existing images or Discord emojis as reference
- **Aspect Ratio Support**: 10 supported ratios (1:1, 16:9, 9:16, etc.)
- **Per-User Cooldowns**: Configurable cooldown to prevent abuse
- **Usage Tracking**: All generations tracked in MongoDB
- **Safety Filters**: Relies on Gemini's built-in content safety

### Video Generation (Veo)

- **AI Video Generation**: Generate videos using Google's Veo 3.1
- **Text-to-Video Mode**: Generate video from text descriptions alone
- **Single Image Mode**: Animate a single image into a video (image-to-video)
- **Two Image Mode**: Provide first and last frame images for smooth transitions
- **Duration Options**: 4, 6, or 8 second videos
- **Aspect Ratios**: 16:9 (landscape) or 9:16 (portrait)
- **Discord Emoji Support**: Use Discord emojis as source images
- **Progress Updates**: Real-time status updates during generation
- **Usage Tracking**: All generations tracked in MongoDB

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
- Google Gemini API Key (optional, for image generation)
- Google Cloud Project with Vertex AI enabled (optional, for video generation)
- Google Cloud Storage bucket (optional, for video generation)
- Qdrant vector database (optional, for AI memory)

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
│   │   ├── ChatCommand.js        # !chat (with image vision)
│   │   ├── ChatListCommand.js    # !chatlist
│   │   ├── PersonalitiesCommand.js # !personalities
│   │   ├── ResetChatCommand.js   # !chatreset (admin)
│   │   └── ResumeChatCommand.js  # !chatresume
│   ├── image/
│   │   └── ImagineCommand.js     # !imagine
│   ├── video/
│   │   └── VideogenCommand.js    # !videogen
│   └── utility/
│       └── HelpCommand.js        # !help
├── personalities/                # Personality definitions
│   ├── index.js                  # Personality manager
│   ├── friendly-assistant.js     # Default friendly personality
│   ├── grumpy-historian.js
│   ├── noir-detective.js
│   ├── existential-philosopher.js
│   └── irc-gamer.js
├── services/
│   ├── SummarizationService.js   # Main summarization logic
│   ├── ChatService.js            # Personality chat handling
│   ├── Mem0Service.js            # AI memory management (Mem0 SDK)
│   ├── ImagenService.js          # Gemini image generation
│   ├── VeoService.js             # Vertex AI video generation
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
    ├── tokenCounter.js           # Token counting for limits
    └── imageValidation.js        # Image type validation for vision
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

### Mem0 (AI Memory) Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MEM0_ENABLED` | `false` | Enable AI memory |
| `MEM0_QDRANT_HOST` | `localhost` | Qdrant vector database host |
| `MEM0_QDRANT_PORT` | `6333` | Qdrant port |
| `MEM0_COLLECTION_NAME` | `discord_memories` | Vector collection name |
| `MEM0_LLM_MODEL` | `gpt-4o-mini` | Model for memory extraction |
| `MEM0_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |

## Commands

### Summarization
| Command | Aliases | Description |
|---------|---------|-------------|
| `!summarize <url>` | `!sum` | Summarize an article |
| `!resummarize <url>` | `!resum` | Force re-summarization |

### Personality Chat
| Command | Aliases | Description |
|---------|---------|-------------|
| `!chat [personality] <message>` | `!c`, `!talk` | Chat with a personality (defaults to friendly) |
| `!chat <message> [image]` | | Chat about an attached image |
| `!personalities` | `!chars` | List available personalities |
| `!chatlist` | `!chats`, `!listchats` | List your resumable conversations |
| `!chatresume <personality> <message>` | `!resumechat` | Resume an expired conversation |
| `!chatreset <personality>` | `!resetchat`, `!cr` | Reset a conversation (admin only) |

### Image Generation
| Command | Aliases | Description |
|---------|---------|-------------|
| `!imagine <prompt>` | `!img`, `!generate` | Generate an image from a prompt |
| `!imagine <prompt> --ratio 16:9` | | Generate with custom aspect ratio |
| `!imagine <image_url> <prompt>` | | Edit/transform a reference image |

**Examples:**
- `!imagine A sunset over mountains` - Generate from text
- `!imagine A cyberpunk city --ratio 16:9` - With aspect ratio
- `!imagine https://example.com/photo.jpg Make this a watercolor painting` - Edit image
- `!img Turn this into anime style https://example.com/image.png -r 16:9` - Edit with ratio

**Supported Aspect Ratios:** 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9

### Video Generation
| Command | Aliases | Description |
|---------|---------|-------------|
| `!videogen <prompt>` | `!vg`, `!veo`, `!video` | Generate a video from text description (text-to-video) |
| `!videogen <image_url> <prompt>` | | Generate a video from a single image (image-to-video) |
| `!videogen <first_url> <last_url> <prompt>` | | Generate a video from first and last frame images |
| `!videogen ... --duration 6` | | Set video duration (4, 6, or 8 seconds) |
| `!videogen ... --ratio 9:16` | | Set aspect ratio (16:9 or 9:16) |

**Text-Only Mode** (text-to-video):
- `!videogen A sunset over the ocean with waves crashing` - Generate from text description
- `!vg A bird flying through clouds --duration 6` - With custom duration
- `!video A spaceship launching into orbit -r 9:16` - With portrait aspect ratio

**Single Image Mode** (image-to-video):
- `!videogen https://example.com/photo.jpg A camera panning across the scene` - Animate a single image
- `!vg <:emoji:123> The emoji spinning --duration 4` - Animate a Discord emoji

**Two Image Mode** (first & last frame):
- `!videogen https://example.com/morning.jpg https://example.com/night.jpg Day turning to night` - Transition between frames
- `!vg https://example.com/start.png https://example.com/end.png A flower blooming -d 6` - With duration
- `!video <:emoji1:123> <:emoji2:456> The emoji transforming -r 9:16` - Using Discord emojis

**Requirements:**
- A text prompt describing the video (required for all modes)
- Zero, one, or two PNG/JPEG images (optional)
- Google Cloud service account with Vertex AI permissions
- GCS bucket for video output storage

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

### Health Check Endpoints

The bot exposes HTTP health endpoints for Kubernetes liveness and readiness probes:

| Endpoint | Purpose | Success Condition |
|----------|---------|-------------------|
| `/healthz` | Liveness probe | Process is running (always 200) |
| `/readyz` | Readiness probe | Discord client is connected (200 or 503) |

**Configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_SERVER_ENABLED` | `true` | Enable/disable health server |
| `HEALTH_SERVER_PORT` | `8080` | Port for health endpoints |

**Response Format:**
```json
{
  "status": "ok",
  "discordConnected": true,
  "uptime": 3600.5
}
```

The HTTP probes are more efficient than exec probes because they don't spawn a new Node.js process for each check, avoiding the cold-start overhead that can cause timeouts.

## License

MIT License - see [LICENSE.md](LICENSE.md)
