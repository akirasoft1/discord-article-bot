# Local LLM Migration Plan: Uncensored Chat Mode

## Overview

This document outlines the implementation plan for adding local LLM inference support to the Discord Article Bot, specifically for uncensored chat functionality. The primary goal is to give users the option to use a locally-hosted, less restricted LLM (via Ollama) instead of the cloud-based Gemini API.

## Current State

- Chat functionality is handled by `ChatService.js`
- Uses OpenAI-compatible API (currently pointing to Gemini or cloud providers)
- Configuration via environment variables (`OPENAI_BASE_URL`, `OPENAI_MODEL`, etc.)
- Personality system with 5+ personalities in `personalities/` directory
- Users report frequent safety/guardrail blocks from Gemini on legitimate creative content

## Target State

- Users can opt into uncensored mode via `--uncensored` or `-u` flag on `!chat` command
- Uncensored mode routes to local Ollama instance running `dolphin-llama3:8b-v2.9-fp16`
- Standard mode continues to use existing cloud provider (Gemini)
- Configuration allows admins to enable/disable uncensored mode globally
- Per-channel or per-user restrictions possible for moderation

## Hardware Context

- Primary: RTX 4090 (24GB VRAM) - runs Ollama
- Ollama already installed and tested with `dolphin-llama3:8b-v2.9-fp16`
- Ollama endpoint: `http://localhost:11434/v1` (OpenAI-compatible)

---

## Implementation Tasks

### Phase 1: Configuration Updates

#### 1.1 Update `config/config.js`

Add new configuration section for local LLM:

```javascript
localLlm: {
  enabled: process.env.LOCAL_LLM_ENABLED === 'true',
  baseUrl: process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434/v1',
  model: process.env.LOCAL_LLM_MODEL || 'dolphin-llama3:8b-v2.9-fp16',
  apiKey: process.env.LOCAL_LLM_API_KEY || 'ollama', // Ollama doesn't require a real key
  
  // Uncensored mode settings
  uncensored: {
    enabled: process.env.UNCENSORED_MODE_ENABLED === 'true',
    allowedChannels: process.env.UNCENSORED_ALLOWED_CHANNELS?.split(',') || [], // Empty = all channels
    blockedChannels: process.env.UNCENSORED_BLOCKED_CHANNELS?.split(',') || [],
    allowedUsers: process.env.UNCENSORED_ALLOWED_USERS?.split(',') || [], // Empty = all users
    requireNsfw: process.env.UNCENSORED_REQUIRE_NSFW === 'true', // Only allow in NSFW channels
  },
  
  // Model parameters for local inference
  temperature: parseFloat(process.env.LOCAL_LLM_TEMPERATURE) || 0.8,
  topP: parseFloat(process.env.LOCAL_LLM_TOP_P) || 0.95,
  maxTokens: parseInt(process.env.LOCAL_LLM_MAX_TOKENS) || 2048,
}
```

#### 1.2 Update `.env.example`

Add new environment variables:

```env
# Local LLM Configuration (Ollama)
LOCAL_LLM_ENABLED=true
LOCAL_LLM_BASE_URL=http://localhost:11434/v1
LOCAL_LLM_MODEL=dolphin-llama3:8b-v2.9-fp16
LOCAL_LLM_API_KEY=ollama
LOCAL_LLM_TEMPERATURE=0.8
LOCAL_LLM_TOP_P=0.95
LOCAL_LLM_MAX_TOKENS=2048

# Uncensored Mode Settings
UNCENSORED_MODE_ENABLED=true
UNCENSORED_ALLOWED_CHANNELS=           # Comma-separated channel IDs, empty = all
UNCENSORED_BLOCKED_CHANNELS=           # Comma-separated channel IDs to block
UNCENSORED_ALLOWED_USERS=              # Comma-separated user IDs, empty = all  
UNCENSORED_REQUIRE_NSFW=false          # If true, only allow in Discord NSFW channels
```

---

### Phase 2: Create Local LLM Service

#### 2.1 Create `services/LocalLlmService.js`

New service to handle local Ollama inference:

