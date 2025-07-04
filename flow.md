# Bot Logic Flow

This document outlines the overall logic and operational flow of the Discord Article Bot, detailing how it processes URLs, generates summaries, and integrates various enhanced features.

## 1. Bot Initialization (`bot.js`)

Upon startup, the `bot.js` file serves as the main entry point. It performs the following initialization steps:

- **Discord Client Setup**: Initializes the Discord.js client with necessary intents (Guilds, GuildMessages, GuildMessageReactions, MessageContent) to listen for relevant events.
- **OpenAI Client Setup**: Configures the OpenAI client using the API key and base URL from `config.js`.
- **Service Instantiation**: Creates instances of various services, passing necessary dependencies:
    - `SummarizationService`: The core service responsible for handling article processing and summary generation. It receives the OpenAI client, bot configuration, and the Discord client itself (for direct messaging users for follow-ups).
    - `ReactionHandler`: Manages Discord message reactions, specifically the 📰 emoji, to trigger summarization. It receives the `SummarizationService` and `MongoService`.
    - `RssService`: Handles fetching and processing RSS feeds for breaking news alerts. It receives `MongoService`, `SummarizationService`, and the Discord client.
    - `FollowUpService`: Manages tracking and notifying users about updates to previously summarized articles. It receives `MongoService`, `SummarizationService`, and the Discord client.
    - `SubscriptionService`: Manages user subscriptions to specific topics for personalized news alerts. It receives `MongoService`.
    - `AnalyticsService`: Provides methods for generating various analytics and insights, such as news trends and reading habits. It receives `MongoService`.
- **Command Handler Setup**: Initializes the `CommandHandler` and registers all available commands through the `registerCommands` method.
- **Event Handlers Setup**: Registers listeners for Discord events like `ready`, `messageReactionAdd`, and `messageCreate`.
- **System Prompt Loading**: Reads the `prompt.txt` file to load the system prompt, which guides the AI's summarization behavior, and sets it in the `SummarizationService`.
- **RSS Feed Monitoring**: If enabled in `config.js`, initiates a periodic task to check configured RSS feeds for new articles.

## 2. Command Architecture

### 2.1. Command Handler System

The bot uses a modular command architecture that replaces the previous if-else chain:

- **BaseCommand Class** (`commands/base/BaseCommand.js`): Abstract base class that all commands extend. Provides:
    - Argument validation
    - Usage help generation
    - Permission checking
    - Cooldown management
    - Command metadata (name, aliases, description, category)

- **CommandHandler** (`commands/CommandHandler.js`): Central registry and executor for commands:
    - Registers commands and their aliases
    - Organizes commands by category
    - Handles command execution with error handling
    - Manages cooldowns and permissions
    - Provides help system integration

### 2.2. Command Categories

Commands are organized into logical categories:

- **Subscription Commands** (`commands/subscription/`):
    - `SubscribeCommand`: Subscribe to news topics
    - `UnsubscribeCommand`: Unsubscribe from topics
    - `MySubscriptionsCommand`: List current subscriptions

- **Analytics Commands** (`commands/analytics/`):
    - `NewsTrendsCommand`: Server-wide trending topics
    - `MyReadingHabitsCommand`: Personal reading statistics
    - `PopularSourcesCommand`: Most shared news sources
    - `ControversyMeterCommand`: Most controversial articles

- **Summarization Commands** (`commands/summarization/`):
    - `SummarizeCommand`: Basic article summarization with styles
    - `MoodSummarizeCommand`: Mood-based summaries
    - `NarrateSummarizeCommand`: Celebrity narrator summaries
    - `HistoricalSummarizeCommand`: Historical perspective summaries
    - `PerspectiveSummarizeCommand`: Alternative viewpoint summaries
    - `LearnLanguageCommand`: Multi-language summaries
    - `CulturalSummarizeCommand`: Cultural context summaries

- **Utility Commands** (`commands/utility/`):
    - `PollCommand`: Generate polls from articles
    - `DiscussionQuestionsCommand`: Generate discussion starters
    - `HelpCommand`: Display available commands and usage

## 3. Message and Reaction Handling

### 3.1. Reaction-Based Summarization (`ReactionHandler.js`)

- The bot listens for `messageReactionAdd` events.
- When a user reacts with the 📰 (newspaper) emoji to a message:
    - It checks if the reaction count is 1 (to avoid processing multiple times for the same reaction).
    - It extracts URLs from the message content using `UrlUtils.extractUrlsFromText`.
    - For each detected URL, it calls `summarizationService.processUrl` to begin the summarization workflow.
    - After processing, it updates the reaction count for the article in `MongoService`.

### 3.2. Command-Based Interactions

- The bot listens for `messageCreate` events.
- If a message starts with the configured prefix (default `!`), it extracts the command name and arguments.
- The `CommandHandler` looks up the command (checking both names and aliases).
- If found, it validates permissions and arguments, then executes the command's `execute` method.
- Commands receive:
    - The Discord message object
    - Parsed arguments array
    - Context object containing bot instance and configuration

