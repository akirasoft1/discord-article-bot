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
  - Friendly Assistant (helpful, informal - **default**)
  - Professor Grimsworth (grumpy historian)
  - Jack Shadows (noir detective)
  - Erik the Existentialist (philosopher)
  - x0r_kid (90s IRC gamer)
- **Default Personality**: Just `!chat <message>` defaults to Friendly Assistant
- **Image Vision**: Attach images to chat messages for analysis and discussion
- **Web Search**: Bot can search the web for current information when needed
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
- **List Conversations**: `!chatlist` to see your resumable conversations
- **Admin Reset**: `!chatreset` for "bot admin" role to clear conversations

### AI Memory (Mem0)
- **Long-Term Memory**: Bot remembers facts and preferences about users across conversations
- **Automatic Extraction**: Mem0 extracts relevant facts from conversations using GPT-4o-mini
- **Semantic Search**: Relevant memories retrieved via vector similarity search
- **Per-User Memories**: Each Discord user has their own memory store
- **Shared Channel Memories**: Channel-wide facts visible to ALL users in that channel
- **3-Way Memory Search**: Parallel retrieval of personality, explicit, and shared channel memories
- **Personality-Scoped**: Memories can be filtered by personality for relevant context
- **Graceful Degradation**: Bot works normally if memory service (Qdrant) is unavailable
- **GDPR Compliance**: Users can request deletion of all their memories

### Multiplayer Chat
- **Participant Awareness**: Bot tracks who's active in each channel (30-minute window)
- **Multi-User Context**: System prompt includes list of active participants and their recent topics
- **@Mention Entry**: Mention the bot (`@BotName`) to start a conversation with default personality
- **Seamless Replies**: Reply to any bot message to continue the conversation naturally
- **Shared Context**: All users in a channel see the same conversation history per personality

### Image Generation (Nano Banana)
- **AI Image Generation**: Generate images from text prompts using Google's Gemini API
- **Reference Image Support**: Use existing images or Discord emojis as reference
- **Aspect Ratio Support**: 10 supported ratios (1:1, 16:9, 9:16, etc.)
- **Per-User Cooldowns**: Configurable cooldown to prevent abuse
- **Usage Tracking**: All generations tracked in MongoDB
- **Safety Filters**: Relies on Gemini's built-in content safety
- **Intelligent Retry**: When generation fails, AI analyzes the prompt and suggests alternatives
- **Interactive Approval**: React with 1️⃣ 2️⃣ 3️⃣ to retry with suggested prompts, ❌ to dismiss
- **Failure Analysis**: Detailed analysis of why prompts fail (safety, rate limits, etc.)
- **Learning Loop**: Retry attempts tracked in MongoDB to improve future suggestions

### Video Generation (Veo)
- **AI Video Generation**: Generate videos using Google's Veo 3.1
- **Text-to-Video Mode**: Generate video from text descriptions alone
- **Single Image Mode**: Animate a single image into a video (image-to-video)
- **Two Image Mode**: Provide first and last frame images for smooth transitions
- **Duration Options**: 4, 6, or 8 second videos
- **Aspect Ratios**: 16:9 (landscape) or 9:16 (portrait)
- **Discord Emoji Support**: Use Discord emojis as source images
- **Progress Updates**: Real-time status updates during generation
- **Usage Tracking**: All generations tracked in MongoDB

### Monitoring & Observability
- **OpenTelemetry Tracing**: Distributed tracing for Dynatrace
- **Token Usage Tracking**: Per-user consumption in MongoDB
- **Cost Tracking**: Real-time token and cost breakdown

### Additional Features
- **Reply to Continue**: Reply directly to bot messages to continue conversations naturally
- **Article Follow-up Questions**: Reply to summaries to ask follow-up questions about the article
- **RSS Feed Monitoring**: Auto-post from configured feeds
- **Follow-up Tracker**: Mark stories for updates (📚 reaction)
- **Related Articles**: Suggests similar previously shared articles

---

## Planned Features

### Memory & Context
- [x] Conversation memory for personality chats
- [x] Reply to bot messages to continue conversations
- [x] User preference persistence (Mem0 long-term memory)

### Enhanced Personalities
- [x] Default personality for quick chat
- [ ] More personality archetypes
- [ ] Custom personality creation via commands

### Media Generation
- [x] Image generation via Gemini
- [x] Video generation via Veo
- [ ] Audio generation

### Analytics
- [ ] Token usage leaderboards
- [ ] Server-wide usage statistics
