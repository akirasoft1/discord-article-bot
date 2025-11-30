# Discord Article Bot - Features

## Implemented Features

### Core Summarization
- **Reaction-based Summarization**: React with 📰 to trigger summarization
- **Command-based Summarization**: `!summarize <url>` and `!resummarize <url>`
- **Duplicate Detection**: Notifies if article was previously shared
- **Force Re-summarization**: Bypass duplicate check with `!resummarize`

### Content Analysis
- **Topic Detection**: Automatically tags articles with topics
- **Sentiment Analysis**: Emoji reactions based on article mood
- **Reading Time Estimator**: Calculates estimated reading time
- **Source Credibility**: Star ratings for known sources

### Linkwarden Integration
- **Self-hosted Archiving**: Archive articles via Linkwarden
- **Paywall Bypass**: Browser extension captures authenticated content
- **Automatic Polling**: Monitors collection for new links
- **Multiple Formats**: Supports readable, monolith, and PDF archives

### Personality Chat
- **5 Built-in Personalities**:
  - Professor Grimsworth (grumpy historian)
  - Jack Shadows (noir detective)
  - Chad McCommentary (sports bro)
  - Erik the Existentialist (philosopher)
  - Bartholomew the Bold (medieval herald)
- **Extensible System**: Add new personalities via `.js` files
- **Per-user Token Tracking**: Usage recorded per personality

### Conversation Memory
- **Channel-Scoped Memory**: All users in a channel share a conversation with each personality
- **Multi-User Awareness**: Personalities know who said what (`[Username]: message` format)
- **Conversation Limits**:
  - Maximum 100 messages per conversation
  - Maximum 150,000 tokens per conversation
  - 30-minute idle timeout
- **Resume Capability**: `!chatresume` to continue expired conversations
- **Admin Reset**: `!chatreset` for "bot admin" role to clear conversations

### Monitoring & Observability
- **OpenTelemetry Tracing**: Distributed tracing for Dynatrace
- **Token Usage Tracking**: Per-user consumption in MongoDB
- **Cost Tracking**: Real-time token and cost breakdown

### Additional Features
- **RSS Feed Monitoring**: Auto-post from configured feeds
- **Follow-up Tracker**: Mark stories for updates (📚 reaction)
- **Related Articles**: Suggests similar previously shared articles

---

## Planned Features

### Memory & Context
- [x] Conversation memory for personality chats
- [ ] User preference persistence

### Enhanced Personalities
- [ ] More personality archetypes
- [ ] Custom personality creation via commands

### Analytics
- [ ] Token usage leaderboards
- [ ] Server-wide usage statistics
