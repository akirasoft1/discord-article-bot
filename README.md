# Discord Article Archiver Bot

This project is a Discord bot that watches for article links in a channel, sends them to archive.is for archival, and uses ChatGPT APIs to automatically create a 1500 character summary of the linked article.

## Setup and Running the Bot

1. Clone the repository:
   ```sh
   git clone https://github.com/githubnext/workspace-blank.git
   cd workspace-blank
   ```

2. Install dependencies:
   ```sh
   npm install
   ```

3. Create a `.env` file in the root directory and add your Discord bot token and OpenAI API key:
   ```sh
   DISCORD_TOKEN=your_discord_token
   OPENAI_API_KEY=your_openai_api_key
   ```

4. Run the bot:
   ```sh
   node bot.js
   ```
