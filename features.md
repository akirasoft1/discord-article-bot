# Discord Article Bot - Features

## Implemented Features

### Core Summarization
- **Reaction-based Summarization**: React with 📰 to trigger summarization
- **Command-based Summarization**: `/summarize <url>` and `/resummarize <url>`
- **Duplicate Detection**: Notifies if article was previously shared
- **Force Re-summarization**: Bypass duplicate check with `/resummarize`

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

### Chat
- **Channel Voice**: Bot uses a learned group communication style as its voice, dynamically generated from IRC history and Discord messages
- **Simple Interface**: Just `/chat <message>` — no personality picker needed
- **Prompt Display**: Responses show the user's original prompt before the AI reply
- **Image Vision**: Attach images to chat messages for analysis and discussion
- **Web Search**: Bot can search the web for current information when needed
- **Per-user Token Tracking**: Usage recorded per user
- **Catch Me Up**: `/tldr` sends a DM summarizing what happened while you were away — articles, trends, and chat highlights from channels you've been active in, styled in the group's voice

### Conversation Memory
- **Channel-Scoped Memory**: All users in a channel share a conversation with each personality
- **Multi-User Awareness**: Personalities know who said what (`[Username]: message` format)
- **Conversation Limits**:
  - Maximum 100 messages per conversation
  - Maximum 150,000 tokens per conversation
  - 30-minute idle timeout
- **Resume Capability**: `/chatresume` to continue expired conversations
- **List Conversations**: `/chatlist` to see your resumable conversations
- **Admin Reset**: `/chatreset` for "bot admin" role to clear conversations

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
- **Admin Premium Model**: Bot admins (`BOT_ADMIN_USER_IDS`) automatically use a premium model (`IMAGEGEN_ADMIN_MODEL`) for higher quality generation
- **Reference Image Support**: Use existing images or Discord emojis as reference
- **Aspect Ratio Support**: 10 supported ratios (1:1, 16:9, 9:16, etc.)
- **Per-User Cooldowns**: Configurable cooldown to prevent abuse
- **Usage Tracking**: All generations tracked in MongoDB (including which model was used)
- **Safety Filters**: Relies on Gemini's built-in content safety with detailed logging of FinishReason (SAFETY, IMAGE_SAFETY, IMAGE_PROHIBITED_CONTENT), BlockedReason, blockReasonMessage, and safety ratings
- **Auto-Retry**: When generation fails (non-safety), AI automatically retries with a simplified prompt before falling back to interactive suggestions
- **Interactive Fallback**: If auto-retry also fails, react with 1️⃣ 2️⃣ 3️⃣ to retry with suggested prompts, ❌ to dismiss
- **Failure Analysis**: Detailed analysis of why prompts fail (safety, rate limits, etc.)
- **Learning Loop**: Retry attempts tracked in MongoDB to improve future suggestions
- **Reply to Regenerate**: Reply to a generated image with feedback to create an enhanced version (aspect ratio directives are stripped to prevent conflicts with the image generation API)

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

### Channel Context Tracking
- **Passive Recording**: Opt-in per-channel message tracking (non-blocking)
- **3-Tier Architecture**: Hot (recent messages in memory), warm (batch-indexed to Qdrant), cold (Mem0 memory extraction)
- **Semantic Search**: Vector-based search through channel conversation history
- **Context Injection**: Channel context automatically injected into personality chat system prompts
- **Admin Controls**: `/channeltrack` command for enabling/disabling per channel
- **Configurable Retention**: Adjustable retention period and batch indexing interval
- **Startup Cleanup**: Expired messages purged from Qdrant on bot startup (prevents accumulation across pod restarts)

### Voice Profile (Channel Voice Personality)
- **Dynamic Style Learning**: Analyzes IRC history (378k+ conversations) and Discord messages to build a communication style profile
- **Stratified Sampling**: Samples across decades to capture style evolution
- **Two-Phase LLM Analysis**: Batch analysis of conversation chunks, then synthesis into unified voice profile
- **Few-Shot Examples**: Injects topically relevant real conversation snippets into prompts for style grounding
- **Periodic Regeneration**: Profile regenerated every 24h (configurable)
- **A/B Logging**: Optional side-by-side comparison logging of styled vs. unstyled responses
- **Default Personality**: Channel Voice becomes the default when enabled, cascading to Uncensored then Friendly

### Agentic Sandbox (channel-voice + run_in_sandbox)
- **ADK Agent Sidecar**: Channel-voice chats route through a Python sidecar that wraps a `google-adk` Agent. The agent has one tool (`run_in_sandbox`) for autonomous code execution.
- **Ephemeral gVisor Pods**: Each `run_in_sandbox` call spawns a fresh K8s Job under the `gvisor` RuntimeClass — 2 vCPU, 2 Gi RAM, 256 Mi tmpfs, 300 s wall-clock.
- **Multi-language**: Sandbox base image ships python, node, dotnet, go, rust, ollama plus common build/network tools.
- **Egress Policy**: Public internet open; RFC1918, link-local, CGNAT, cluster pod/service CIDRs and the K8s API are denied at the NetworkPolicy layer. Optional Calico flow-log scraping records denied egress events on each trace.
- **Concurrency Caps**: 2 simultaneous executions per user, 15 cluster-wide; over-limit calls return immediately with a typed reason.
- **Per-Turn Tool Budget**: Configurable cap on `run_in_sandbox` calls per agent turn (default 8) so a single message cannot loop infinitely.
- **Reaction Reveal**: React to a bot reply with 🔍 / 📜 / 🐛 to attach the source code, stdout (+stderr if non-empty), or stderr-only of the latest sandbox call.
- **Trace Storage**: Every execution lands in MongoDB `sandbox_executions` with full code/stdout/stderr/egress events. Retention loop demotes traces older than the most recent N per user (default 50) to a thin audit-only form.
- **Graceful Fallback**: When the sidecar is unhealthy or `AGENT_ENABLED=false`, the bot transparently uses the existing direct-OpenAI path. No restart needed to flip.

### Monitoring & Observability
- **OpenTelemetry Tracing**: Distributed tracing for Dynatrace
- **OpenLLMetry Integration**: Captures full LLM request/response content in traces via `gen_ai.*` attributes
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
