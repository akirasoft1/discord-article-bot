# Bot Logic Flow

This document outlines the overall logic and operational flow of the Discord Article Bot, detailing how it processes URLs, generates summaries, handles personality chat, and integrates various features.

## 1. Bot Initialization (`bot.js`)

Upon startup, the `bot.js` file serves as the main entry point. It performs the following initialization steps:

- **OpenTelemetry Initialization**: Loads `tracing.js` **before any other modules** to ensure all HTTP calls, MongoDB operations, and other I/O are properly instrumented with distributed tracing.
- **Discord Client Setup**: Initializes the Discord.js client with necessary intents (Guilds, GuildMessages, GuildMessageReactions, MessageContent) and partials (Message, Reaction, User) to listen for relevant events.
- **OpenAI Client Setup**: Configures the OpenAI client using the API key and base URL from `config.js`.
- **Service Instantiation**: Creates instances of various services, passing necessary dependencies:
    - `MessageService`: Wraps OpenAI client for consistent message handling.
    - `SummarizationService`: Core article processing and summary generation. Receives the OpenAI client, config, Discord client, and MessageService.
    - `ReactionHandler`: Manages Discord message reactions (📰 for summarization, 📚 for follow-up). Receives SummarizationService and MongoService.
    - `RssService`: Handles fetching and processing RSS feeds. Receives MongoService, SummarizationService, and the Discord client.
    - `FollowUpService`: Manages tracking and notifying users about updates to previously summarized articles.
    - `Mem0Service`: (If enabled) AI-powered long-term memory using Qdrant vector database. Receives config.
    - `ChatService`: Personality-based chat with conversation memory. Receives OpenAI client, config, MongoService, and Mem0Service.
    - `ReplyHandler`: Handles replies to bot messages (chat continuation, article follow-ups, image regeneration). Receives ChatService, SummarizationService, OpenAI client, and config.
    - `LinkwardenService`: (If enabled) API communication with Linkwarden for article archiving.
    - `LinkwardenPollingService`: (If enabled) Polls Linkwarden at regular intervals to detect new archived articles.
    - `ImagenService`: (If enabled) Google Gemini-powered image generation. Receives config and MongoService.
    - `ImagePromptAnalyzerService`: (If enabled) Analyzes failed image prompts and suggests alternatives. Receives OpenAI client, config, and MongoService.
    - `ImageRetryHandler`: (If enabled) Handles reaction-based retry for failed image generations.
    - `VeoService`: (If enabled) Google Vertex AI video generation. Receives config and MongoService.
    - `QdrantService`: (If enabled) IRC history vector search via Qdrant. Receives OpenAI client and config.
    - `NickMappingService`: (If enabled) Maps Discord users to their historical IRC nicknames.
    - `ChannelContextService`: (If enabled) Passive conversation tracking for opt-in channels. Receives config, OpenAI client, MongoService, and Mem0Service. Wired into ChatService for context injection.
    - `LocalLlmService`: (If enabled) Ollama integration for uncensored chat mode. Initialized asynchronously with health check.
- **Personality Manager Setup**: Loads all personality definitions from `personalities/` directory. Wires up LocalLlmService so local-LLM-only personalities are filtered appropriately.
- **Slash Command Handler Setup**: Initializes the `SlashCommandHandler` and registers all available slash commands through `registerSlashCommands()`. Commands are registered conditionally based on which services are enabled.
- **Health Server**: Starts HTTP health check server for Kubernetes liveness (`/healthz`) and readiness (`/readyz`) probes.
- **Event Handlers Setup**: Registers listeners for Discord events: `ready`, `messageReactionAdd`, `messageCreate`, `interactionCreate`.
- **System Prompt Loading**: On `ready` event, reads the `prompt.txt` file for summarization behavior.
- **Background Services**: On `ready` event, starts RSS feed monitoring, Linkwarden polling, and Channel Context service if enabled.

## 2. Command Architecture

### 2.1. Slash Command System

The bot uses Discord's native slash command system exclusively (prefix commands were removed):

- **BaseSlashCommand Class** (`commands/base/BaseSlashCommand.js`): Abstract base class that all commands extend. Provides:
    - Argument validation via Discord's option system
    - Permission checking
    - Cooldown management
    - Deferred reply handling for long operations
    - Message splitting for responses over 2000 characters

- **SlashCommandHandler** (`handlers/SlashCommandHandler.js`): Central registry and executor for slash commands:
    - Registers commands with Discord API
    - Handles command execution with error handling
    - Manages cooldowns and permissions
    - Handles autocomplete interactions

### 2.2. Command Categories

Commands are organized into logical categories in `commands/slash/`:

