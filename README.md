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
- **6 Built-in Personalities**:
  - 😊 **Friendly Assistant** - Helpful, informal assistant for casual chat and questions (default)
  - 📚 **Professor Grimsworth** - Grumpy historian who relates everything to obscure historical events
  - 🕵️ **Jack Shadows** - Hardboiled 1940s detective with noir prose
  - 🤔 **Erik the Existentialist** - Philosophy grad student who spirals into existential questions
  - 💾 **x0r_kid** - 90s IRC gamer kid with leet speak and old-school internet vibes
  - 🔓 **Uncensored** - Enhanced personality that defaults to local LLM for less restricted responses
- **Default Personality**: Just use `/chat <message>` - defaults to friendly assistant
- **Image Vision**: Attach images to chat messages for the bot to analyze and discuss
- **Web Search**: Bot can search the web for current information when needed
- **Extensible**: Add new personalities by dropping a `.js` file in `personalities/`
- **Channel-Scoped Memory**: All users in a channel share a conversation with each personality
- **Reply to Continue**: Reply directly to bot messages to continue conversations naturally
- **Conversation Limits**: 100 messages, 150k tokens, or 30 min idle timeout
- **Resume/Reset/List**: Continue expired conversations, reset them, or list your resumable chats
- **Uncensored Mode**: Opt-in per-request routing to local LLM for less restricted responses

### AI Memory (Mem0)

- **Long-Term Memory**: Bot remembers facts about users across conversations
- **Automatic Extraction**: Mem0 extracts preferences, facts, and context from conversations
- **Semantic Search**: Relevant memories are retrieved based on conversation context
- **Per-User Memories**: Each user has their own memory store
- **Shared Channel Memories**: Channel-wide facts visible to ALL users in that channel
- **3-Way Memory Search**: Parallel retrieval of personality, explicit, and shared channel memories
- **Personality-Scoped**: Memories can be filtered by personality for relevant context
- **Graceful Degradation**: Bot works normally if memory service is unavailable
- **Privacy Controls**: Users can request deletion of their memories (GDPR compliance)

### Multiplayer Chat

- **Participant Awareness**: Bot tracks who's active in each channel (30-minute window)
- **Multi-User Context**: System prompt includes list of active participants
- **@Mention Entry**: Mention the bot to start a conversation with the default personality
- **Seamless Replies**: Reply to any bot message to continue conversations naturally
- **Shared Context**: All users in a channel see the same conversation history per personality

### Image Generation (Nano Banana)

- **AI Image Generation**: Generate images from text prompts using Google's Gemini API
- **Reference Image Support**: Use existing images or Discord emojis as reference
- **Aspect Ratio Support**: 10 supported ratios (1:1, 16:9, 9:16, etc.)
- **Per-User Cooldowns**: Configurable cooldown to prevent abuse
- **Usage Tracking**: All generations tracked in MongoDB
- **Safety Filters**: Relies on Gemini's built-in content safety
- **Intelligent Retry**: AI analyzes failed prompts and suggests alternatives
- **Interactive Approval**: React with 1️⃣ 2️⃣ 3️⃣ to retry with suggested prompts
- **Reply to Regenerate**: Reply to a generated image with feedback to create an enhanced version

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

### IRC History Search

- **Semantic Search**: Search through archived IRC conversations using natural language
- **Discord-to-IRC Mapping**: Links Discord users to their historical IRC nicknames
- **Personal History**: Filter searches to your own conversations with `--me` flag
- **Time-Based Filtering**: Filter by year or decade
- **Throwback Feature**: Random conversations from "this day in history"
- **Graceful Degradation**: Commands hidden when Qdrant service unavailable

### Additional Features

