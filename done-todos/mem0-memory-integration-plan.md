# Mem0 Memory Integration Plan

## Problem Statement

Users are frustrated with the bot's lack of or inconsistent memory:
- Conversations reset unexpectedly (30-min idle timeout, 100 message limit)
- Bot doesn't remember user preferences across conversations
- No long-term context ("we talked about this last week")
- No cross-channel memory ("you told me in #general that...")

## Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Discord Bot                          │
│                                                          │
│  ChatService ──────────────▶ MongoService                │
│                              │                           │
│                              ▼                           │
│                         MongoDB                          │
│                    (chat_conversations)                  │
│                                                          │
│  Current limitations:                                    │
│  - 100 message limit per conversation                    │
│  - 150K token limit                                      │
│  - 30 min idle timeout                                   │
│  - Channel+Personality scoped (no cross-channel memory)  │
│  - No semantic retrieval (just chronological history)    │
│  - No entity/fact extraction                             │
└─────────────────────────────────────────────────────────┘
```

## Why Mem0?

**Zep Community Edition is deprecated** (moved to legacy folder, recommends Zep Cloud).

**Mem0 is actively maintained:**
- Apache 2.0 license
- 37K+ GitHub stars
- Self-hosted with Docker/K8s support
- Hybrid storage (vector + graph + key-value)
- Works with OpenAI, Gemini, Anthropic, or local models

**Key capabilities:**
1. **Automatic memory extraction** - Extracts facts/preferences from conversations
2. **Semantic retrieval** - Find relevant memories by meaning, not keywords
3. **Scoped memory** - user_id, agent_id, session_id organization
4. **Graph relationships** - Track entity relationships (optional Neo4j)
5. **Memory lifecycle** - Add, update, delete memories over time

## Proposed Architecture

**Important:** Mem0 is an SDK (npm package `mem0ai`), NOT a separate server.
The SDK runs inside the Discord bot and connects directly to storage backends.

```
┌──────────────────────────────────────────────────────────────────┐
│                         Discord Bot                               │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    mem0ai SDK (npm package)                 │  │
│  │                                                             │  │
│  │  ChatService ───┬────────────────▶ MongoService             │  │
│  │                 │                  (session transcripts)    │  │
│  │                 │                                           │  │
│  │                 └────────────────▶ Mem0Service (NEW)        │  │
│  │                                    (uses mem0ai SDK)        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                    │                              │
│                    ┌───────────────┴───────────────┐              │
│                    ▼                               ▼              │
│              ┌──────────┐                    ┌───────────┐        │
│              │ Postgres │                    │  Qdrant   │        │
│              │ pgvector │                    │ (vectors) │        │
│              │ (history)│                    │           │        │
│              └──────────┘                    └───────────┘        │
│                                                                   │
│  Memory scopes:                                                   │
│  - user_id: Discord user ID (cross-channel, persistent)          │
│  - agent_id: Personality ID (personality-specific memories)       │
│  - run_id: Channel+Session (current conversation context)         │
└──────────────────────────────────────────────────────────────────┘
```

**Infrastructure Deployed (K8s):**
- Qdrant: `qdrant.discord-article-bot.svc.cluster.local:6333`
- PostgreSQL: `postgres-mem0.discord-article-bot.svc.cluster.local:5432`

## Memory Flow

### 1. User Sends Message

```
User: "I prefer dark mode and use vim btw"
         │
         ▼
┌─────────────────────────────────────────────┐
│ ChatService                                  │
│                                              │
│ 1. Retrieve relevant memories for user       │
│    mem0.search(user_id, query=message)       │
│                                              │
│ 2. Build context with memories               │
│    [system prompt]                           │
│    [relevant memories as context]            │
│    [recent conversation history]             │
│    [user message]                            │
│                                              │
│ 3. Generate response                         │
│                                              │
│ 4. Store conversation in Mem0               │
│    mem0.add(messages, user_id, metadata)     │
│    - Auto-extracts: "prefers dark mode"     │
│    - Auto-extracts: "uses vim editor"       │
└─────────────────────────────────────────────┘
```

### 2. Later Conversation (Different Channel)

```
User: "What editor do you think I should use?"
         │
         ▼
┌─────────────────────────────────────────────┐
│ Mem0 retrieves relevant memories:            │
│                                              │
│ - "User prefers vim editor" (confidence: 0.9)│
│ - "User prefers dark mode" (confidence: 0.8) │
│                                              │
│ Bot response includes this context:          │
│ "Since you mentioned you use vim, you might  │
│  want to check out neovim with..."           │
└─────────────────────────────────────────────┘
```

## Mem0 Deployment (K8s)

### Option 1: Docker Compose (Dev/Testing)

```yaml
# docker-compose.yml
services:
  mem0:
    image: mem0ai/mem0:latest
    ports:
      - "8000:8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      # Or use Gemini:
      # - GOOGLE_API_KEY=${GEMINI_API_KEY}
    volumes:
      - mem0_data:/app/data
    depends_on:
      - postgres
      - qdrant

  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_PASSWORD: mem0password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  qdrant:
    image: qdrant/qdrant:latest
    volumes:
      - qdrant_data:/qdrant/storage

  # Optional: Graph memory
  neo4j:
    image: neo4j:5
    environment:
      NEO4J_AUTH: neo4j/mem0password
    volumes:
      - neo4j_data:/data
