# Discord Article Archiver Bot

A Discord bot that monitors for article links in channels, processes them through archive.today for archival, and uses OpenAI-compatible APIs to automatically generate summaries of linked articles.

## Features

- 📰 **Reaction-based Summarization**: React with 📰 emoji to any message containing URLs to trigger automatic summarization
- 🗃️ **Archive.today Integration**: Automatically converts archive links to text-only versions for better processing  <-- when it works!!!
- 🤖 **AI-Powered Summaries**: Uses OpenAI-compatible APIs (including Ollama) to generate concise 1500-character summaries
- 🔍 **Smart URL Detection**: Filters out images and GIF links automatically
- 📝 **Configurable System Prompts**: Customize the AI's summarization behavior via `prompt.txt`
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
   OPENAI_METHOD=completion                      # 'completion' or 'response'
   LOG_LEVEL=info                                # 'debug', 'info', 'warn', 'error'
   DEBUG=false                                   # Set to 'true' for verbose logging
   ```

4. **Create system prompt file:**
   
   Create a `prompt.txt` file in the root directory with your desired summarization instructions, for example:
   ```
   You are a helpful assistant that summarizes articles concisely and accurately.
   Focus on the main points and key takeaways.
   ```
   A rather large prompt is included in the repository, but you can customize it as needed.



## Project Structure

```
discord-article-archiver-bot/
├── bot.js                    # Main bot entry point
├── logger.js                 # Winston logger configuration
├── prompt.txt               # AI system prompt
├── .env                     # Environment variables
├── package.json             # Project dependencies
├── config/
│   └── config.js            # Configuration management
├── services/
│   ├── ArchiveService.js    # Archive.today URL handling
│   └── SummarizationService.js  # AI summarization logic
├── handlers/
│   └── ReactionHandler.js   # Discord reaction handling
└── utils/
    └── urlUtils.js          # URL parsing and validation
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
   - The bot will process the URL(s) and reply with a summary

## Configuration Options

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | Yes | - | Your Discord bot token |
| `OPENAI_API_KEY` | Yes | - | OpenAI API key or Ollama key |
| `OPENAI_BASE_URL` | No | `http://localhost:11434/v1/` | API endpoint URL |
| `OPENAI_METHOD` | No | `completion` | API method: 'completion' or 'response' |
| `LOG_LEVEL` | No | `info` | Logging level: debug, info, warn, error |
| `DEBUG` | No | `false` | Enable verbose Discord.js debugging |

### Supported OpenAI Models

- **OpenAI**: GPT-4, GPT-3.5-turbo, etc.
- **Ollama**: gemma3:27b, llama2, mistral, etc.
- **Custom**: Any OpenAI-compatible endpoint

## Archive.today URL Handling

The bot intelligently handles archive.today URLs:
- Converts archive links to text-only versions for better content extraction
- Handles multiple archive.today domains (archive.is, archive.ph, etc.)
- Detects and warns about shortlinks that can't be directly processed
- Validates embedded URLs for security

## Logging

The bot uses Winston for structured logging:
- **Info**: General operation logs
- **Warn**: Non-critical issues
- **Error**: Errors that need attention
- **Debug**: Detailed debugging information (enable with `DEBUG=true`)

View logs with timestamps and color coding for easy monitoring.

## Troubleshooting

### Bot not responding to reactions
- Ensure the bot has these permissions: `Read Messages`, `Read Message History`, `Add Reactions`, `Send Messages`
- Check that the bot can see the channel where reactions are added
- Verify the `MessageContent` intent is enabled in Discord Developer Portal

### Archive links not working
- The bot will inform you if an archive link is a shortlink (can't be processed)
- Check logs for specific error messages about URL parsing

### Summaries not generating
- Verify your OpenAI API key is valid
- Check that the API endpoint is accessible
- Review logs for API error messages
- Ensure `prompt.txt` exists and is readable

### Debug mode
Enable debug logging to see detailed information:
```bash
DEBUG=true LOG_LEVEL=debug npm start
```

## Development

### Adding new features
1. Create new services in the `services/` directory
2. Add utility functions to `utils/`
3. Implement event handlers in `handlers/`
4. Update configuration in `config/config.js`

### Running tests
```bash
npm test    # lol as If tests are implemented
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

