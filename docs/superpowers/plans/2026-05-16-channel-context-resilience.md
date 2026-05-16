# Channel Context Resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ChannelContextService` config-driven (`CHANNEL_CONTEXT_PROMPT_RECENT_COUNT`) AND rehydrate the in-memory hot buffer from MongoDB on bot startup.

**Architecture:** Two changes in one branch — Option 2 (config-wire the hardcoded `10`) + Option 3 (MongoDB-based startup rehydration). New `MongoService.getRecentChannelMessages` method. `bot.js` updated to pass the new config through; configmap gets the new env var.

**Tech Stack:** Node.js, MongoDB driver, Jest 30. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-16-channel-context-resilience-design.md`

**Working tree note:** the user manually changed the hardcoded `10` to `40` on this branch as a quick fix before the proper config wiring lands. Task 2 replaces that `40` with `this.config.promptRecentCount`, so the local edit is functionally folded in.

---

## File map

**Modified files:**
- `services/MongoService.js` — add `getRecentChannelMessages(channelId, limit)`
- `services/ChannelContextService.js` — config-driven prompt count + startup rehydration
- `config/config.js` — add `channelContext.promptRecentCount`
- `__tests__/services/MongoService.test.js` — test for the new method
- `__tests__/services/ChannelContextService.test.js` — tests for rehydration + config-driven prompt count
- `k8s/overlays/deployed/configmap.yaml` — add `CHANNEL_CONTEXT_PROMPT_RECENT_COUNT=40` (gitignored — local edit only)
- `features.md`, `docs/architecture.md` — note the new resilience guarantees

**No new files.**

---

## Task 1: Add `MongoService.getRecentChannelMessages` (TDD)

**Files:**
- Modify: `services/MongoService.js`
- Modify: `__tests__/services/MongoService.test.js`

- [ ] **Step 1: Write the failing tests**

In `__tests__/services/MongoService.test.js`, append a new `describe` block:

```js
describe('MongoService.getRecentChannelMessages', () => {
  let svc;
  let mockCollection;

  beforeEach(() => {
    svc = new MongoService('mongodb://test/test');
    mockCollection = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn(),
    };
    svc.db = { collection: jest.fn(() => mockCollection) };
  });

  test('returns messages sorted ascending (oldest first) regardless of DB return order', async () => {
    // DB returns DESC (newest first); we reverse to ascending
    mockCollection.toArray.mockResolvedValueOnce([
      { messageId: '3', timestamp: new Date('2026-05-16T03:00:00Z'), content: 'c' },
      { messageId: '2', timestamp: new Date('2026-05-16T02:00:00Z'), content: 'b' },
      { messageId: '1', timestamp: new Date('2026-05-16T01:00:00Z'), content: 'a' },
    ]);
    const out = await svc.getRecentChannelMessages('chan-1', 100);
    expect(svc.db.collection).toHaveBeenCalledWith('channel_messages');
    expect(mockCollection.find).toHaveBeenCalledWith({ channelId: 'chan-1' });
    expect(mockCollection.sort).toHaveBeenCalledWith({ timestamp: -1 });
    expect(mockCollection.limit).toHaveBeenCalledWith(100);
    expect(out.map(m => m.messageId)).toEqual(['1', '2', '3']);
  });

  test('returns empty array when db is null', async () => {
    svc.db = null;
    const out = await svc.getRecentChannelMessages('chan-1', 100);
    expect(out).toEqual([]);
  });

  test('returns empty array when query throws', async () => {
    mockCollection.toArray.mockRejectedValueOnce(new Error('boom'));
    const out = await svc.getRecentChannelMessages('chan-1', 100);
    expect(out).toEqual([]);
  });

  test('honors the limit parameter', async () => {
    mockCollection.toArray.mockResolvedValueOnce([]);
    await svc.getRecentChannelMessages('chan-1', 5);
    expect(mockCollection.limit).toHaveBeenCalledWith(5);
  });
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
npm test -- --testPathPatterns="MongoService"
```

Expected: FAIL — method doesn't exist.

- [ ] **Step 3: Implement the method**

In `services/MongoService.js`, after `getChannelMessages` (around line 1380), add:

```js
    /**
     * Get the most recent N messages from a single channel, in chronological order.
     * Used by ChannelContextService for startup hot-buffer rehydration.
     * @param {string} channelId
     * @param {number} limit
     * @returns {Promise<Array>} Messages sorted by timestamp ASCENDING (oldest first)
     */
    async getRecentChannelMessages(channelId, limit = 100) {
        if (!this.db) return [];
        try {
            const collection = this.db.collection('channel_messages');
            const docs = await collection
                .find({ channelId })
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray();
            return docs.reverse();
        } catch (error) {
            logger.error(`Error fetching recent channel messages for ${channelId}: ${error.message}`);
            return [];
        }
    }
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPatterns="MongoService"
```

Expected: PASS — 4 new tests green; existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add services/MongoService.js __tests__/services/MongoService.test.js
git commit -m "feat(mongo): add getRecentChannelMessages for buffer rehydration"
```

---

## Task 2: Add `promptRecentCount` to config

**Files:**
- Modify: `config/config.js`

- [ ] **Step 1: Add the new field to the `channelContext` block**

In `config/config.js`, find the existing `channelContext` block. After `recentMessageCount`, add:

```js
    // Number of buffered messages to inject into the chat prompt's "recent
    // channel conversation" tier. Must be ≤ recentMessageCount (the buffer
    // cap). Defaults to 10 to preserve previous behavior.
    promptRecentCount: parseInt(process.env.CHANNEL_CONTEXT_PROMPT_RECENT_COUNT || '10', 10),
```

- [ ] **Step 2: Verify config loads**

```bash
node -e "console.log(require('./config/config').channelContext.promptRecentCount)"
```

Expected: `10`.

- [ ] **Step 3: Commit**

```bash
git add config/config.js
git commit -m "feat(config): add CHANNEL_CONTEXT_PROMPT_RECENT_COUNT"
```

---

## Task 3: Wire `promptRecentCount` through `buildHybridContext` (TDD)

**Files:**
- Modify: `services/ChannelContextService.js`
- Modify: `__tests__/services/ChannelContextService.test.js`

The current file has the user's manual edit in place (hardcoded `40`). This task replaces it with `this.config.promptRecentCount`.

- [ ] **Step 1: Write the failing test**

In `__tests__/services/ChannelContextService.test.js`, append:

```js
describe('ChannelContextService.buildHybridContext - configurable prompt slice', () => {
  test('uses config.promptRecentCount when slicing the recent buffer', async () => {
    const config = {
      channelContext: {
        enabled: true,
        recentMessageCount: 100,
        batchIndexIntervalMinutes: 60,
        retentionDays: 30,
        qdrantCollection: 'channel_conversations',
        searchScoreThreshold: 0.4,
        semanticSearchLimit: 5,
        promptRecentCount: 40,
      },
      qdrant: { host: 'qdrant', port: 6333 },
      discord: { clientId: 'bot-1' },
    };

    const svc = new ChannelContextService(config, {}, {}, null, 'bot-1');
    svc._enabled = true;
    svc.isChannelTracked = jest.fn().mockReturnValue(true);
    svc.getRecentContext = jest.fn().mockReturnValue('');
    svc.searchRelevantHistory = jest.fn().mockResolvedValue([]);
    svc.getChannelFacts = jest.fn().mockResolvedValue(null);
    svc.getParticipantContext = jest.fn().mockReturnValue('');

    await svc.buildHybridContext('chan-1', 'hello');

    expect(svc.getRecentContext).toHaveBeenCalledWith('chan-1', 40);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
npm test -- --testPathPatterns="ChannelContextService"
```

Expected: FAIL — hardcoded `40` (or `10`) gets called instead of `40` via config.

- [ ] **Step 3: Replace the hardcoded value**

In `services/ChannelContextService.js`, find:

```js
Promise.resolve(this.getRecentContext(channelId, 40)),
```

Replace with:

```js
Promise.resolve(this.getRecentContext(channelId, this.config.promptRecentCount || 10)),
```

The `|| 10` fallback keeps the service usable when an older config lacks the new field. The deployed configmap will set the real value.

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPatterns="ChannelContextService"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/ChannelContextService.js __tests__/services/ChannelContextService.test.js
git commit -m "feat(channel-context): wire promptRecentCount through buildHybridContext"
```

---

## Task 4: Constructor change + rehydration logic (TDD)

**Files:**
- Modify: `services/ChannelContextService.js`
- Modify: `__tests__/services/ChannelContextService.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/services/ChannelContextService.test.js`:

```js
describe('ChannelContextService._rehydrateBufferFromMongoDB', () => {
  let svc;
  let mongo;
  const config = {
    channelContext: {
      enabled: true,
      recentMessageCount: 100,
      batchIndexIntervalMinutes: 60,
      retentionDays: 30,
      qdrantCollection: 'channel_conversations',
      searchScoreThreshold: 0.4,
      semanticSearchLimit: 5,
      promptRecentCount: 10,
    },
    qdrant: { host: 'qdrant', port: 6333 },
    discord: { clientId: 'bot-1' },
  };

  beforeEach(() => {
    mongo = {
      getRecentChannelMessages: jest.fn(),
    };
    svc = new ChannelContextService(config, {}, mongo, null, 'bot-1');
    svc.channelBuffers.set('chan-1', {
      messages: new (require('../../services/ChannelContextService.js').CircularBuffer || class {
        constructor(cap) { this.capacity = cap; this.items = []; }
        push(x) { this.items.push(x); if (this.items.length > this.capacity) this.items.shift(); }
        getRecent(n) { return this.items.slice(-n); }
        size() { return this.items.length; }
      })(100),
      lastActivity: new Date(0),
      guildId: 'guild-1',
      activeParticipants: new Map(),
    });
  });

  test('populates the buffer with messages in chronological order', async () => {
    const t0 = new Date('2026-05-16T01:00:00Z');
    const t1 = new Date('2026-05-16T02:00:00Z');
    mongo.getRecentChannelMessages.mockResolvedValueOnce([
      { messageId: '1', authorId: 'u1', authorName: 'alice', content: 'hi', timestamp: t0 },
      { messageId: '2', authorId: 'bot-1', authorName: 'bot', content: 'hello', timestamp: t1 },
    ]);

    await svc._rehydrateBufferFromMongoDB('chan-1');

    const buf = svc.channelBuffers.get('chan-1');
    const msgs = buf.messages.getRecent(10);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ id: '1', authorId: 'u1', authorName: 'alice', content: 'hi', isBot: false });
    expect(msgs[1]).toMatchObject({ id: '2', authorId: 'bot-1', authorName: 'bot', content: 'hello', isBot: true });
    expect(buf.lastActivity).toEqual(t1);
  });

  test('returns gracefully when mongoService is null', async () => {
    svc.mongoService = null;
    await expect(svc._rehydrateBufferFromMongoDB('chan-1')).resolves.not.toThrow();
  });

  test('returns gracefully when getRecentChannelMessages throws', async () => {
    mongo.getRecentChannelMessages.mockRejectedValueOnce(new Error('mongo down'));
    await expect(svc._rehydrateBufferFromMongoDB('chan-1')).resolves.not.toThrow();
  });

  test('does nothing when mongo returns 0 messages', async () => {
    mongo.getRecentChannelMessages.mockResolvedValueOnce([]);
    await svc._rehydrateBufferFromMongoDB('chan-1');
    const buf = svc.channelBuffers.get('chan-1');
    expect(buf.messages.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify they fail**

```bash
npm test -- --testPathPatterns="ChannelContextService"
```

Expected: FAIL — `_rehydrateBufferFromMongoDB` doesn't exist; constructor doesn't accept botUserId.

- [ ] **Step 3: Add `botUserId` constructor parameter**

In `services/ChannelContextService.js`, find the constructor (it currently takes `(config, openaiClient, mongoService, mem0Service = null)`). Add an optional 5th parameter:

```js
constructor(config, openaiClient, mongoService, mem0Service = null, botUserId = null) {
  // existing body...
  this.botUserId = botUserId || config.discord?.clientId || null;
  // rest of existing body...
}
```

Place the `this.botUserId = ...` line near the other `this.* = ...` assignments at the top of the constructor body.

- [ ] **Step 4: Add the rehydration method**

In `services/ChannelContextService.js`, add a method to the class (place near other private `_` methods, e.g. before `_processBatchIndex`):

```js
  /**
   * Rehydrate the in-memory hot buffer for a channel from MongoDB on startup.
   * `channel_messages` persists every incoming message, so this gives the bot
   * immediate conversation context after a pod restart instead of waiting for
   * new messages to arrive.
   *
   * Called after `_loadTrackedChannels` has already initialized buffer entries
   * for each tracked channel, so the buffer is guaranteed to exist by the time
   * this runs.
   *
   * @param {string} channelId
   * @private
   */
  async _rehydrateBufferFromMongoDB(channelId) {
    if (!this.mongoService) {
      logger.debug(`Skipping buffer rehydration for ${channelId}: no mongoService`);
      return;
    }

    let docs;
    try {
      docs = await this.mongoService.getRecentChannelMessages(channelId, this.config.recentMessageCount);
    } catch (err) {
      logger.warn(`Failed to rehydrate buffer for channel ${channelId}: ${err.message}`);
      return;
    }

    if (!Array.isArray(docs) || docs.length === 0) {
      return;
    }

    const buffer = this.channelBuffers.get(channelId);
    if (!buffer) {
      // Defensive — _loadTrackedChannels should have initialized this. Bail.
      logger.warn(`No buffer entry for ${channelId}; skipping rehydration`);
      return;
    }

    let latestTimestamp = buffer.lastActivity;

    for (const doc of docs) {
      const record = {
        id: doc.messageId,
        authorId: doc.authorId,
        authorName: doc.authorName,
        content: doc.content,
        timestamp: doc.timestamp,
        isBot: this.botUserId ? doc.authorId === this.botUserId : false,
        replyToId: null,
      };
      buffer.messages.push(record);
      if (doc.timestamp instanceof Date && doc.timestamp > latestTimestamp) {
        latestTimestamp = doc.timestamp;
      }
    }
    buffer.lastActivity = latestTimestamp;

    logger.info(`Rehydrated ${docs.length} messages for channel ${channelId} from MongoDB`);
  }
```

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPatterns="ChannelContextService"
```

Expected: PASS — all new tests green; existing tests still green.

- [ ] **Step 6: Commit**

```bash
git add services/ChannelContextService.js __tests__/services/ChannelContextService.test.js
git commit -m "feat(channel-context): add _rehydrateBufferFromMongoDB + botUserId injection"
```

---

## Task 5: Call rehydration from `start()` per tracked channel

**Files:**
- Modify: `services/ChannelContextService.js`
- Modify: `__tests__/services/ChannelContextService.test.js`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/services/ChannelContextService.test.js`:

```js
describe('ChannelContextService.start - rehydration ordering', () => {
  test('calls _rehydrateBufferFromMongoDB once per tracked channel before scheduling intervals', async () => {
    const config = {
      channelContext: {
        enabled: true,
        recentMessageCount: 100,
        batchIndexIntervalMinutes: 60,
        retentionDays: 30,
        qdrantCollection: 'channel_conversations',
        searchScoreThreshold: 0.4,
        semanticSearchLimit: 5,
        promptRecentCount: 10,
      },
      qdrant: { host: 'qdrant', port: 6333 },
      discord: { clientId: 'bot-1' },
    };
    const mongo = {
      getRecentChannelMessages: jest.fn().mockResolvedValue([]),
      getTrackedChannels: jest.fn().mockResolvedValue([
        { channelId: 'chan-1', guildId: 'guild-1' },
        { channelId: 'chan-2', guildId: 'guild-1' },
      ]),
    };
    const svc = new ChannelContextService(config, {}, mongo, null, 'bot-1');
    svc._ensureCollection = jest.fn().mockResolvedValue();
    svc._cleanupExpiredMessages = jest.fn().mockResolvedValue();
    svc.qdrantClient = {};

    await svc.start();

    expect(mongo.getRecentChannelMessages).toHaveBeenCalledTimes(2);
    expect(mongo.getRecentChannelMessages).toHaveBeenCalledWith('chan-1', 100);
    expect(mongo.getRecentChannelMessages).toHaveBeenCalledWith('chan-2', 100);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

```bash
npm test -- --testPathPatterns="ChannelContextService"
```

Expected: FAIL — `start()` doesn't call rehydration.

- [ ] **Step 3: Wire rehydration into `start()`**

In `services/ChannelContextService.js`, find `start()`. After `_loadTrackedChannels` finishes (which populates `this.trackedChannels` as a `Set<channelId>` and initializes per-channel buffer entries) and **before** `setInterval(... _processBatchIndex ...)`, add:

```js
      // Rehydrate per-channel hot buffer from MongoDB so the bot has
      // conversation context immediately after restart, not after N
      // new messages arrive.
      for (const channelId of this.trackedChannels) {
        await this._rehydrateBufferFromMongoDB(channelId).catch((err) => {
          logger.warn(`Rehydration for ${channelId} failed (non-fatal): ${err.message}`);
        });
      }
```

`this.trackedChannels` is a `Set<channelId>` (confirmed at line 67 of the service). Per-channel buffer entries (including `guildId`) are already created by `_loadTrackedChannels` at lines 211-216 and 226-231, so rehydration just looks them up.

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPatterns="ChannelContextService"
```

Expected: PASS.

- [ ] **Step 5: Run the full suite**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/ChannelContextService.js __tests__/services/ChannelContextService.test.js
git commit -m "feat(channel-context): rehydrate buffer from MongoDB during start()"
```

---

## Task 6: Pass `botUserId` from bot.js

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Find the ChannelContextService instantiation**

```bash
grep -n "new ChannelContextService" bot.js
```

Expected: one match. The current call is something like:
```js
this.channelContextService = new ChannelContextService(config, this.openaiClient, this.mongoService, this.mem0Service);
```

- [ ] **Step 2: Add the `botUserId` argument**

Update the call to pass the bot user ID. The discord client may not be logged in at this point in `bot.js` (constructor time); pass the static `config.discord.clientId` instead:

```js
this.channelContextService = new ChannelContextService(
  config,
  this.openaiClient,
  this.mongoService,
  this.mem0Service,
  config.discord?.clientId
);
```

- [ ] **Step 3: Smoke-check bot.js parses**

```bash
node --check bot.js
```

Expected: no output.

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add bot.js
git commit -m "feat(bot): pass discord.clientId to ChannelContextService for isBot derivation"
```

---

## Task 7: Update local configmap (gitignored)

**Files (gitignored — local edits only):**
- `k8s/overlays/deployed/configmap.yaml`

- [ ] **Step 1: Confirm gitignored**

```bash
git check-ignore k8s/overlays/deployed/configmap.yaml
```

Expected: prints the path.

- [ ] **Step 2: Add the new env var**

In `k8s/overlays/deployed/configmap.yaml`, find the `Channel Context` section. Add **right after** `CHANNEL_CONTEXT_RECENT_COUNT`:

```yaml
  CHANNEL_CONTEXT_PROMPT_RECENT_COUNT: "40"
```

- [ ] **Step 3: Verify YAML parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('k8s/overlays/deployed/configmap.yaml'))" && echo OK
```

Expected: `OK`.

- [ ] **Step 4: Do not commit**

`git status --short` should show nothing related to configmap.yaml.

---

## Task 8: Documentation

**Files:**
- Modify: `features.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update `features.md`**

In `features.md`, find the "Channel Context Tracking" section. Add a new bullet to the feature list:

```markdown
- **Startup buffer rehydration**: On bot startup, the per-channel hot buffer is repopulated from MongoDB's `channel_messages` collection, so the bot has immediate conversation context after a pod restart instead of waiting for 10+ new messages to arrive.
- **Tunable prompt window**: `CHANNEL_CONTEXT_PROMPT_RECENT_COUNT` controls how many of the buffered messages get injected into the chat prompt's recent-conversation block (independent of the buffer cap `CHANNEL_CONTEXT_RECENT_COUNT`).
```

- [ ] **Step 2: Update `docs/architecture.md`**

In `docs/architecture.md`, find the "Open architectural follow-ups" section. The startup rehydration follow-up note (from the prompt-tuning PR) referenced this as outstanding work. Remove or update that note to reflect that **in-memory** rehydration ships here. The **Qdrant-index** catch-up remains a separate follow-up.

Find:
```markdown
- **Voice-profile regen-pipeline hardening.** ...
```

(That bullet is unrelated; leave it.) Look for any bullet related to "startup rehydration" or "channel context resilience" and update it. If there isn't one yet, no edit is needed.

Add one new bullet to the same section if there's no existing one to update:

```markdown
- **Qdrant index startup catch-up (remaining).** In-memory buffer rehydration from MongoDB now ships (see `services/ChannelContextService._rehydrateBufferFromMongoDB`), but the Qdrant semantic index is still vulnerable to unclean shutdowns dropping up to 5 minutes of messages (`CHANNEL_CONTEXT_BATCH_INTERVAL` minutes). A startup catch-up that pulls `channel_messages` newer than the latest Qdrant point per channel and batch-indexes them would close this gap.
```

- [ ] **Step 3: Commit**

```bash
git add features.md docs/architecture.md
git commit -m "docs: document channel-context resilience improvements"
```

---

## Task 9: Version bump + build + deploy + PR

**Files:** `package.json`, `package-lock.json`; gitignored deployment.yaml

- [ ] **Step 1: Confirm full suite green**

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 2: Bump minor version**

```bash
npm version minor --no-git-tag-version
```

From 2.15.0 → 2.16.0 (new user-facing capability: persistent channel-context).

- [ ] **Step 3: Commit bump**

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to 2.16.0"
```

- [ ] **Step 4: Build + push image (pinned tag)**

```bash
SHA=$(git rev-parse --short HEAD)
docker build -t mvilliger/discord-article-bot:$SHA .
docker push mvilliger/discord-article-bot:$SHA
```

- [ ] **Step 5: Apply configmap (now contains the new env var) and update deployment**

```bash
kubectl apply -f k8s/overlays/deployed/configmap.yaml -n discord-article-bot
```

Edit `k8s/overlays/deployed/deployment.yaml` (gitignored) to set the `bot` container's `image:` to `mvilliger/discord-article-bot:<short-sha>`. Then:

```bash
kubectl set image deployment/discord-article-bot bot=mvilliger/discord-article-bot:$SHA -n discord-article-bot
kubectl rollout status deployment/discord-article-bot -n discord-article-bot --timeout=180s
```

- [ ] **Step 6: Verify rehydration in logs**

```bash
kubectl logs -n discord-article-bot deployment/discord-article-bot --tail=80 -c bot 2>&1 | grep -i "Rehydrat"
```

Expected: one `Rehydrated <N> messages for channel <id> from MongoDB` log line per tracked channel.

If no Rehydrated lines appear, capture pod logs and investigate before continuing.

- [ ] **Step 7: Push branch + open PR**

```bash
git push -u origin feat/channel-context-resilience
gh pr create --title "feat: channel-context resilience — config-driven prompt window + MongoDB startup rehydration (v2.16.0)" --body "$(cat <<'EOF'
## Summary
Two coupled improvements to the channel-voice chat pipeline's awareness of recent conversation:

1. **Config-driven prompt window.** `CHANNEL_CONTEXT_PROMPT_RECENT_COUNT` (default 10, deployed at 40) replaces the hardcoded `10` in `buildHybridContext`. Independent of the buffer cap (`CHANNEL_CONTEXT_RECENT_COUNT`).
2. **MongoDB startup rehydration.** On `ChannelContextService.start()`, the per-channel hot buffer is repopulated from `channel_messages` so the bot has immediate context after a pod restart, not after 10+ new messages arrive.

## Why
Pre-change: a pod restart wiped the in-memory buffer; chat had zero context until N new messages arrived. Combined with the previous PR's 60→5 minute batch interval reduction, channel-context awareness is now substantially more resilient.

## Spec + plan
- Spec: `docs/superpowers/specs/2026-05-16-channel-context-resilience-design.md`
- Plan: `docs/superpowers/plans/2026-05-16-channel-context-resilience.md`

## Test plan
- [x] `npm test` green (new tests cover MongoService.getRecentChannelMessages + rehydration + config-driven prompt count)
- [x] Manual: pod logs show `Rehydrated <N> messages for channel <id> from MongoDB` lines on startup
- [ ] Manual A/B: send `/chat` immediately after a pod restart; response references recent conversation
- [ ] Manual: `/tldr` returns a longer summary now that the prompt window is 40 messages

## Out of scope (follow-ups)
- **Qdrant index startup catch-up.** Closing the unclean-shutdown gap for the Tier 2 semantic index. Tracked in `docs/architecture.md`.
- Voice-profile regen-pipeline hardening (Approach B). Unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **No `:latest` Docker tags.** Pin to git short-SHA.
- **No log truncation.** Log full URLs / error messages.
- **No `--no-verify`. No `--legacy-peer-deps`.**
- **TDD discipline.** RED before GREEN at every TDD task.
- **The deployment.yaml and configmap.yaml are gitignored** — never `git add` them.
- **The `trackedChannels` data structure** in `ChannelContextService` — peek at `_loadTrackedChannels` to confirm whether it's a Map keyed by channelId or an array. Task 5's iteration syntax assumes Map; adjust if it's actually an array.
- **bot.js may instantiate ChannelContextService at a point where `this.client.user` isn't ready.** That's fine — Task 6 uses `config.discord.clientId` (the static application ID in the configmap, identical to the bot user ID) rather than the runtime Discord client. No race condition.