```javascript
const OpenAI = require('openai');
const logger = require('../logger');
const config = require('../config/config');

class LocalLlmService {
  constructor() {
    this.client = null;
    this.initialized = false;
  }

  async initialize() {
    if (!config.localLlm.enabled) {
      logger.info('Local LLM service is disabled');
      return false;
    }

    try {
      this.client = new OpenAI({
        baseURL: config.localLlm.baseUrl,
        apiKey: config.localLlm.apiKey,
      });

      // Test connection with a simple request
      await this.healthCheck();
      this.initialized = true;
      logger.info(`Local LLM service initialized with model: ${config.localLlm.model}`);
      return true;
    } catch (error) {
      logger.error('Failed to initialize Local LLM service:', error);
      this.initialized = false;
      return false;
    }
  }

  async healthCheck() {
    try {
      // Ollama's /v1/models endpoint
      const response = await fetch(`${config.localLlm.baseUrl.replace('/v1', '')}/api/tags`);
      if (!response.ok) {
        throw new Error(`Ollama health check failed: ${response.status}`);
      }
      const data = await response.json();
      const modelExists = data.models?.some(m => m.name.includes(config.localLlm.model.split(':')[0]));
      if (!modelExists) {
        logger.warn(`Configured model ${config.localLlm.model} may not be available in Ollama`);
      }
      return true;
    } catch (error) {
      logger.error('Local LLM health check failed:', error);
      throw error;
    }
  }

  isAvailable() {
    return this.initialized && config.localLlm.enabled;
  }

  /**
   * Check if uncensored mode is allowed for the given context
   * @param {string} channelId - Discord channel ID
   * @param {string} userId - Discord user ID  
   * @param {boolean} isNsfwChannel - Whether the channel is marked NSFW
   * @returns {object} { allowed: boolean, reason: string }
   */
  checkUncensoredAccess(channelId, userId, isNsfwChannel = false) {
    const uncensoredConfig = config.localLlm.uncensored;

    if (!uncensoredConfig.enabled) {
      return { allowed: false, reason: 'Uncensored mode is disabled by administrator' };
    }

    if (!this.isAvailable()) {
      return { allowed: false, reason: 'Local LLM service is not available' };
    }

    // Check NSFW requirement
    if (uncensoredConfig.requireNsfw && !isNsfwChannel) {
      return { allowed: false, reason: 'Uncensored mode is only available in NSFW channels' };
    }

    // Check blocked channels
    if (uncensoredConfig.blockedChannels.length > 0 && 
        uncensoredConfig.blockedChannels.includes(channelId)) {
      return { allowed: false, reason: 'Uncensored mode is not available in this channel' };
    }

    // Check allowed channels (if specified)
    if (uncensoredConfig.allowedChannels.length > 0 && 
        !uncensoredConfig.allowedChannels.includes(channelId)) {
      return { allowed: false, reason: 'Uncensored mode is not enabled for this channel' };
    }

    // Check allowed users (if specified)
    if (uncensoredConfig.allowedUsers.length > 0 && 
        !uncensoredConfig.allowedUsers.includes(userId)) {
      return { allowed: false, reason: 'You do not have permission to use uncensored mode' };
    }

    return { allowed: true, reason: null };
  }

  /**
   * Generate a chat completion using the local LLM
   * @param {Array} messages - Array of message objects {role, content}
   * @param {object} options - Optional overrides for model parameters
   * @returns {Promise<string>} The generated response
   */
  async generateCompletion(messages, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('Local LLM service is not available');
    }

    const model = options.model || config.localLlm.model;
    const temperature = options.temperature ?? config.localLlm.temperature;
    const topP = options.topP ?? config.localLlm.topP;
    const maxTokens = options.maxTokens ?? config.localLlm.maxTokens;

    try {
      logger.debug(`Local LLM request - Model: ${model}, Messages: ${messages.length}`);

      const completion = await this.client.chat.completions.create({
        model,
        messages,
        temperature,
        top_p: topP,
        max_tokens: maxTokens,
      });

      const response = completion.choices[0]?.message?.content?.trim();
      
      if (!response) {
        throw new Error('Empty response from local LLM');
      }

      logger.debug(`Local LLM response received - Length: ${response.length} chars`);
      return response;
    } catch (error) {
      logger.error('Local LLM generation error:', error);
      throw error;
    }
  }

  /**
   * Generate with streaming (for future use with typing indicators)
   */
  async *generateCompletionStream(messages, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('Local LLM service is not available');
    }

    const model = options.model || config.localLlm.model;

    const stream = await this.client.chat.completions.create({
      model,
      messages,
      temperature: options.temperature ?? config.localLlm.temperature,
      top_p: options.topP ?? config.localLlm.topP,
      max_tokens: options.maxTokens ?? config.localLlm.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}

module.exports = new LocalLlmService();
```

---

### Phase 3: Update Chat Command

#### 3.1 Modify `commands/chat/ChatCommand.js`

Update the chat command to support the `--uncensored` / `-u` flag:

**Key changes:**

1. Parse `--uncensored` or `-u` flag from arguments
2. Check uncensored access permissions
3. Route to LocalLlmService when uncensored flag is present
4. Add visual indicator in response (e.g., 🔓 emoji) to show uncensored mode

