# Channel Context Resilience — Design Spec

**Date:** 2026-05-16
**Status:** Approved, going to implementation
**Author:** Michael Villiger (with Claude)

## Goal

Make the bot's awareness of recent channel conversation survive restarts and become user-tunable. Two tightly-related changes:

1. **Option 2** — Replace the hardcoded "last 10 messages" prompt-injection slice in `ChannelContextService.buildHybridContext()` with a config-driven value (`CHANNEL_CONTEXT_PROMPT_RECENT_COUNT`).
2. **Option 3** — On bot startup, rehydrate the per-channel in-memory hot buffer from MongoDB's `channel_messages` so the bot wakes up with conversation context already loaded, instead of waiting for new messages to arrive.

## Motivation

The in-memory hot buffer (`ChannelContextService.channelBuffers`) feeds the chat pipeline's "recent channel conversation" block. Today:
- The buffer holds up to `CHANNEL_CONTEXT_RECENT_COUNT` messages per channel (currently 20, will be 100 in the new configmap).
- But `buildHybridContext` only ever pulls **10** of them via `getRecentContext(channelId, 10)` (hardcoded). Bumping the buffer cap alone doesn't change what the chat prompt sees.
- The buffer is purely in-memory. On pod restart it starts empty; the bot has zero conversation memory until 10 new messages arrive in each channel.

`channel_messages` (MongoDB) already persists every incoming message (`bot.js:556`) and survives restarts. Today it's read only by `/tldr` and the sandbox-trace reaction reveal. This change lets the chat pipeline also benefit from it indirectly — by rehydrating the in-memory buffer on startup.

## Non-goals

- Backfilling **Qdrant** (the Tier 2 semantic index) from MongoDB on startup. Separate follow-up; the user explicitly opted for "in-memory rehydration" as the immediate win.
- Changing the `channel_messages` write path. The collection is already populated for every message; this spec only adds reads.
- Bot-message inclusion in the prompt. The existing `getRecentContext` filter (`!m.isBot`) is preserved — bot replies remain visible to the buffer but filtered at prompt-build time.
- Touching the Tier 3 (Mem0 channel memories) extraction logic.

## File map

**Modified files:**
- `services/ChannelContextService.js` — config-driven prompt count + startup rehydration logic
- `services/MongoService.js` — new `getRecentChannelMessages(channelId, limit)` method
- `config/config.js` — new `channelContext.promptRecentCount` field
- `__tests__/services/ChannelContextService.test.js` — new tests for rehydration + config-driven prompt count
- `__tests__/services/MongoService.test.js` — new test for `getRecentChannelMessages`
- `k8s/overlays/deployed/configmap.yaml` — set `CHANNEL_CONTEXT_PROMPT_RECENT_COUNT=40` (gitignored — local edit only)
- `features.md` — note the resilience improvements; remove the open "startup rehydration" callout (it ships here)
- `docs/architecture.md` — same

**No new files.**

## Config

### `config/config.js`

Add to the existing `channelContext` block:

```js
// Number of buffered messages to inject into the chat prompt's "recent channel
// conversation" tier. Must be ≤ recentMessageCount (the buffer cap). If unset
// or larger than the buffer cap, falls back to min(10, recentMessageCount).
promptRecentCount: parseInt(process.env.CHANNEL_CONTEXT_PROMPT_RECENT_COUNT || '10', 10),
```

`CHANNEL_CONTEXT_PROMPT_RECENT_COUNT` defaults to `10` to preserve current behavior. The deployed configmap sets it to `40`. The buffer cap (`recentMessageCount`) is independent — the user has already raised it to accommodate.

## Public API additions

### `MongoService.getRecentChannelMessages(channelId, limit)`

```js
/**
 * Get the most recent N messages from a single channel, in chronological order.
 * Used by ChannelContextService for startup hot-buffer rehydration.
 * @param {string} channelId
 * @param {number} limit
 * @returns {Promise<Array>} Messages sorted by timestamp ASCENDING (oldest first)
 */
async getRecentChannelMessages(channelId, limit = 100)
```

- Queries `channel_messages` with `{ channelId }`, sorted `timestamp: -1`, `.limit(limit)`, then **reverses** the result client-side so the oldest message is first. This matches the order required when push-loading into the circular buffer (oldest-then-newer).
- Wrapped in the same `_traced` instrumentation as other collection ops.
- Returns `[]` if `this.db` is null or the query throws.

### `ChannelContextService._rehydrateBufferFromMongoDB(channelId, guildId)`

Internal method, called once per tracked channel during `start()` after the per-channel buffer is initialized and before `setInterval` is wired.

Behavior:
1. If `!this.mongoService`, log a debug line and return early.
2. Pull `await this.mongoService.getRecentChannelMessages(channelId, this.config.recentMessageCount)`.
3. Determine the bot's user ID: `this.config.botUserId` is **not** set today; the service reads `config.discord?.clientId` at construction. Pass the bot user ID into the constructor (new param) OR look it up via `this.config.discord?.clientId` if the consolidated config object is available. We choose the constructor-injection path; see implementation plan.
4. For each MongoDB doc, build a buffer record:
   ```js
   {
     id: doc.messageId,
     authorId: doc.authorId,
     authorName: doc.authorName,
     content: doc.content,
     timestamp: doc.timestamp,
     isBot: doc.authorId === botUserId,
     replyToId: null  // not stored in channel_messages; minor metadata loss
   }
   ```