- **Chat/Personality Commands**: `/chat`, `/chatthread`, `/personalities`, `/chatreset`, `/chatresume`, `/chatlist`
- **Summarization Commands**: `/summarize`, `/resummarize`
- **Media Generation**: `/imagine` (images), `/videogen` (videos)
- **Memory Commands**: `/memories`, `/remember`, `/forget`
- **IRC History Search**: `/recall`, `/history`, `/throwback`
- **Utility Commands**: `/help`, `/context`, `/channeltrack`

### 2.3. Conditional Registration

Commands are registered based on service availability:
- Memory commands only register if `Mem0Service` initialized successfully
- `/imagine` only registers if `ImagenService` is enabled with a valid API key
- `/videogen` only registers if `VeoService` is enabled with project ID and GCS bucket
- IRC history commands only register if `QdrantService` is enabled

## 3. Message and Reaction Handling

### 3.1. Reaction-Based Summarization (`ReactionHandler.js`)

- The bot listens for `messageReactionAdd` events.
- When a user reacts with the 📰 (newspaper) emoji to a message:
    - It checks if the reaction count is 1 (to avoid processing multiple times for the same reaction).
    - It extracts URLs from the message content using `UrlUtils.extractUrlsFromText`.
    - For each detected URL, it calls `summarizationService.processUrl` to begin the summarization workflow.
    - After processing, it updates the reaction count for the article in `MongoService`.

### 3.2. Image Retry Reactions (`ImageRetryHandler.js`)

- When image generation fails, the bot posts suggested alternative prompts with numbered reactions (1️⃣ 2️⃣ 3️⃣).
- `ImageRetryHandler` tracks pending retries and handles reaction-based selection.
- Users can react with ❌ to dismiss the suggestions.

### 3.3. Follow-up Reactions

- React with 📚 (books) to mark an article for follow-up tracking.

### 3.4. Slash Command Interactions

- The bot listens for `interactionCreate` events.
- For slash commands (`interaction.isChatInputCommand()`):
    - The `SlashCommandHandler` looks up the command by name.
    - It validates permissions and cooldowns.
    - If the command has `deferReply: true`, it defers the reply for long operations.
    - Commands receive the Discord interaction object and a context object containing the bot instance and configuration.
    - All slash command executions are wrapped in OpenTelemetry root spans for tracing.

### 3.5. Reply Handling (`ReplyHandler.js`)

When a user replies to a bot message, the `ReplyHandler` determines the type:
- **Personality chat reply**: Continues the conversation with the same personality
- **Article summary reply**: Answers follow-up questions about the summarized article
- **Image reply**: Regenerates an image with the user's feedback as enhancement

### 3.6. @Mention Handling

- Mentioning the bot (`@BotName`) starts a conversation with the default `friendly` personality.
- The mention is stripped from the message content and passed to ChatService.

### 3.7. Passive Channel Context Recording

- For channels with tracking enabled, every message is recorded asynchronously (non-blocking) via `ChannelContextService.recordMessage()`.

### 3.8. Thread Message Handling

- Messages in active chat threads (created by `/chatthread`) are automatically routed to the `ChatThreadSlashCommand.handleThreadMessage()` method for seamless thread-based conversations.

## 4. Summarization Workflow (`SummarizationService.js`)

The `processUrl` method orchestrates article processing and summarization:

1.  **Concurrency Check**: Ensures only one URL is processed at a time.
2.  **Duplicate Detection**: Checks `MongoService` if the URL has been summarized before.
3.  **URL Filtering**: Uses `UrlUtils` to skip image/GIF URLs.
4.  **Fact-Check Integration**: Checks `isQuestionableSource` and reacts with ⚠️ if questionable.
5.  **Content Fetching**: Relies on OpenAI's web fetching capabilities or Linkwarden archived content.
6.  **Language Detection and Translation**: If `autoTranslation` is enabled, detects and translates non-target languages.
7.  **Summary Generation**: Calls OpenAI to generate the summary. The prompt is dynamically adjusted based on `style`, `mood`, `narrator`, or `historicalPerspective`.
8.  **Summary Enhancement**: Adds reading time, topic detection, sentiment analysis, and bias analysis.
9.  **Related Articles**: Queries `MongoService` for articles with similar topics.
10. **Source Credibility**: Rates the source using `SourceCredibilityService`.
11. **Context Provision**: If enabled, provides historical/background context.
12. **Data Persistence**: Stores article metadata in `MongoService`.
13. **Discord Message Construction**: Uses `ResponseParser` to format for Discord.
14. **Send Response**: Replies with the formatted summary.
15. **Follow-up Check**: Notifies users who requested follow-ups on related topics.

