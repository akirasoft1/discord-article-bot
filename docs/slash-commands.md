# Slash Commands

This document describes the Discord slash commands available in the bot.

## Overview

As of version 2.0.0, the bot uses Discord's native slash commands (`/command`) instead of prefix-based commands (`!command`). This provides:

- **Discoverability**: Commands appear in Discord's autocomplete when you type `/`
- **Validation**: Discord validates parameters before sending
- **Better UX**: Parameter names and descriptions are shown inline
- **Mobile friendly**: Tap-based parameter selection

## Setup

### 1. Configure Discord Client ID

Add your Discord application's Client ID to your environment:

```bash
DISCORD_CLIENT_ID=your_application_client_id
```

You can find this in the [Discord Developer Portal](https://discord.com/developers/applications) under your application's General Information.

### 2. Register Commands

After deploying the bot, register the slash commands with Discord:

```bash
npm run register:commands
```

**Note:** Global commands can take up to 1 hour to appear. For instant updates during development, set `DISCORD_TEST_GUILD_ID` to a specific guild ID.

## Available Commands

### Chat Commands

| Command | Description |
|---------|-------------|
| `/chat` | Chat with an AI personality |
| `/chatthread` | Start a dedicated conversation thread |
| `/personalities` | List available personalities |
| `/chatlist` | View your resumable conversations |
| `/chatresume` | Resume an expired conversation |
| `/chatreset` | Reset a conversation (admin only) |

### Summarization

| Command | Description |
|---------|-------------|
| `/summarize` | Summarize an article from a URL |
| `/resummarize` | Force re-summarize (bypass cache) |

### Media Generation

| Command | Description |
|---------|-------------|
| `/imagine` | Generate an image from text |
| `/videogen` | Generate a video from text/images |

### Memory

| Command | Description |
|---------|-------------|
| `/memories` | View what the bot remembers about you |
| `/remember` | Tell the bot something to remember |
| `/forget` | Delete a specific memory or all memories |

### IRC History

| Command | Description |
|---------|-------------|
| `/recall` | Search IRC history semantically |
| `/history` | View IRC history for a user |
| `/throwback` | Random "on this day" IRC memory |

### Utility

| Command | Description |
|---------|-------------|
| `/help` | Show all commands and usage |
| `/context` | View channel conversation context |
| `/channeltrack` | Manage channel tracking (admin) |

## Conversation Continuation

You can still **reply directly to bot messages** to continue conversations - no slash command needed! The bot detects when you're replying to one of its messages and continues the conversation context automatically.

### Chat Threads

Use `/chatthread` to create a dedicated thread for extended conversations. In the thread, just type your messages normally - no commands required.

```
/chatthread personality:jack message:Tell me about the case

[Bot creates thread "Chat with Jack Shadows"]

You: What happened next?
Jack: *responds without needing /chat*

You: Any leads?
Jack: *continues naturally*
```

## Command Parameters

### `/chat`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `message` | Yes | Your message to the personality |
| `personality` | No | Which personality (default: friendly) |
| `image` | No | Optional image attachment |
| `uncensored` | No | Use local LLM for less restricted responses (if enabled) |

**Uncensored Mode:**

When `uncensored:true` is specified and a local LLM (Ollama) is configured, the bot routes the request to the local model instead of OpenAI. This allows for less restricted responses while keeping the same personality.

Requirements:
- Local LLM must be enabled via `LOCAL_LLM_ENABLED=true`
- User must have access (configurable via allowed channels/users)
- If `UNCENSORED_REQUIRE_NSFW=true`, only works in NSFW channels

Visual indicator: Responses include a 🔓 emoji when uncensored mode is active.

### `/summarize`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | Article URL to summarize |
| `style` | No | Summary style (pirate, shakespeare, genz, academic) |

### `/imagine`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | Description of image to generate |
| `ratio` | No | Aspect ratio (1:1, 16:9, 9:16, etc.) |
| `reference` | No | Reference image attachment |

### `/recall`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Search terms |
| `my_messages` | No | Only show your messages |
| `year` | No | Filter by year (1999-2024) |

## Troubleshooting

### Commands not appearing

1. Ensure `DISCORD_CLIENT_ID` is set correctly
2. Run `npm run register:commands`
3. Wait up to 1 hour for global commands to propagate
4. For faster testing, set `DISCORD_TEST_GUILD_ID`

### "Unknown Command" errors

The bot needs to be restarted after code changes. Ensure the latest version is deployed.

### Permission issues

Some commands require administrator permissions. Check that bot admins are configured in `BOT_ADMIN_USER_IDS`.
