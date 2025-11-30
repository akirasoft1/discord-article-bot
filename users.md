# How to Use the Discord Article Bot

This guide explains how to interact with the bot to summarize articles and chat with AI personalities.

## Getting Help

- **Command**: `!help [command]`
- **Aliases**: `!h`, `!commands`
- **Description**: Shows all available commands or detailed help for a specific command.
- **Examples**:
  - `!help` - Shows all commands
  - `!help summarize` - Shows help for the summarize command
  - `!help chat` - Shows help for the chat command

---

## Article Summarization

### Reaction-Based Summarization

React to any message containing an article URL with the 📰 (newspaper) emoji. The bot will reply with a summary including:
- Reading time estimate
- Topic detection
- Sentiment analysis
- Source credibility rating

### Command-Based Summarization

**Command**: `!summarize <url>`
**Aliases**: `!sum`

Summarizes the article at the given URL.

**Examples**:
```
!summarize https://example.com/article
!sum https://example.com/article
```

### Force Re-summarization

**Command**: `!resummarize <url>`
**Aliases**: `!resum`

Bypasses duplicate detection to get a fresh summary of an article that was previously shared.

**Example**:
```
!resummarize https://example.com/article
```

---

## Personality Chat

Chat with unique AI personalities for fun, creative conversations!

### List Available Personalities

**Command**: `!personalities`
**Aliases**: `!chars`, `!characters`

Shows all available personalities with their descriptions.

### Chat with a Personality

**Command**: `!chat <personality-id> <message>`
**Aliases**: `!c`, `!talk`

Have a conversation with a specific personality.

**Examples**:
```
!chat noir-detective What do you think about modern technology?
!c grumpy-historian Tell me about the internet
!talk sports-bro How's the weather today?
```

### Available Personalities

| ID | Name | Description |
|----|------|-------------|
| `grumpy-historian` | 📚 Professor Grimsworth | An irritable history professor who relates everything to obscure historical events and sighs about how "we've seen this before" |
| `noir-detective` | 🕵️ Jack Shadows | A hardboiled 1940s detective who narrates everything in classic noir prose |
| `sports-bro` | 🏈 Chad McCommentary | An enthusiastic sports commentator who treats all topics like live game coverage |
| `existential` | 🤔 Erik the Existentialist | A philosophy grad student who spirals every topic into questions about existence and meaning |
| `medieval-herald` | 📯 Bartholomew the Bold | A medieval town crier who announces everything as royal proclamations |

---

## Follow-up Tracker

React to a bot's summary message with the 📚 (books) emoji to mark that article for follow-up. You'll receive a notification if new related articles are summarized.

---

## Tips

- The bot's command prefix is `!` (configurable by server admin)
- Use `!help` to see all available commands
- Many commands have shorter aliases (e.g., `!sum` instead of `!summarize`)
- If the bot detects a questionable source, it will add a ⚠️ warning
- Personalities maintain their character throughout conversations - try asking them about different topics!

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `!help` | Show all commands |
| `!sum <url>` | Summarize an article |
| `!resum <url>` | Re-summarize (bypass duplicate check) |
| `!personalities` | List chat personalities |
| `!chat <id> <msg>` | Chat with a personality |