## 5. Personality Chat Workflow (`ChatService.js`)

The `chat` method handles personality-based conversations:

1. **Personality Resolution**: Looks up the requested personality, defaults to `friendly-assistant`.
2. **Local LLM Routing**: Determines if the request should use the local LLM (uncensored mode or personality requires it).
3. **Conversation Management**: Retrieves or creates a channel-scoped conversation from MongoDB.
4. **Conversation Limit Checks**: Enforces message count (100), token count (150k), and idle timeout (30 min) limits.
5. **Memory Retrieval**: If Mem0 is enabled, performs 3-way parallel memory search (personality-scoped, explicit, shared channel).
6. **Channel Context Injection**: If ChannelContextService is available, injects recent channel context into the system prompt.
7. **Participant Tracking**: Updates the active participants list (30-minute window) for multiplayer awareness.
8. **System Prompt Construction**: Builds the system prompt with personality definition, active participants, relevant memories, and channel context.
9. **LLM Call**: Sends the conversation to OpenAI or local Ollama, including image attachments if present.
10. **Response Processing**: For local LLM responses, strips DeepSeek-R1 thinking tokens and enforces `maxResponseLength`.
11. **Memory Storage**: Asynchronously extracts and stores new memories via Mem0.
12. **Response Delivery**: Returns the formatted response with personality metadata.

## 6. Background Tasks

### 6.1. RSS Feed Monitoring (`RssService.js`)

- Periodically fetches new articles from configured RSS feeds.
- Checks MongoDB for duplicates, summarizes new articles, and posts to configured channels.

### 6.2. Follow-up Tracking (`FollowUpService.js`)

- Periodically checks MongoDB for articles marked as `pending` for follow-up.
- Re-summarizes and notifies requesting users via DM.

### 6.3. Linkwarden Polling (`LinkwardenPollingService.js`)

- Verifies connection to Linkwarden API on startup.
- Polls for new archived links at configured intervals.
- Detects links that have completed archiving but haven't been posted yet.
- Uses `SummarizationService.processLinkwardenLink` for summary generation.
- Tags processed links as "posted" to prevent re-processing.

### 6.4. Channel Context Batch Indexing (`ChannelContextService.js`)

- Periodically indexes recorded messages into the Qdrant vector database for semantic search.
- Optionally extracts channel-level memories via Mem0 at configurable intervals.

## 7. Data Persistence (`MongoService.js`)

`MongoService` interacts with MongoDB to store and retrieve:

- **Articles Collection**: URL, user, tokens, costs, topic, sentiment, bias, reactions, follow-up status.
- **Conversations Collection**: Channel-scoped personality conversations with message history.
- **Image Generations Collection**: Prompt, user, timestamp, success/failure, retry attempts.
- **Video Generations Collection**: Prompt, user, timestamp, generation parameters.
- **Token Usage**: Per-user token consumption tracking.
- Provides methods for duplicate detection, conversation management, usage tracking, and analytics.

## 8. Configuration (`config/config.js`)

All configurable parameters are managed through `config.js` and environment variables, organized into sections:

- **Discord**: Token, client ID, intents, admin user IDs
- **OpenAI**: API key, base URL, model, method
- **MongoDB**: Connection URI
- **Bot Features**: Summarization styles, moods, narrators, fact checking, source credibility, RSS, follow-ups, translation, bias detection
- **Linkwarden**: Self-hosted article archiving
- **Imagen**: Gemini image generation (model, cooldowns, aspect ratios)
- **Veo**: Vertex AI video generation (project, bucket, duration, polling)
- **Mem0**: AI memory with Qdrant vector database
- **Qdrant**: IRC history search
- **Channel Context**: Passive conversation tracking (tiers, retention, search thresholds)
- **Local LLM**: Ollama integration for uncensored mode (model, temperature, response limits, access controls)
- **Health**: Kubernetes probe endpoints

## 9. Architecture Benefits

The architecture provides several advantages:

- **Modularity**: Each command and service is self-contained.
- **Conditional Loading**: Services and commands only initialize when their dependencies are available.
- **Scalability**: New commands can be added without modifying core handlers.
- **Observability**: OpenTelemetry tracing covers all entry points (slash commands, reactions, replies, mentions).
- **Graceful Degradation**: Optional services (Mem0, Qdrant, LocalLlm, Imagen, Veo) degrade gracefully when unavailable.
- **Testability**: Services and commands can be unit tested in isolation with mocked dependencies.
- **Performance**: Command lookup is O(1) using a Map structure.
- **Graceful Shutdown**: SIGTERM/SIGINT handlers flush pending spans, stop polling services, and close connections.