## 4. Summarization Workflow (`SummarizationService.js`)

The `processUrl` method in `SummarizationService` orchestrates the entire article processing and summarization flow:

1.  **Concurrency Check**: Ensures only one URL is processed at a time to prevent rate-limiting issues.
2.  **Duplicate Detection**: Checks `MongoService` if the URL has been summarized before. If so, it informs the user and exits.
3.  **URL Filtering**: Uses `UrlUtils` to skip image/GIF URLs.
4.  **Fact-Check Integration**: Checks `isQuestionableSource` (based on `config.js`) and reacts with ⚠️ if the source is questionable.
5.  **URL Preprocessing**: Transforms archive.today URLs using `ArchiveService` if necessary.
6.  **Content Fetching**: Fetches the article content. If it's an `archive.today/TEXT/` URL, it fetches directly; otherwise, it relies on OpenAI's web fetching capabilities.
7.  **Language Detection and Translation**: If `autoTranslation` is enabled in `config.js`, it detects the language of the content. If it's not the target language, it translates the content using OpenAI.
8.  **Summary Generation**: Calls OpenAI (either via `responses` or `chat.completions` API based on `config.openai.method`) to generate the summary. The AI's prompt is dynamically adjusted based on selected `style`, `mood`, `narrator`, or `historicalPerspective`.
9.  **Summary Enhancement**: Calls `enhanceSummary` to add:
    - **Reading Time**: Calculates estimated reading time using `TextUtils`.
    - **Topic Detection**: Uses OpenAI to identify the main topic of the article.
    - **Sentiment Analysis**: Uses OpenAI to determine the sentiment of the article.
    - **Bias Analysis**: Uses OpenAI to detect potential biases in the article.
10. **Related Articles**: Queries `MongoService` for articles with similar topics.
11. **Source Credibility**: Uses `SourceCredibilityService` to rate the credibility of the article's source.
12. **Context Provision**: If enabled, uses OpenAI to provide historical or background context for the article's topic.
13. **Data Persistence**: Stores the article's metadata (URL, user, tokens, topic, etc.) in `MongoService`.
14. **Discord Message Construction**: Uses `ResponseParser` to format the summary and all enhanced data into a Discord-friendly message.
15. **Send Response**: Replies to the user's message with the formatted summary.
16. **Follow-up Check**: If `followUpTracker` is enabled, checks `MongoService` for users who requested follow-ups on related topics and notifies them.

## 5. Background Tasks

### 5.1. RSS Feed Monitoring (`RssService.js`)

- Periodically (configured in `config.js`), `RssService` fetches new articles from specified RSS feeds.
- For each new article:
    - It checks `MongoService` to ensure the article hasn't been processed before.
    - If new, it persists the article data.
    - It then uses `SummarizationService` to summarize and enhance the article to extract its topic.
    - If the article has a topic, it queries `MongoService` for users subscribed to that topic.
    - It sends personalized direct messages to subscribed users with the new article's link and summary.

### 5.2. Follow-up Tracking (`FollowUpService.js`)

- Periodically (configured in `config.js`), `FollowUpService` checks `MongoService` for articles marked as `pending` for follow-up.
- For each pending article:
    - It re-summarizes the article to get fresh content.
    - It notifies all users who requested a follow-up via direct message.
    - It updates the article's `followUpStatus` to `completed` in `MongoService`.

## 6. Data Persistence (`MongoService.js`)

`MongoService` interacts with a MongoDB database to store and retrieve various types of data:

- **Articles Collection**: Stores summarized articles, including URL, user ID, username, token usage, costs, topic, sentiment, bias analysis, reactions, follow-up status, and creation timestamp.
- **Users Collection**: Stores user-specific data, primarily their subscribed topics for personalized feeds.
- Provides methods for:
    - Persisting new article data.
    - Finding articles by URL (for duplicate detection).
    - Updating follow-up statuses and adding follow-up users.
    - Retrieving articles marked for follow-up.
    - Managing user topic subscriptions (add, remove, list).
    - Aggregating article trends, reading counts, and popular sources.
    - Retrieving controversial articles based on reactions.

## 7. Configuration (`config/config.js`)

All configurable parameters, including API keys, bot intents, OpenAI model settings, feature toggles, and specific data for features like questionable sources, trusted sources, summary styles, moods, narrators, historical perspectives, bias detection, alternative perspectives, context provider, auto-translation, and language learning, are managed through `config.js` and environment variables.

## 8. Architecture Benefits

The refactored command architecture provides several advantages:

- **Modularity**: Each command is self-contained, making it easy to add, modify, or remove commands.
- **Scalability**: New commands can be added without modifying the core message handler.
- **Maintainability**: Commands can be updated independently without affecting others.
- **Testability**: Individual commands can be unit tested in isolation.
- **Discoverability**: The help system automatically includes all registered commands.
- **Consistency**: All commands follow the same pattern for validation, execution, and error handling.
- **Performance**: Command lookup is O(1) using a Map structure.