```javascript
// Add to argument parsing section
const uncensoredFlags = ['--uncensored', '-u', '--local', '-l'];
const useUncensored = args.some(arg => uncensoredFlags.includes(arg.toLowerCase()));

// Remove flags from the actual message
const cleanedArgs = args.filter(arg => !uncensoredFlags.includes(arg.toLowerCase()));
const userMessage = cleanedArgs.join(' ');

// Check uncensored access if requested
if (useUncensored) {
  const localLlmService = require('../../services/LocalLlmService');
  const accessCheck = localLlmService.checkUncensoredAccess(
    message.channel.id,
    message.author.id,
    message.channel.nsfw || false
  );

  if (!accessCheck.allowed) {
    return message.reply(`❌ ${accessCheck.reason}`);
  }
}
```

#### 3.2 Modify `services/ChatService.js`

Update the service to support routing between cloud and local LLM:

**Add method to choose inference backend:**

```javascript
const localLlmService = require('./LocalLlmService');

class ChatService {
  // ... existing code ...

  /**
   * Generate a response, routing to local or cloud based on uncensored flag
   * @param {Array} messages - Chat messages
   * @param {object} options - Options including useUncensored flag
   * @returns {Promise<string>} Generated response
   */
  async generateResponse(messages, options = {}) {
    const { useUncensored = false } = options;

    if (useUncensored && localLlmService.isAvailable()) {
      logger.info('Using local LLM for uncensored response');
      return localLlmService.generateCompletion(messages, options);
    }

    // Fall back to existing cloud provider
    logger.info('Using cloud provider for response');
    return this.generateCloudResponse(messages, options);
  }

  // Rename existing generation method
  async generateCloudResponse(messages, options = {}) {
    // ... existing OpenAI/Gemini code ...
  }
}
```

---

### Phase 4: Update Personality System

#### 4.1 Add Uncensored Variants to Personalities (Optional)

Some personalities may benefit from slightly modified prompts when in uncensored mode. Add optional `uncensoredSystemPrompt` field:

```javascript
// personalities/noir-detective.js
module.exports = {
  id: 'noir-detective',
  name: 'Jack Shadows',
  emoji: '🕵️',
  description: 'Hardboiled 1940s detective with noir prose',
  systemPrompt: `You are Jack Shadows, a hardboiled detective from 1940s Los Angeles...`,
  
  // Optional: Enhanced prompt for uncensored mode
  uncensoredSystemPrompt: `You are Jack Shadows, a hardboiled detective from 1940s Los Angeles.
You speak in authentic noir prose - gritty, cynical, and atmospheric.
In this uncensored mode, you can explore darker themes appropriate to noir fiction:
violence, moral ambiguity, period-accurate language, and mature situations.
Stay in character at all times. Never break the fourth wall.`,

  exampleResponses: [
    "The dame walked in like trouble on heels...",
  ]
};
```

#### 4.2 Update Personality Loading in `personalities/index.js`

```javascript
getSystemPrompt(personalityId, useUncensored = false) {
  const personality = this.personalities.get(personalityId);
  if (!personality) return null;

  if (useUncensored && personality.uncensoredSystemPrompt) {
    return personality.uncensoredSystemPrompt;
  }

  return personality.systemPrompt;
}
```

---

### Phase 5: Bot Initialization

#### 5.1 Update `bot.js`

Initialize the LocalLlmService on bot startup:

```javascript
const localLlmService = require('./services/LocalLlmService');

class DiscordBot {
  async initialize() {
    // ... existing initialization ...

    // Initialize local LLM service
    if (config.localLlm.enabled) {
      const llmInitialized = await localLlmService.initialize();
      if (llmInitialized) {
        logger.info('✅ Local LLM service ready for uncensored mode');
      } else {
        logger.warn('⚠️ Local LLM service failed to initialize - uncensored mode unavailable');
      }
    }

    // ... rest of initialization ...
  }
}
```

---

### Phase 6: User Documentation

#### 6.1 Update Help Command

Add uncensored mode documentation to `!help chat`:

```
**Uncensored Mode**
Add \`--uncensored\` or \`-u\` to your chat command to use a locally-hosted, less restricted AI model.

Examples:
• \`!chat -u noir Tell me a gritty detective story\`
• \`!chat --uncensored friendly Let's have an unfiltered conversation\`

Note: Uncensored mode may be restricted to certain channels or users by server admins.
```

#### 6.2 Update README.md

Add section documenting uncensored mode:

```markdown
### Uncensored Mode

The bot supports an optional uncensored mode that routes chat requests to a locally-hosted LLM (Ollama) instead of cloud providers. This mode has fewer content restrictions and is useful for creative writing, roleplay, and other use cases where cloud provider guardrails are too restrictive.

**Usage:**
- Add `--uncensored` or `-u` flag to any `!chat` command
- Example: `!chat -u noir Write a gritty crime scene`

**Configuration:**
Uncensored mode requires:
1. Ollama running locally with a compatible model
2. `LOCAL_LLM_ENABLED=true` in environment
3. `UNCENSORED_MODE_ENABLED=true` in environment

**Admin Controls:**
- Restrict to specific channels: `UNCENSORED_ALLOWED_CHANNELS`
- Block specific channels: `UNCENSORED_BLOCKED_CHANNELS`
- Restrict to specific users: `UNCENSORED_ALLOWED_USERS`
- Require NSFW channel: `UNCENSORED_REQUIRE_NSFW=true`
```