```

### Option 2: K8s Manifests

```yaml
# mem0-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mem0
  namespace: discord-article-bot
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mem0
  template:
    spec:
      containers:
        - name: mem0
          image: mem0ai/mem0:latest
          ports:
            - containerPort: 8000
          env:
            - name: OPENAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: discord-article-bot-secrets
                  key: OPENAI_API_KEY
          # Add Postgres, Qdrant connection configs
---
# Need: postgres-deployment.yaml, qdrant-deployment.yaml
# Or use existing MongoDB + add pgvector extension
```

## Mem0 Configuration

```python
# mem0_config.py
config = {
    "llm": {
        "provider": "openai",  # or "google" for Gemini
        "config": {
            "model": "gpt-4.1-nano",  # Cheap model for memory extraction
            "temperature": 0.1,
        }
    },
    "embedder": {
        "provider": "openai",
        "config": {
            "model": "text-embedding-3-small"
        }
    },
    "vector_store": {
        "provider": "qdrant",
        "config": {
            "host": "qdrant.discord-article-bot.svc.cluster.local",
            "port": 6333,
            "collection_name": "discord_memories"
        }
    },
    "graph_store": {  # Optional but powerful
        "provider": "neo4j",
        "config": {
            "url": "bolt://neo4j.discord-article-bot.svc.cluster.local:7687",
            "username": "neo4j",
            "password": "mem0password"
        }
    },
    "version": "v1.1"
}
```

## Bot Integration

### New: Mem0Service

```javascript
// services/Mem0Service.js
const axios = require('axios');
const logger = require('../logger');

class Mem0Service {
  constructor(config) {
    this.baseUrl = config.mem0.url || 'http://mem0.discord-article-bot.svc.cluster.local:8000';
    this.client = axios.create({ baseURL: this.baseUrl });
  }

  /**
   * Add memories from a conversation
   * @param {string} userId - Discord user ID
   * @param {Array} messages - Conversation messages
   * @param {Object} metadata - Additional context
   */
  async addMemories(userId, messages, metadata = {}) {
    const response = await this.client.post('/v1/memories/', {
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      user_id: userId,
      agent_id: metadata.personalityId,
      run_id: metadata.channelId,
      metadata: {
        channel_name: metadata.channelName,
        guild_id: metadata.guildId,
        timestamp: new Date().toISOString()
      }
    });
    return response.data;
  }

  /**
   * Search for relevant memories
   * @param {string} userId - Discord user ID
   * @param {string} query - Search query (current message/topic)
   * @param {number} limit - Max memories to return
   */
  async searchMemories(userId, query, limit = 5) {
    const response = await this.client.post('/v1/memories/search/', {
      query,
      user_id: userId,
      limit
    });
    return response.data.results;
  }

  /**
   * Get all memories for a user
   */
  async getUserMemories(userId) {
    const response = await this.client.get(`/v1/memories/`, {
      params: { user_id: userId }
    });
    return response.data;
  }

  /**
   * Delete a specific memory
   */
  async deleteMemory(memoryId) {
    await this.client.delete(`/v1/memories/${memoryId}/`);
  }

  /**
   * Format memories for injection into system prompt
   */
  formatMemoriesForContext(memories) {
    if (!memories || memories.length === 0) return '';

    const memoryText = memories
      .map(m => `- ${m.memory}`)
      .join('\n');

    return `\n\nRelevant things you remember about this user:\n${memoryText}\n`;
  }
}

module.exports = Mem0Service;
```

### Modified: ChatService

```javascript
// ChatService.js changes

class ChatService {
  constructor(openaiClient, config, mongoService, mem0Service) {
    this.openaiClient = openaiClient;
    this.config = config;
    this.mongoService = mongoService;
    this.mem0Service = mem0Service;  // NEW
  }

  async chat(message, channelId, personalityId, userId, username) {
    // 1. Get relevant memories for this user
    const memories = await this.mem0Service.searchMemories(
      userId,
      message,
      5  // top 5 relevant memories
    );

    // 2. Build enhanced system prompt with memories
    const personality = personalityManager.get(personalityId);
    let systemPrompt = personality.systemPrompt;

    if (memories.length > 0) {
      systemPrompt += this.mem0Service.formatMemoriesForContext(memories);
    }

    // 3. Get recent conversation history (MongoDB - short term)
    const history = await this.mongoService.getConversationHistory(channelId, personalityId);

    // 4. Generate response
    const response = await this._generateResponse(systemPrompt, history, message);

    // 5. Store in MongoDB (transcript) AND Mem0 (memory extraction)
    await this.mongoService.addMessageToConversation(...);

    // 6. Let Mem0 extract memories from this exchange
    await this.mem0Service.addMemories(userId, [
      { role: 'user', content: message },
      { role: 'assistant', content: response }
    ], {
      personalityId,
      channelId,
      channelName: message.channel?.name
    });

    return response;
  }
}
```

## New Bot Commands

```javascript
// Memory management commands

