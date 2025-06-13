# Discord Article Archiver Bot

A Discord bot that monitors for article links in channels, processes them through archive.today for archival, and uses OpenAI-compatible APIs to automatically generate summaries of linked articles.

## Features

- 📰 **Reaction-based Summarization**: React with 📰 emoji to any message containing URLs to trigger automatic summarization
- 🗃️ **Archive.today Integration**: Automatically converts archive links to text-only versions for better processing
- 🤖 **AI-Powered Summaries**: Uses OpenAI-compatible APIs (including Ollama) to generate concise 1500-character summaries
- 🔍 **Smart URL Detection**: Filters out images and GIF links automatically
- 📝 **Configurable System Prompts**: Customize the AI's summarization behavior via `prompt.txt`
- 💰 **Cost Tracking**: Real-time token usage and cost breakdown for each summary (OpenAI models)
- 📊 **Token Counting**: Accurate token estimation using tiktoken library
- 🔗 **Link Sanitization**: Removes URLs from summaries to prevent Discord auto-expansion
- 🛡️ **Robust Error Handling**: Graceful handling of invalid URLs, failed requests, and API errors

## Prerequisites

- Node.js v16.9.0 or higher
- npm or yarn
- Discord Bot Token ([Discord Developer Portal](https://discord.com/developers/applications))
- OpenAI API Key or Ollama instance

## Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd discord-article-archiver-bot
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
   
   # Optional
   OPENAI_BASE_URL=http://localhost:11434/v1/  # For Ollama or custom endpoints
   OPENAI_METHOD=response                        # 'completion' or 'response'
   LOG_LEVEL=info                                # 'debug', 'info', 'warn', 'error'
   DEBUG=false                                   # Set to 'true' for verbose logging
   ```

4. **Create system prompt file:**
   
   Create a `prompt.txt` file in the root directory with your desired summarization instructions. A comprehensive prompt is included in the repository, but you can customize it as needed.

## Project Structure

```
discord-article-archiver-bot/
├── bot.js                        # Main bot entry point
├── logger.js                     # Winston logger configuration
├── prompt.txt                    # AI system prompt
├── .env                          # Environment variables
├── package.json                  # Project dependencies
├── config/
│   └── config.js                 # Configuration management
├── services/
│   ├── ArchiveService.js         # Archive.today URL handling
│   ├── SummarizationService.js   # Main summarization orchestration
│   ├── TokenService.js           # Token counting and estimation
│   ├── CostService.js            # Cost calculation and tracking
│   └── ResponseParser.js         # API response parsing and formatting
├── handlers/
│   └── ReactionHandler.js        # Discord reaction handling
└── utils/
    └── urlUtils.js               # URL parsing and validation
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

   For debug mode:
   ```bash
   npm run debug
   ```

2. **In Discord:**
   - Send or find a message containing article URLs
   - React with the 📰 (newspaper) emoji
   - The bot will process the URL(s) and reply with:
     - A concise summary
     - Token usage statistics
     - Cost breakdown (for OpenAI models)

## Example Bot Response

```
**Summary:** The US Navy is struggling with ship repair backlogs due to outdated facilities and workforce shortages. The Government Accountability Office report highlights that 70% of maintenance periods exceed planned duration, impacting fleet readiness...

📊 **Token Usage:** Input: 1,267 (500 cached), Output: 289, Total: 1,556
💰 **Cost:** Input: 0.0302¢, Output: 0.0462¢, Total: 0.0764¢
```

## Configuration Options

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | Yes | - | Your Discord bot token |
| `OPENAI_API_KEY` | Yes | - | OpenAI API key or Ollama key |
| `OPENAI_BASE_URL` | No | `http://localhost:11434/v1/` | API endpoint URL |
| `OPENAI_METHOD` | No | `response` | API method: 'completion' or 'response' |
| `LOG_LEVEL` | No | `info` | Logging level: debug, info, warn, error |
| `DEBUG` | No | `false` | Enable verbose Discord.js debugging |

### Supported AI Models

#### OpenAI Models (via `response` method)
- **GPT-4.1 mini**: Optimized for cost-effective summarization
- Includes real-time cost tracking:
  - Input: $0.40 per 1M tokens
  - Cached input: $0.10 per 1M tokens
  - Output: $1.60 per 1M tokens

#### Ollama Models (via `completion` method)
- **gemma3:27b**: Default local model
- **llama2**, **mistral**, etc.: Any Ollama-supported model
- No cost tracking for local models

## Key Features

### Token Counting & Cost Tracking
- Uses OpenAI's tiktoken library for accurate token estimation
- Real-time cost calculation for each summary
- Cumulative cost tracking across sessions
- Differentiates between regular and cached tokens

### Link Sanitization
The bot automatically removes or sanitizes links in summaries to prevent Discord's auto-expansion:
- Markdown links `[text](url)` → `[text]`
- Plain URLs `https://example.com` → `[example.com]`

### Archive.today URL Handling
- Converts archive links to text-only versions for better content extraction
- Handles multiple archive.today domains (archive.is, archive.ph, etc.)
- Detects and warns about shortlinks that can't be directly processed
- Validates embedded URLs for security

## Logging

The bot uses Winston for structured logging with:
- **Timestamp**: ISO format with milliseconds
- **Color coding**: Different colors for each log level
- **Debug mode**: Detailed Discord.js events when `DEBUG=true`
- **Cost tracking**: Logs individual and cumulative costs

## Troubleshooting

### Bot not responding to reactions
- Ensure the bot has permissions: `Read Messages`, `Read Message History`, `Add Reactions`, `Send Messages`
- Check that the bot can see the channel where reactions are added
- Verify the `MessageContent` intent is enabled in Discord Developer Portal

### High token usage discrepancy
- The bot uses GPT-3.5-turbo's tokenizer as a proxy for GPT-4.1-mini
- Actual usage may vary by ~20-60% from estimates
- Check logs for exact token usage from API responses

### Summaries contain unwanted elements
- Adjust the `prompt.txt` file to refine summarization behavior
- Check if links are being properly sanitized in the output

### Debug mode
Enable comprehensive logging:
```bash
DEBUG=true LOG_LEVEL=debug npm start
```

## Development

### Adding new features
1. Create new services in the `services/` directory
2. Add utility functions to `utils/`
3. Implement event handlers in `handlers/`
4. Update configuration in `config/config.js`

### Architecture
The bot follows a modular architecture:
- **SummarizationService**: Orchestrates the summarization flow
- **TokenService**: Handles all token counting operations
- **CostService**: Manages pricing calculations and tracking
- **ResponseParser**: Processes API responses and formats output

### Running tests
```bash
npm test    # Note: Tests not yet implemented
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Future Enhancements

- Support for multiple AI models with different pricing tiers
- Database storage for summarization history
- User-specific rate limiting and cost tracking
- Cost statistics command
- Batch URL processing

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE.md) file for details.