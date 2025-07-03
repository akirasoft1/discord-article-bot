# How to Use the Discord Article Bot

This document explains how Discord users can interact with the bot to summarize articles and utilize its various features.

## Core Interaction: Summarizing Articles

The primary way to get a summary is by reacting to a message containing a URL or by using the `!summarize` command.

### 1. Reaction-Based Summarization

- **Action**: React to any message containing an article URL with the 📰 (newspaper) emoji.
- **Bot Response**: The bot will process the URL and reply in the same channel with a summary and additional information (reading time, topic, sentiment, etc.).

### 2. Command-Based Summarization

- **Command**: `!summarize <url> [style]`
- **Description**: Summarizes the article at the given URL. Optionally, you can specify a `style` to change the summary's tone.
- **Examples**:
    - `!summarize https://example.com/article`
    - `!summarize https://example.com/article pirate` (for a pirate-themed summary)
    - `!summarize https://example.com/article academic` (for a formal summary)
- **Available Styles**: `pirate`, `shakespeare`, `genz`, `academic`

### Article Polls

- **Command**: `!poll <url>`
- **Description**: Generates a yes/no poll question based on the article summary.
- **Example**: `!poll https://example.com/article`

### Discussion Questions

- **Command**: `!discussion_questions <url>`
- **Description**: Generates thought-provoking discussion questions based on the article summary.
- **Example**: `!discussion_questions https://example.com/article`

## Enhanced Summarization Commands

These commands allow you to request summaries with specific moods, narrators, or historical perspectives.

### Mood-Based Summaries

- **Command**: `!mood_summarize <url> [mood]`
- **Description**: Summarizes the article with a specific mood.
- **Examples**:
    - `!mood_summarize https://example.com/article cheerful`
    - `!mood_summarize https://example.com/article serious`
- **Available Moods**: `monday` (serious), `friday` (cheerful), `neutral`

### Celebrity Narrator Summaries

- **Command**: `!narrate_summarize <url> [narrator]`
- **Description**: Summarizes the article as if narrated by a chosen celebrity.
- **Examples**:
    - `!narrate_summarize https://example.com/article gordon_ramsay`
    - `!narrate_summarize https://example.com/article morgan_freeman`
- **Available Narrators**: `gordon_ramsay`, `shakespeare`, `morgan_freeman`

### Historical Perspective Summaries

- **Command**: `!historical_summarize <url> [perspective]`
- **Description**: Summarizes the article from a specific historical viewpoint.
- **Examples**:
    - `!historical_summarize https://example.com/article 1950s`
    - `!historical_summarize https://example.com/article victorian`
- **Available Perspectives**: `1950s`, `victorian`, `ancient_rome`

### Alternative Perspective Summaries

- **Command**: `!perspective_summarize <url> <perspective>`
- **Description**: Generates a summary of the article from a specific alternative viewpoint.
- **Examples**:
    - `!perspective_summarize https://example.com/article liberal`
    - `!perspective_summarize https://example.com/article conservative`
- **Available Perspectives**: `liberal`, `conservative`, `environmentalist`, `economic`

### Language Learning Summaries

- **Command**: `!learn_language <url> <language1> [language2...]`
- **Description**: Generates summaries in multiple specified languages for language practice.
- **Examples**:
    - `!learn_language https://example.com/article Spanish`
    - `!learn_language https://example.com/article French German`
- **Available Languages**: (Configurable, but typically includes `English`, `Spanish`, `French`, `German`, `Italian`, `Portuguese`)

### Cultural Context Summaries

- **Command**: `!cultural_summarize <url> <context>`
- **Description**: Generates a summary with a specific cultural context.
- **Examples**:
    - `!cultural_summarize https://example.com/article japanese`
    - `!cultural_summarize https://example.com/article indian`
- **Available Contexts**: `japanese`, `indian`, `western`

## Subscription and Analytics Commands

These commands help you manage your personalized news experience and view server-wide trends.

### Subscribe to Topics

- **Command**: `!subscribe <topic>`
- **Description**: Subscribes you to a specific news topic. You will receive direct messages from the bot when new articles on this topic are found via RSS feeds.
- **Example**: `!subscribe Technology`

### Unsubscribe from Topics

- **Command**: `!unsubscribe <topic>`
- **Description**: Unsubscribes you from a specific news topic.
- **Example**: `!unsubscribe Politics`

### View Your Subscriptions

- **Command**: `!my_subscriptions`
- **Description**: Shows a list of all topics you are currently subscribed to.

### View Server News Trends

- **Command**: `!news_trends`
- **Description**: Displays the top 5 most frequently discussed topics in the server over the last 7 days.

### View Your Reading Habits

- **Command**: `!my_reading_habits`
- **Description**: Shows how many summaries you've read in the last 30 days.

### View Popular Sources

- **Command**: `!popular_sources`
- **Description**: Displays the top 5 most frequently shared news sources in the server over the last 30 days.

### View Controversy Meter

- **Command**: `!controversy_meter`
- **Description**: Shows articles that have generated the most reactions (indicating potential controversy) in the last 7 days.

## Follow-up Tracker

- **Action**: React to a bot's summary message with the 📚 (books) emoji.
- **Bot Response**: The bot will mark that article for follow-up. If a new article related to the same topic is summarized later, you will receive a direct message notification from the bot.

## General Notes

- The bot's prefix for commands is `!` (this can be configured by the server administrator).
- If the bot detects a questionable source, it will react with a ⚠️ emoji.
- All summaries are sanitized to remove direct URLs to prevent Discord's auto-embedding.
