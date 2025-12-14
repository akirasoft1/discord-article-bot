# IRC Log Vector DB Ingestion Pipeline

## Overview

Plan to ingest 20 years of IRC logs into a vector database for semantic search and contextual memory in the Discord bot.

**Stats:**
- 911 log files
- ~600MB total
- Date range: ~2001-2024 (estimated)
- Format: mIRC log format

## Log Format Analysis

```
Session Start: Mon Dec 16 21:05:27 2002
Session Ident: odyssey (flex@adsl-207-214-211-74.dialup.snfc21.pacbell.net)
[21:05] [odyssey] did u say sure to me?
[21:05] (Akira1) yes
[21:06] [odyssey] cool... can i dcc u a file then?
Session Close: Mon Dec 16 22:00:00 2002
```

**Key patterns:**
- `Session Start/Close` - conversation boundaries
- `[HH:MM] [nick]` - other users' messages
- `[HH:MM] (nick)` - your messages (Akira1, Akira1_, etc.)
- `Session Ident: nick (user@host)` - user identity info
- Various mIRC control codes for formatting, whois, etc.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Discord Bot                            │
├──────────────┬──────────────────┬───────────────────────────┤
│     Zep      │   Vector DB      │      Vector DB            │
│  (optional)  │   (Articles)     │    (IRC History)          │
│              │                  │                           │
│  Live chat   │  Linkwarden      │  20 years of IRC          │
│  memory      │  archives        │  conversations            │
└──────────────┴──────────────────┴───────────────────────────┘
```

## Recommended Vector DB: Qdrant

**Why Qdrant:**
- Lightweight, runs well in K8s
- Official Helm chart
- Good filtering capabilities (by date, nick, channel)
- Simple HTTP API
- Handles this data volume easily

**K8s Installation:**
```bash
helm repo add qdrant https://qdrant.github.io/qdrant-helm
helm install qdrant qdrant/qdrant -n discord-article-bot
```

## Ingestion Pipeline

### Phase 1: Parse & Clean

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Raw Logs   │────▶│   Parser    │────▶│  Cleaned    │
│  (mIRC)     │     │             │     │  JSON/JSONL │
└─────────────┘     └─────────────┘     └─────────────┘
```

**Parser responsibilities:**
1. Extract session boundaries
2. Parse timestamps (handle Y2K-era formats)
3. Identify speakers (normalize nick variations: Akira1, Akira1_, Akira1__)
4. Filter noise:
   - Join/part/quit messages
   - Mode changes
   - mIRC control codes
   - Bot spam/trojans (like that rSUAT- example)
   - Whois blocks (or extract as metadata)
5. Output structured format:

```json
{
  "session_id": "odyssey_20021216_210527",
  "channel": null,  // DM
  "participants": ["Akira1", "odyssey"],
  "start_time": "2002-12-16T21:05:27",
  "end_time": "2002-12-16T22:00:00",
  "messages": [
    {"time": "21:05", "nick": "odyssey", "text": "did u say sure to me?"},
    {"time": "21:05", "nick": "Akira1", "text": "yes"},
    ...
  ]
}
```

### Phase 2: Chunk Conversations

**Strategy:** Time-window + topic coherence

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Sessions   │────▶│  Chunker    │────▶│   Chunks    │
│             │     │             │     │  (5-20 msgs)│
└─────────────┘     └─────────────┘     └─────────────┘
```

**Chunking rules:**
1. Keep related messages together (conversation flow)
2. Split on:
   - Time gaps > 30 minutes
   - Topic shifts (detected via embeddings or keywords)
   - Max chunk size (~20 messages or ~2000 tokens)
3. Include overlap for context continuity

**Chunk format:**
```json
{
  "chunk_id": "odyssey_20021216_001",
  "session_id": "odyssey_20021216_210527",
  "participants": ["Akira1", "odyssey"],
  "channel": null,
  "start_time": "2002-12-16T21:05:00",
  "end_time": "2002-12-16T21:10:00",
  "text": "odyssey: did u say sure to me?\nAkira1: yes\n...",
  "message_count": 15,
  "year": 2002,
  "decade": "2000s"
}
```

### Phase 3: Generate Embeddings

**Embedding model options:**
1. **OpenAI text-embedding-3-small** - Good quality, API cost
2. **Sentence Transformers (local)** - Free, self-hosted
   - `all-MiniLM-L6-v2` - Fast, decent quality
   - `all-mpnet-base-v2` - Better quality, slower
3. **Gemini text-embedding-004** - Already have API key

**Batch processing:**
```python
# Pseudocode
for chunk in chunks:
    embedding = embed(chunk.text)
    store_in_qdrant(chunk, embedding)