!memories              // Show your stored memories
!forget <memory_id>    // Delete a specific memory
!forgetme              // Delete ALL your memories (GDPR)
!remember <fact>       // Manually add a memory
```

## What Users Will Experience

### Before (Current)
```
User: I told you yesterday I'm a Python developer
Bot: I don't have any context about that. What would you like to discuss?
```

### After (With Mem0)
```
User: I told you yesterday I'm a Python developer
Bot: Right! You mentioned you work with Python. Are you looking for
     help with a Python project today?
```

### Cross-Channel Memory
```
# In #general
User: I'm working on a Kubernetes project

# Later in #help
User: Any tips for my project?
Bot: For your Kubernetes project, you might want to look at...
```

### Personality-Aware Memory
```
# Talking to "Clair" personality
Clair: I remember you prefer technical explanations without
       too much hand-holding. Let me give you the direct answer...
```

## Implementation Phases

### Phase 1: Infrastructure (2-3 hours)
- [ ] Deploy Qdrant to K8s (can reuse for IRC logs later!)
- [ ] Deploy PostgreSQL with pgvector (or add to existing)
- [ ] Deploy Mem0 API server
- [ ] Test basic add/search operations

### Phase 2: Mem0Service (2-3 hours)
- [ ] Create Mem0Service class
- [ ] Implement add/search/delete methods
- [ ] Add error handling and retries
- [ ] Unit tests

### Phase 3: ChatService Integration (3-4 hours)
- [ ] Inject Mem0Service into ChatService
- [ ] Modify chat flow to retrieve memories
- [ ] Modify chat flow to store memories
- [ ] Test memory retrieval in responses

### Phase 4: User Commands (2-3 hours)
- [ ] Implement !memories command
- [ ] Implement !forget command
- [ ] Implement !forgetme command
- [ ] Implement !remember command

### Phase 5: Testing & Tuning (2-3 hours)
- [ ] Test with real conversations
- [ ] Tune memory extraction (too aggressive? too passive?)
- [ ] Tune retrieval relevance
- [ ] Monitor token usage (memory extraction uses LLM)

### Phase 6: MongoDB Migration Strategy (1-2 hours)
- [ ] Keep MongoDB for session transcripts (audit trail)
- [ ] Mem0 for semantic memory (what to remember)
- [ ] Document dual-storage approach

## Cost Considerations

**Mem0 memory extraction uses an LLM:**
- Default: gpt-4.1-nano (very cheap)
- Can use Gemini Flash for even lower cost
- Estimated: ~$0.01-0.05 per conversation

**Embeddings:**
- text-embedding-3-small: $0.02/1M tokens
- Minimal cost for typical usage

**Infrastructure:**
- Qdrant: ~256MB-1GB RAM
- PostgreSQL: ~256MB-512MB RAM
- Mem0 API: ~256MB RAM
- Neo4j (optional): ~512MB-1GB RAM

## Graph Memory (Optional but Powerful)

With Neo4j enabled, Mem0 can track relationships:

```
(User:akirasoft) -[PREFERS]-> (Editor:vim)
(User:akirasoft) -[WORKS_WITH]-> (Language:Python)
(User:akirasoft) -[INTERESTED_IN]-> (Topic:Kubernetes)
(User:akirasoft) -[KNOWS]-> (User:odyssey)
```

This enables queries like:
- "What topics has this user discussed?"
- "Who does this user know?"
- "What are their technology preferences?"

## Privacy Considerations

1. **User consent** - Users should know memories are stored
2. **!forgetme command** - GDPR-style complete deletion
3. **Memory visibility** - Users can see what's stored about them
4. **Retention policy** - Consider auto-expiring old memories
5. **No sensitive data** - Don't store passwords, tokens, PII

## Success Metrics

1. **User satisfaction** - Fewer complaints about "forgetting"
2. **Context accuracy** - Bot correctly references past discussions
3. **Cross-session continuity** - Users feel "known" by the bot
4. **Memory relevance** - Retrieved memories are actually useful

## Open Questions

1. Should memories be personality-specific or global?
2. How long to retain memories? Forever? 1 year? Configurable?
3. Should users be able to share memories with other users?
4. How to handle conflicting memories (user changed preference)?

---

## Resources

- [Mem0 GitHub](https://github.com/mem0ai/mem0)
- [Mem0 Open Source Docs](https://docs.mem0.ai/open-source/overview)
- [Mem0 API Reference](https://docs.mem0.ai/api-reference)

---

*Created: 2024-12-13*
*Status: Planning*
*Priority: HIGH (users frustrated with memory)*