- **Article Follow-up Questions**: Reply to summaries to ask follow-up questions about the article
- **RSS Feed Monitoring**: Auto-post articles from configured feeds
- **Follow-up Tracker**: Mark stories for updates
- **OpenTelemetry Tracing**: Distributed tracing for Dynatrace integration
- **OpenLLMetry (GenAI Instrumentation)**: Captures full LLM prompts, completions, and token usage in trace spans

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
│   ├── base/
│   │   └── BaseSlashCommand.js   # Base slash command class
│   └── slash/                    # All slash command implementations
│       ├── index.js              # Command exports
│       ├── ChatCommand.js        # /chat
│       ├── ChatThreadCommand.js  # /chatthread
│       ├── PersonalitiesCommand.js # /personalities
│       ├── ChatResetCommand.js   # /chatreset (admin)
│       ├── ChatResumeCommand.js  # /chatresume
│       ├── ChatListCommand.js    # /chatlist
│       ├── SummarizeCommand.js   # /summarize
│       ├── ResummarizeCommand.js # /resummarize
│       ├── ImagineCommand.js     # /imagine
│       ├── VideogenCommand.js    # /videogen
│       ├── MemoriesCommand.js    # /memories
│       ├── RememberCommand.js    # /remember
│       ├── ForgetCommand.js      # /forget
│       ├── RecallCommand.js      # /recall
│       ├── HistoryCommand.js     # /history
│       ├── ThrowbackCommand.js   # /throwback
│       ├── HelpCommand.js        # /help
│       ├── ContextCommand.js     # /context
│       └── ChannelTrackCommand.js # /channeltrack
├── handlers/
│   ├── SlashCommandHandler.js    # Slash command registry & executor
│   ├── ReactionHandler.js        # Discord reactions
│   └── ReplyHandler.js           # Reply handling for chats and summaries
├── personalities/                # Personality definitions
│   ├── index.js                  # Personality manager
│   ├── friendly-assistant.js     # Default friendly personality
│   ├── grumpy-historian.js
│   ├── noir-detective.js
│   ├── existential-philosopher.js
│   ├── irc-gamer.js
│   └── uncensored.js             # Local LLM uncensored personality
├── services/
│   ├── SummarizationService.js   # Main summarization logic
│   ├── ChatService.js            # Personality chat handling
│   ├── LocalLlmService.js        # Local LLM (Ollama) for uncensored mode
│   ├── Mem0Service.js            # AI memory management (Mem0 SDK)
│   ├── QdrantService.js          # IRC history vector search
│   ├── NickMappingService.js     # Discord-to-IRC nick mapping
│   ├── ChannelContextService.js  # Passive channel conversation tracking
│   ├── ImagenService.js          # Gemini image generation
│   ├── ImagePromptAnalyzerService.js # Failed image prompt analysis
│   ├── VeoService.js             # Vertex AI video generation
│   ├── LinkwardenService.js      # Linkwarden API
│   ├── LinkwardenPollingService.js
│   ├── MessageService.js         # OpenAI message handling wrapper
│   ├── MongoService.js           # Database operations
│   ├── TokenService.js           # Token counting
│   ├── CostService.js            # Cost tracking
│   └── SourceCredibilityService.js # Source rating
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
| `DISCORD_CLIENT_ID` | `` | Discord application client ID (for slash commands) |
| `DISCORD_TEST_GUILD_ID` | `` | Guild ID for instant command updates during development |
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

### Qdrant IRC History Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `QDRANT_IRC_ENABLED` | `false` | Enable IRC history search |
| `QDRANT_HOST` | `localhost` | Qdrant vector database host |
| `QDRANT_PORT` | `6333` | Qdrant port |
| `QDRANT_IRC_COLLECTION` | `irc_history` | Collection name for IRC history |

**Note:** IRC history requires a pre-populated Qdrant collection with vectorized IRC logs. See `scripts/irc-parser/` for ingestion tools.

### Local LLM Configuration (Uncensored Mode)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOCAL_LLM_ENABLED` | `false` | Enable local LLM integration |
| `LOCAL_LLM_BASE_URL` | `http://localhost:11434/v1` | Ollama OpenAI-compatible endpoint |
| `LOCAL_LLM_MODEL` | `dolphin-llama3:8b-v2.9-fp16` | Model to use for uncensored chat |
| `LOCAL_LLM_API_KEY` | `ollama` | API key (Ollama default is 'ollama') |
| `LOCAL_LLM_TEMPERATURE` | `0.8` | Generation temperature |
| `LOCAL_LLM_TOP_P` | `0.95` | Top-p sampling parameter |
| `LOCAL_LLM_MAX_TOKENS` | `2048` | Maximum tokens per response |
| `LOCAL_LLM_MAX_RESPONSE_LENGTH` | `500` | Max response length in characters (0 = no limit) |
| `UNCENSORED_MODE_ENABLED` | `false` | Enable uncensored mode feature |
| `UNCENSORED_ALLOWED_CHANNELS` | `` | Comma-separated channel IDs (empty = all) |
| `UNCENSORED_BLOCKED_CHANNELS` | `` | Comma-separated blocked channel IDs |
| `UNCENSORED_ALLOWED_USERS` | `` | Comma-separated user IDs (empty = all) |
| `UNCENSORED_REQUIRE_NSFW` | `false` | Only allow in NSFW channels |

**Note:** Uncensored mode requires a running Ollama instance with an uncensored model like `dolphin-llama3`. The feature routes chat requests to the local LLM when users specify `uncensored:true` in the `/chat` command.

### Imagen (Image Generation) Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAGEN_ENABLED` | `false` | Enable image generation |
| `GEMINI_API_KEY` | `` | Gemini API key for image generation |
| `IMAGEN_MODEL` | `gemini-2.5-flash-image` | Model for image generation |
| `IMAGEN_DEFAULT_ASPECT_RATIO` | `1:1` | Default aspect ratio |
| `IMAGEN_MAX_PROMPT_LENGTH` | `1000` | Maximum prompt length in characters |
| `IMAGEN_COOLDOWN_SECONDS` | `30` | Cooldown between generations per user |

