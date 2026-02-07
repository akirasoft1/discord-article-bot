# How to Use the Discord Article Bot

This guide explains how to interact with the bot using Discord slash commands.

## Getting Help

- **Command**: `/help`
- **Description**: Shows all available commands with descriptions and usage examples.

---

## Article Summarization

### Reaction-Based Summarization

React to any message containing an article URL with the 📰 (newspaper) emoji. The bot will reply with a summary including:
- Reading time estimate
- Topic detection
- Sentiment analysis
- Source credibility rating

### Command-Based Summarization

| Command | Description |
|---------|-------------|
| `/summarize url:<url>` | Summarize the article at the given URL |
| `/resummarize url:<url>` | Force re-summarization (bypass duplicate check) |

### Ask Follow-up Questions

After the bot summarizes an article, **reply directly** to the summary message to ask follow-up questions. The bot uses the article context to answer.

**Example**:
1. Use `/summarize url:https://example.com/article`
2. The bot provides a summary
3. Reply to the summary with "What are the main takeaways?"
4. The bot answers based on the article

---

## Personality Chat

Chat with unique AI personalities for fun, creative conversations. The bot remembers conversation history within each channel.

### Quick Start

Just type `/chat message:Hello!` to start chatting with the default **Friendly Assistant** personality.

### Commands

| Command | Description |
|---------|-------------|
| `/chat message:<text>` | Chat with the default personality (Friendly Assistant) |
| `/chat message:<text> personality:<name>` | Chat with a specific personality |
| `/chat message:<text> image:<file>` | Chat about an attached image |
| `/chat message:<text> uncensored:true` | Route to local LLM for less restricted responses |
| `/chatthread message:<text>` | Start a dedicated chat thread |
| `/personalities` | List all available personalities |
| `/chatlist` | List your resumable conversations |
| `/chatresume personality:<name> message:<text>` | Resume an expired conversation |
| `/chatreset personality:<name>` | Reset a conversation (admin only) |

### Reply to Continue

You can **reply directly** to any bot personality message to continue the conversation without using commands. Just use Discord's reply feature.

**Example**:
1. Use `/chat message:Tell me a story`
2. The bot responds
3. Reply to that message with "What happened next?"
4. The conversation continues naturally

### Conversation Memory

- **Channel-scoped**: Each channel has its own conversation with each personality
- **Multi-user**: Everyone in the channel shares the same conversation - the personality knows who said what
- **Limits**: Conversations have resource limits:
  - Maximum 100 messages per conversation
  - Maximum 150,000 tokens per conversation
  - Conversations expire after 30 minutes of inactivity
- **Resume**: Use `/chatresume` to pick up where you left off after expiration

### Available Personalities

| ID | Name | Description |
|----|------|-------------|
| `friendly-assistant` | 😊 Friendly Assistant | Helpful, informal assistant for casual chat and questions (**default**) |
| `grumpy-historian` | 📚 Professor Grimsworth | An irritable history professor who relates everything to obscure historical events |
| `noir-detective` | 🕵️ Jack Shadows | A hardboiled 1940s detective who narrates everything in classic noir prose |
| `existential-philosopher` | 🤔 Erik the Existentialist | A philosophy grad student who spirals every topic into questions about meaning |
| `irc-gamer` | 💾 x0r_kid | A 90s IRC gamer kid with leet speak and old-school internet vibes |
| `uncensored` | 🔓 Uncensored | Enhanced personality that uses local LLM for less restricted responses |

### Uncensored Mode

When available, you can get less restricted responses by either:
- Using `/chat message:<text> uncensored:true` with any personality
- Choosing the `uncensored` personality directly

Uncensored responses are marked with a 🔓 emoji. This requires the bot admin to have a local LLM (Ollama) configured.

---

## Image Generation (Nano Banana)

Generate AI images using Google's Gemini API.

| Command | Description |
|---------|-------------|
| `/imagine prompt:<text>` | Generate an image from a text prompt |
| `/imagine prompt:<text> ratio:<ratio>` | Generate with a custom aspect ratio |
| `/imagine prompt:<text> reference:<image>` | Edit/transform a reference image |

