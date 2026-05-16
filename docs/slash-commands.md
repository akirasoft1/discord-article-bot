# Slash Commands

This document describes the Discord slash commands available in the bot.

## Overview

The bot uses Discord's native slash commands (`/command`). This provides:

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

**Note:** `scripts/registerCommands.js` always pushes the schema globally; if `DISCORD_TEST_GUILD_ID` is set, it *also* pushes to that guild for instant feedback. Discord shadows global commands with guild commands in the same guild, so there's no duplication. Global commands can take up to 1 hour to appear in non-test guilds; CTRL-R in the Discord client forces a refresh.

## Available Commands

### Chat Commands

| Command | Description |
|---------|-------------|
| `/chat` | Chat with the bot |
| `/chatthread` | Start a dedicated conversation thread |
| `/chatlist` | View your resumable conversations |
| `/chatresume` | Resume an expired conversation |
| `/chatreset` | Reset conversation history (admin only) |
| `/tldr` | Get a DM summary of what you missed |
| `/stats` | Show top token consumers |

### Summarization

| Command | Description |
|---------|-------------|
| `/summarize` | Summarize an article from a URL |
| `/resummarize` | Force re-summarize (bypass cache) |

### Media Generation

| Command | Description |
|---------|-------------|
| `/imagine` | Generate an image from text (Google Gemini) |
| `/videogen` | Generate a video from text/images (Google Veo) |
| `/musicgen` | Generate music (Google Lyria 3 Pro) |
| `/elevenmusic` | Generate music (ElevenLabs `music_v1`, parallel to `/musicgen`) |

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

You can **reply directly to bot messages** to continue conversations - no slash command needed! The bot detects when you're replying to one of its messages and continues the conversation context automatically.

### Chat Threads

Use `/chatthread` to create a dedicated thread for extended conversations. In the thread, just type your messages normally - no commands required.

## Command Parameters

### `/chat`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `message` | Yes | Your message |
| `image` | No | Optional image attachment |

### `/tldr`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `days` | No | Number of days to look back (default: auto-detect from last activity) |

### `/stats`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `days` | No | Number of days to look back (default: today) |

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

### `/musicgen`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | Description of the music (≤6000 chars) |
| `lyrics` | No | Custom lyrics; supports `[Verse]` / `[Chorus]` / `[Bridge]` tags (≤6000) |
| `negative_prompt` | No | Things to avoid (e.g. "no vocals"). Composed into the prompt text since Lyria has no structured negative_prompt API field. (≤6000) |
| `image1` / `image2` / `image3` | No | Up to 3 reference images for visual inspiration (PNG / JPEG / GIF / WebP, ≤10MB each) |

### `/elevenmusic`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | Description of the music (≤6000 chars) |
| `duration` | No | Seconds, 3–600 (default 90) |
| `instrumental` | No | Force instrumental output. Silently ignored when `lyrics` is provided (lyrics imply vocals). |
| `lyrics` | No | Triggers ElevenLabs' `composition_plan` mode under the hood (the only API path that accepts lyrics). |

### `/videogen`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | Yes | Description of the video |
| `duration` | No | 4, 6, or 8 seconds (default 8) |
| `ratio` | No | 16:9 (landscape) or 9:16 (portrait) |
| `first_frame` | No | Starting frame image |
| `last_frame` | No | Ending frame image (for first/last-frame morphing) |

### `/recall`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Search terms |
| `summarize` | No | Get a voice-styled narrative summary instead of raw logs |
| `my_messages` | No | Only show your messages |
| `year` | No | Filter by year (1999-2024) |

## Troubleshooting

### Commands not appearing

1. Ensure `DISCORD_CLIENT_ID` is set correctly
2. Run `npm run register:commands`
3. Wait up to 1 hour for global commands to propagate
4. For faster testing, set `DISCORD_TEST_GUILD_ID`
5. CTRL-R in Discord client forces a refresh