---

## Testing Checklist

### Unit Tests

Add tests in `__tests__/` directory:

- [ ] `LocalLlmService.test.js`
  - [ ] Test initialization success/failure
  - [ ] Test health check
  - [ ] Test access control (channels, users, NSFW)
  - [ ] Test completion generation
  - [ ] Test error handling

- [ ] `ChatCommand.test.js` (update existing)
  - [ ] Test `--uncensored` flag parsing
  - [ ] Test `-u` shorthand
  - [ ] Test flag removal from message
  - [ ] Test access denied scenarios
  - [ ] Test fallback when local LLM unavailable

### Integration Tests

- [ ] Test full chat flow with uncensored flag
- [ ] Test personality system with uncensored prompts
- [ ] Test Ollama connection timeout handling
- [ ] Test graceful degradation when Ollama is down

### Manual Testing

- [ ] Verify uncensored mode produces less filtered responses
- [ ] Test each personality in uncensored mode
- [ ] Test channel/user restrictions
- [ ] Test NSFW channel requirement (if enabled)
- [ ] Verify response times are acceptable
- [ ] Test with long conversations (context window)

---

## Rollout Plan

### Stage 1: Development
1. Implement all code changes
2. Run full test suite
3. Test locally with Ollama

### Stage 2: Limited Beta
1. Enable for bot admin users only (`UNCENSORED_ALLOWED_USERS`)
2. Monitor for issues
3. Gather feedback

### Stage 3: Channel Rollout
1. Enable for specific opt-in channels
2. Add user documentation
3. Monitor usage and feedback

### Stage 4: Full Release
1. Enable globally (with appropriate restrictions)
2. Update all documentation
3. Announce to users

---

## Future Enhancements (Out of Scope for This PR)

- [ ] Model hot-swapping via admin command (`!admin model set dolphin3:70b`)
- [ ] Per-user model preferences
- [ ] Usage tracking/limits for local LLM
- [ ] Automatic fallback to cloud if Ollama is slow/unavailable
- [ ] Streaming responses with Discord typing indicator
- [ ] Multi-GPU load balancing (4090 + 3090)
- [ ] Local image generation via ComfyUI (separate initiative)

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOCAL_LLM_ENABLED` | No | `false` | Enable local LLM service |
| `LOCAL_LLM_BASE_URL` | No | `http://localhost:11434/v1` | Ollama API endpoint |
| `LOCAL_LLM_MODEL` | No | `dolphin-llama3:8b-v2.9-fp16` | Model to use |
| `LOCAL_LLM_API_KEY` | No | `ollama` | API key (Ollama ignores this) |
| `LOCAL_LLM_TEMPERATURE` | No | `0.8` | Generation temperature |
| `LOCAL_LLM_TOP_P` | No | `0.95` | Top-p sampling |
| `LOCAL_LLM_MAX_TOKENS` | No | `2048` | Max response tokens |
| `UNCENSORED_MODE_ENABLED` | No | `false` | Allow users to use uncensored flag |
| `UNCENSORED_ALLOWED_CHANNELS` | No | `` | Comma-separated channel IDs (empty=all) |
| `UNCENSORED_BLOCKED_CHANNELS` | No | `` | Comma-separated blocked channel IDs |
| `UNCENSORED_ALLOWED_USERS` | No | `` | Comma-separated user IDs (empty=all) |
| `UNCENSORED_REQUIRE_NSFW` | No | `false` | Only allow in NSFW channels |

---

## Files to Create/Modify

### New Files
- `services/LocalLlmService.js` - Local LLM inference service
- `__tests__/services/LocalLlmService.test.js` - Unit tests

### Modified Files
- `config/config.js` - Add localLlm configuration section
- `commands/chat/ChatCommand.js` - Add --uncensored flag support
- `services/ChatService.js` - Add routing logic
- `personalities/index.js` - Support uncensoredSystemPrompt
- `bot.js` - Initialize LocalLlmService
- `commands/utility/HelpCommand.js` - Document uncensored mode
- `README.md` - Add uncensored mode documentation
- `.env.example` - Add new environment variables

---

## Notes for Claude Code

1. The existing codebase uses CommonJS (`require`), not ES modules
2. OpenAI SDK is already a dependency - reuse it for Ollama
3. Follow existing patterns in `services/` for the new service
4. Maintain existing logging conventions using `logger`
5. The bot uses Discord.js v14
6. Ollama is already running and tested at `http://localhost:11434`
7. Model confirmed working: `dolphin-llama3:8b-v2.9-fp16`