**Supported Aspect Ratios:** 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9

### Tips
- If generation fails, the bot analyzes why and suggests alternative prompts
- React with 1️⃣ 2️⃣ 3️⃣ to retry with a suggested prompt, or ❌ to dismiss
- **Reply to a generated image** with feedback to create an enhanced version
- You can use Discord emojis as reference images

---

## Video Generation (Veo)

Generate AI videos using Google's Veo 3.1.

| Command | Description |
|---------|-------------|
| `/videogen prompt:<text>` | Generate a video from text (text-to-video) |
| `/videogen prompt:<text> first_frame:<image>` | Animate a single image |
| `/videogen prompt:<text> first_frame:<image> last_frame:<image>` | First and last frame transition |
| `/videogen prompt:<text> duration:<4\|6\|8>` | Set video duration (seconds) |
| `/videogen prompt:<text> aspect_ratio:<16:9\|9:16>` | Set aspect ratio |

### Tips
- Videos take some time to generate; the bot provides real-time progress updates
- You can use Discord emojis as source images

---

## AI Memory

The bot can remember facts about you across conversations.

| Command | Description |
|---------|-------------|
| `/memories` | View your stored memories |
| `/remember fact:<text>` | Manually store a memory about yourself |
| `/forget` | Delete all your memories |
| `/forget search:<text>` | Delete memories matching a search term |

### How Memory Works
- The bot automatically extracts preferences and facts from conversations
- Relevant memories are retrieved when you chat, making responses more personal
- Memories are per-user and private
- Shared channel memories (facts about the channel) are visible to all users in that channel

---

## IRC History Search

Search through archived IRC conversations using natural language.

| Command | Description |
|---------|-------------|
| `/recall query:<text>` | Semantic search through IRC history |
| `/recall query:<text> my_messages:true` | Filter to your own IRC conversations |
| `/recall query:<text> year:<year>` | Filter by specific year |
| `/history` | View your own IRC history |
| `/history user:<@user>` | View another user's IRC history |
| `/throwback` | Random conversation from this day in history |

**Note:** These commands require Discord-to-IRC nick mapping and are only visible when the Qdrant service is available.

---

## Channel Tracking

Admins can enable passive conversation tracking for specific channels, which gives the bot awareness of ongoing discussions.

| Command | Description |
|---------|-------------|
| `/context` | View the current channel's conversation context |
| `/channeltrack` | Manage channel tracking (admin only) |

---

## Follow-up Tracker

React to a bot's summary message with the 📚 (books) emoji to mark that article for follow-up. You'll receive a notification if new related articles are summarized.

---

## Tips

- Type `/` in Discord to see all available bot commands with autocomplete
- **Reply to bot messages** to continue personality chats or ask follow-up questions about summaries
- If the bot detects a questionable source, it will add a ⚠️ warning
- Personalities maintain their character throughout conversations
- Multiple users can participate in the same personality conversation - it's like a group chat with a character
- Mention the bot (`@BotName`) to start a conversation with the default personality

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `/help` | Show all commands |
| `/summarize url:<url>` | Summarize an article |
| `/resummarize url:<url>` | Re-summarize (bypass cache) |
| `/personalities` | List chat personalities |
| `/chat message:<msg>` | Chat with default personality |
| `/chat message:<msg> personality:<id>` | Chat with a specific personality |
| `/chatthread message:<msg>` | Start a chat thread |
| `/chatlist` | List resumable conversations |
| `/chatresume personality:<id> message:<msg>` | Resume expired conversation |
| `/chatreset personality:<id>` | Reset conversation (admin) |
| `/imagine prompt:<text>` | Generate an image |
| `/videogen prompt:<text>` | Generate a video |
| `/memories` | View your memories |
| `/remember fact:<text>` | Store a memory |
| `/forget` | Delete your memories |
| `/recall query:<text>` | Search IRC history |
| `/history` | View IRC history |
| `/throwback` | Random IRC throwback |
| `/context` | View channel context |
| `/channeltrack` | Manage tracking (admin) |
