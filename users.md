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

## Chat

Chat with the bot using a voice that reflects the group's communication style. The bot remembers conversation history within each channel.

### Quick Start

Just type `/chat message:Hello!` to start chatting.

### Commands

| Command | Description |
|---------|-------------|
| `/chat message:<text>` | Chat with the bot |
| `/chat message:<text> image:<file>` | Chat about an attached image |
| `/chatthread message:<text>` | Start a dedicated chat thread |
| `/chatlist` | List your resumable conversations |
| `/chatresume message:<text>` | Resume an expired conversation |
| `/chatreset` | Reset conversation history (admin only) |
| `/catchmeup` | Get a DM summary of what you missed |

### Conversation Memory

- **Channel-scoped**: Each channel has its own conversation history
- **Multi-user**: Everyone in the channel shares the same conversation - the bot knows who said what
- **Limits**: Conversations have resource limits:
  - Maximum 100 messages per conversation
  - Maximum 150,000 tokens per conversation
  - Conversations expire after 30 minutes of inactivity
- **Resume**: Use `/chatresume` to pick up where you left off after expiration

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
- **Reply to bot messages** to ask follow-up questions about summaries or regenerate images
- If the bot detects a questionable source, it will add a ⚠️ warning
- Multiple users can participate in the same conversation - the bot knows who said what
- Mention the bot (`@BotName`) to start a conversation

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `/help` | Show all commands |
| `/summarize url:<url>` | Summarize an article |
| `/resummarize url:<url>` | Re-summarize (bypass cache) |
| `/chat message:<msg>` | Chat with the bot |
| `/chatthread message:<msg>` | Start a chat thread |
| `/chatlist` | List resumable conversations |
| `/chatresume message:<msg>` | Resume expired conversation |
| `/chatreset` | Reset conversation (admin) |
| `/catchmeup` | DM summary of what you missed |
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