### Veo (Video Generation) Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VEO_ENABLED` | `false` | Enable video generation |
| `GOOGLE_CLOUD_PROJECT` | `` | Google Cloud project ID for Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` | Google Cloud location |
| `VEO_MODEL` | `veo-3.1-fast-generate-001` | Model for video generation |
| `VEO_GCS_BUCKET` | `` | GCS bucket for storing generated videos |
| `VEO_DEFAULT_DURATION` | `8` | Default video duration in seconds (4, 6, or 8) |
| `VEO_DEFAULT_ASPECT_RATIO` | `16:9` | Default aspect ratio (16:9 or 9:16) |
| `VEO_COOLDOWN_SECONDS` | `60` | Cooldown between generations per user |

### Channel Context Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CHANNEL_CONTEXT_ENABLED` | `false` | Enable channel context tracking |
| `CHANNEL_CONTEXT_CHANNELS` | `` | Pre-configured channel IDs (comma-separated) |
| `CHANNEL_CONTEXT_RECENT_COUNT` | `20` | Recent messages to keep in memory per channel |
| `CHANNEL_CONTEXT_BATCH_INTERVAL` | `60` | Batch indexing interval in minutes |
| `CHANNEL_CONTEXT_RETENTION_DAYS` | `30` | Retention period for indexed messages |
| `CHANNEL_CONTEXT_SEARCH_THRESHOLD` | `0.4` | Score threshold for semantic search |
| `CHANNEL_CONTEXT_EXTRACT_MEMORIES` | `false` | Enable Mem0 memory extraction from channel messages |

## Commands

All commands use Discord's native slash command system. Type `/` to see available commands with autocomplete.

### Summarization
| Command | Description |
|---------|-------------|
| `/summarize url:<url>` | Summarize an article |
| `/resummarize url:<url>` | Force re-summarization (bypass cache) |

### Personality Chat
| Command | Description |
|---------|-------------|
| `/chat message:<text>` | Chat with a personality (defaults to friendly) |
| `/chat message:<text> personality:<name>` | Chat with a specific personality |
| `/chat message:<text> image:<file>` | Chat about an attached image |
| `/chatthread message:<text>` | Start a dedicated chat thread |
| `/personalities` | List available personalities |
| `/chatlist` | List your resumable conversations |
| `/chatresume personality:<name> message:<text>` | Resume an expired conversation |
| `/chatreset personality:<name>` | Reset a conversation (admin only) |

### Image Generation
| Command | Description |
|---------|-------------|
| `/imagine prompt:<text>` | Generate an image from a prompt |
| `/imagine prompt:<text> ratio:<ratio>` | Generate with custom aspect ratio |
| `/imagine prompt:<text> reference:<image>` | Edit/transform a reference image |

**Supported Aspect Ratios:** 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9

### Video Generation
| Command | Description |
|---------|-------------|
| `/videogen prompt:<text>` | Generate a video from text (text-to-video) |
| `/videogen prompt:<text> first_frame:<image>` | Animate a single image |
| `/videogen prompt:<text> first_frame:<image> last_frame:<image>` | First and last frame transition |
| `/videogen prompt:<text> duration:<4\|6\|8>` | Set video duration |
| `/videogen prompt:<text> aspect_ratio:<16:9\|9:16>` | Set aspect ratio |

**Requirements:**
- Google Cloud service account with Vertex AI permissions
- GCS bucket for video output storage

### Memory Management
| Command | Description |
|---------|-------------|
| `/memories` | View your stored memories |
| `/remember fact:<text>` | Manually store a memory about yourself |
| `/forget` | Delete all your memories |
| `/forget search:<text>` | Delete memories matching search |

### IRC History Search
| Command | Description |
|---------|-------------|
| `/recall query:<text>` | Semantic search through IRC history |
| `/recall query:<text> my_messages:true` | Filter to your own IRC conversations |
| `/recall query:<text> year:<year>` | Filter by specific year |
| `/history` | View your own IRC history |
| `/history user:<@user>` | View a user's IRC history |
| `/throwback` | Random conversation from this day in history |

**Note:** IRC commands require Discord-to-IRC nick mapping. Commands are hidden when Qdrant service is unavailable.

### Utility
| Command | Description |
|---------|-------------|
| `/help` | Show all commands and usage |
| `/context` | View channel conversation context |
| `/channeltrack` | Manage channel tracking (admin only) |

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
- **OpenLLMetry GenAI instrumentation**: Captures full request/response content for LLM calls
  - `gen_ai.prompt.N.content` - Full prompt messages sent to the LLM
  - `gen_ai.completion.N.content` - Full completion responses
  - `gen_ai.usage.prompt_tokens` / `gen_ai.usage.completion_tokens` - Token usage
  - `gen_ai.request.model` / `gen_ai.response.model` - Model information
  - Set `TRACELOOP_TRACE_CONTENT=false` to disable content capture for privacy

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