5. Push records into the channel's `messages` (CircularBuffer) in returned order.
6. Update the channel's `lastActivity` to the most-recent rehydrated message's timestamp.
7. Log: `Rehydrated <N> messages for channel <id> from MongoDB`.

If rehydration fails for any channel (logged at `warn`), the bot still starts normally with an empty buffer — graceful degradation matches the existing posture.

## buildHybridContext change

```diff
- Promise.resolve(this.getRecentContext(channelId, 10)),
+ Promise.resolve(this.getRecentContext(channelId, this.config.promptRecentCount)),
```

When `promptRecentCount > recentMessageCount` (the buffer cap), `CircularBuffer.getRecent(n)` returns up to `buffer.length` items — fewer than requested. That's acceptable. A startup log line warns when the config relationship is inverted.

## Constructor signature change

`ChannelContextService` currently takes `(config, openaiClient, mongoService, mem0Service)`. The rehydration logic needs the bot user ID for the `isBot` derivation. Add an optional 5th argument:

```js
constructor(config, openaiClient, mongoService, mem0Service = null, botUserId = null)
```

`bot.js` passes `this.client.user?.id` at construction time. Because the Discord client may not have logged in yet when the service is constructed (`ChannelContextService` is one of many services instantiated in the bot constructor), the value can be null at construction. We avoid this by passing in a getter or refactoring construction order. Implementation chooses the simplest path: **read `botUserId` lazily inside `_rehydrateBufferFromMongoDB`** via a small `getBotUserId` callback parameter, or via `config.discord.clientId` (the static ID stored in the configmap — independent of the runtime Discord client login).

Decision: use `config.discord.clientId` from the existing config block. This is the bot's application ID, which is identical to the bot user ID and is already set in the configmap. No extra plumbing needed.

## Startup ordering

The existing `ChannelContextService.start()` already:
1. Initializes the Qdrant client
2. Ensures the collection exists
3. Loads tracked channels from MongoDB
4. Starts the batch + cleanup intervals
5. Runs `_cleanupExpiredMessages` immediately

We insert one new step **between #3 and #4**: rehydrate the in-memory buffer from MongoDB for each tracked channel. This way the buffer is populated before the cleanup interval fires (which is unrelated but logical) and well before the first message arrives.

The rehydration is awaited but errors are caught per-channel so one bad channel doesn't block the rest of startup.

## Test plan

### `__tests__/services/MongoService.test.js`

- `getRecentChannelMessages` returns the latest N docs in ascending order
- Returns empty array when `this.db` is null
- Returns empty array when the query throws (logs error)
- Honors the `limit` parameter

### `__tests__/services/ChannelContextService.test.js`

- `buildHybridContext` calls `getRecentContext(channelId, <promptRecentCount>)` with the value from config (mock config injects 40)
- `_rehydrateBufferFromMongoDB` populates the channel's buffer with the right number of records in chronological order
- Bot-author messages get `isBot: true` derived from `config.discord.clientId`
- Rehydration failure for one channel doesn't block startup (caught + logged)
- Empty MongoDB response leaves buffer empty (no crash)
- `start()` calls rehydration for each tracked channel exactly once

### Manual smoke test (post-deploy)

1. Restart the bot pod with `kubectl rollout restart deployment/discord-article-bot -n discord-article-bot`.
2. Watch pod logs for `Rehydrated <N> messages for channel <id> from MongoDB` lines on startup (one per tracked channel).
3. Send a `/chat` command immediately after the bot reports "Bot is online" and verify the response references recent conversation. The bot should "remember" what was happening before the restart.
4. Send 5+ unrelated messages to a tracked channel, then `/tldr` to confirm the larger prompt window pulls 40 messages (not the previous 10).

## Open questions / risks

- **Buffer cap > prompt count is the recommended config relationship.** If a user sets `CHANNEL_CONTEXT_PROMPT_RECENT_COUNT=200` while `CHANNEL_CONTEXT_RECENT_COUNT=20` stays default, they get 20 messages, not 200. The startup log will warn so the misconfiguration is visible.
- **Rehydration cost.** `getRecentChannelMessages(channelId, 100)` per tracked channel — typically 2 channels — runs once at startup. Negligible.
- **`channel_messages` content includes bot replies via `bot.js:556` AND `bot.js:801`.** Some bot replies may be present twice (one from each call site). The `isBot` derivation handles this correctly (both have the bot's authorId), and `getRecentContext`'s `!m.isBot` filter excludes them from prompts. No downstream issue.
- **`replyToId` is null after rehydration** because `channel_messages` doesn't store the reply reference. This metadata is not currently consumed downstream (grepped — only `recordMessage` writes it; nothing reads it). Acceptable loss.