```

### Phase 4: Store in Qdrant

**Collection schema:**
```json
{
  "collection_name": "irc_history",
  "vectors": {
    "size": 384,  // or 1536 for OpenAI
    "distance": "Cosine"
  },
  "payload_schema": {
    "chunk_id": "keyword",
    "session_id": "keyword",
    "participants": "keyword[]",
    "channel": "keyword",
    "start_time": "datetime",
    "year": "integer",
    "decade": "keyword",
    "text": "text"
  }
}
```

## Query Patterns for Bot Integration

### 1. Context Retrieval
When user chats, retrieve relevant historical context:
```python
# User "odyssey" mentions "Linux server"
results = qdrant.search(
    collection="irc_history",
    query_vector=embed("Linux server"),
    filter={"participants": {"$contains": "odyssey"}},
    limit=5
)
```

### 2. Temporal Queries
"What did we talk about in 2005?"
```python
results = qdrant.search(
    query_vector=embed(current_topic),
    filter={"year": 2005},
    limit=10
)
```

### 3. Cross-User Knowledge
"Has anyone discussed Kubernetes before?"
```python
results = qdrant.search(
    query_vector=embed("Kubernetes container orchestration"),
    limit=10
)
```

## Identity Mapping

Need to map IRC nicks to Discord users:

```yaml
# config/nick_mapping.yaml
discord_users:
  "123456789":  # Discord user ID
    irc_nicks:
      - odyssey
      - odyssey_
      - ody
    display_name: "Odyssey"

  "987654321":
    irc_nicks:
      - Akira1
      - Akira1_
      - Akira1__
      - akirasoft
    display_name: "Akira"
```

## Implementation Phases

### Phase 1: Infrastructure (1-2 hours)
- [ ] Deploy Qdrant to K8s cluster
- [ ] Create collection with schema
- [ ] Test basic insert/query

### Phase 2: Parser Development (4-6 hours)
- [ ] Write mIRC log parser
- [ ] Handle edge cases (encoding, corrupt files)
- [ ] Filter noise patterns
- [ ] Output JSONL format
- [ ] Unit tests for parser

### Phase 3: Chunking & Embedding (2-4 hours)
- [ ] Implement chunking strategy
- [ ] Choose embedding model
- [ ] Batch embedding generation
- [ ] Progress tracking for large ingestion

### Phase 4: Ingestion (1-2 hours runtime)
- [ ] Run full ingestion pipeline
- [ ] Verify data quality
- [ ] Create indexes for common filters

### Phase 5: Bot Integration (4-6 hours)
- [ ] Create QdrantService in bot
- [ ] Add retrieval to ChatService
- [ ] Implement context injection
- [ ] Add Discord commands for searching history
- [ ] Nick-to-Discord mapping

## Potential Bot Commands

```
!remember <query>     - Search IRC history semantically
!history <nick>       - Show past conversations with user
!throwback            - Random conversation from this day in history
!context              - Show what historical context bot is using
```

## Cost Estimates

**Qdrant:** Free (self-hosted)

**Embeddings (one-time ingestion):**
- ~600MB text ≈ ~150M characters ≈ ~37M tokens
- OpenAI text-embedding-3-small: ~$0.02/1M tokens = ~$0.74
- Local model: Free

**Storage:**
- 911 files × ~100 chunks avg × 384 dims × 4 bytes = ~140MB vectors
- Plus metadata: ~200MB total
- Very manageable for Qdrant

## Open Questions

1. **Privacy:** Any logs that shouldn't be indexed? (personal info, credentials)
2. **Retention:** Index everything or filter by relevance/date?
3. **Real-time vs batch:** Just historical, or also index new Discord convos?
4. **Multi-tenancy:** Per-user filtered views or shared knowledge base?

## Next Steps

1. Deploy Qdrant to cluster
2. Build parser prototype with a few sample files
3. Test embedding + retrieval quality
4. Iterate on chunking strategy
5. Full ingestion run
6. Bot integration

---

*Created: 2024-12-13*
*Status: Planning*
