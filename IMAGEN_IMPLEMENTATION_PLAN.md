# Gemini Imagen (Nano Banana) Image Generation Implementation Plan

## Overview

This plan outlines the test-driven implementation of image generation capabilities for the Discord bot using Google's Gemini image generation API (codenamed "Nano Banana"). Users will be able to generate images from text prompts using Discord commands.

## Current State

- Branch: `feat/imagen-generation`
- The bot already has:
  - Command infrastructure (`BaseCommand`, `CommandHandler`)
  - Service pattern for business logic (`ChatService`, `SummarizationService`, etc.)
  - Jest test framework with mocking patterns
  - K8s deployment with secret management (GEMINI_API_KEY already defined)
  - Config system that loads from environment variables
  - Discord.js integration for message handling and file attachments

## API Details

### Gemini Image Generation Models
- **`gemini-3-pro-image-preview`** - Advanced model optimized for professional asset production (preferred)
- **`gemini-2.5-flash-image`** - Fast, efficient model for standard image generation (fallback)

### Key API Features
- Text-to-image generation from prompts
- Returns base64-encoded image data
- Supports aspect ratios: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
- Generated images include SynthID watermark
- Uses `responseModalities: ["TEXT", "IMAGE"]` configuration

## Implementation Phases

### Phase 1: Foundation Setup
**Commit 1: Add Gemini config and environment setup**
- [ ] Add `GEMINI_API_KEY` to config.js
- [ ] Add imagen configuration options (model, default aspect ratio, enabled flag)
- [ ] Write tests for config loading
- [ ] Update .env.example with new variables

### Phase 2: Core Service Implementation
**Commit 2: Create ImagenService with basic structure (TDD)**
- [ ] Write tests for ImagenService constructor and initialization
- [ ] Write tests for prompt validation (empty, too long, safety)
- [ ] Implement ImagenService skeleton
- [ ] Implement prompt validation

**Commit 3: Implement image generation API call (TDD)**
- [ ] Write tests for successful image generation (mock API)
- [ ] Write tests for API error handling (rate limits, invalid prompts, etc.)
- [ ] Implement generateImage() method with Gemini API call
- [ ] Handle base64 decoding and buffer creation

**Commit 4: Add aspect ratio and configuration options (TDD)**
- [ ] Write tests for aspect ratio validation
- [ ] Write tests for generation with custom options
- [ ] Implement option handling in generateImage()

### Phase 3: Discord Command Integration
**Commit 5: Create ImagineCommand (TDD)**
- [ ] Write tests for ImagineCommand argument parsing
- [ ] Write tests for command execution flow
- [ ] Implement ImagineCommand extending BaseCommand
- [ ] Handle Discord message attachments for generated images

**Commit 6: Register command and add typing indicator**
- [ ] Register ImagineCommand in bot.js
- [ ] Add typing indicator during generation
- [ ] Handle Discord's file size limits
- [ ] Add command cooldown to prevent abuse

### Phase 4: Enhanced Features
**Commit 7: Add image generation tracking (TDD)**
- [ ] Write tests for usage tracking in MongoService
- [ ] Implement recordImageGeneration() in MongoService
- [ ] Track prompts, timestamps, user, aspect ratio

**Commit 8: Add error handling and user feedback**
- [ ] Implement user-friendly error messages
- [ ] Add generation status messages (queued, generating, complete)
- [ ] Handle safety filter rejections gracefully

### Phase 5: Kubernetes Deployment
**Commit 9: Update K8s configuration**
- [ ] Verify GEMINI_API_KEY secret is already configured in deployment.yaml
- [ ] Add any new ConfigMap entries if needed
- [ ] Update README with deployment instructions

## Technical Details

### ImagenService Interface
```javascript
class ImagenService {
  constructor(config) {}

  /**
   * Generate an image from a text prompt
   * @param {string} prompt - Text description of the desired image
   * @param {Object} options - Generation options
   * @param {string} options.aspectRatio - Aspect ratio (default: "1:1")
   * @param {Object} user - Discord user object for tracking
   * @returns {Promise<{success: boolean, buffer?: Buffer, mimeType?: string, error?: string}>}
   */
  async generateImage(prompt, options = {}, user = null) {}

  /**
   * Validate a prompt before generation
   * @param {string} prompt - The prompt to validate
   * @returns {{valid: boolean, error?: string}}
   */
  validatePrompt(prompt) {}
}
```

### ImagineCommand Usage
```
!imagine <prompt> [--ratio <aspect_ratio>]

Examples:
  !imagine A sunset over mountains with purple clouds
  !imagine A cyberpunk city at night --ratio 16:9
  !imagine A cute robot making coffee --ratio 1:1
```

### Config Structure
```javascript
// config/config.js additions
imagen: {
  enabled: process.env.IMAGEN_ENABLED === 'true',
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.IMAGEN_MODEL || 'gemini-3-pro-image-preview',
  defaultAspectRatio: process.env.IMAGEN_DEFAULT_ASPECT_RATIO || '1:1',
  maxPromptLength: parseInt(process.env.IMAGEN_MAX_PROMPT_LENGTH || '1000', 10)
}
```

## File Structure
```
discord-article-bot/
├── services/
│   └── ImagenService.js          # New - Image generation service
├── commands/
│   └── image/
│       └── ImagineCommand.js     # New - !imagine command
├── __tests__/
│   ├── services/
│   │   └── ImagenService.test.js # New - Service tests
│   └── commands/
│       └── ImagineCommand.test.js # New - Command tests
├── config/
│   └── config.js                 # Updated - Add imagen config
└── bot.js                        # Updated - Register command
```

## Dependencies
- `@google/generative-ai` - Official Google Generative AI SDK for Node.js (to be added)

## Risk Mitigation
1. **Rate Limiting**: Implement per-user cooldowns to prevent API abuse
2. **Content Safety**: Rely on Gemini's built-in safety filters + add prompt screening
3. **File Size**: Handle Discord's 8MB/25MB file limits appropriately
4. **API Costs**: Track usage for cost monitoring
5. **Availability**: Graceful degradation if Gemini API is unavailable

## Rollback Strategy
Each phase is a separate commit with passing tests. To rollback:
1. `git revert <commit-hash>` for specific commits
2. Or `git reset --hard <safe-commit>` to return to a known good state

## Success Criteria
- [ ] All tests pass (`npm test`)
- [ ] Users can generate images with `!imagine <prompt>`
- [ ] Generated images are posted as Discord attachments
- [ ] Errors are handled gracefully with user-friendly messages
- [ ] Usage is tracked in MongoDB
- [ ] Bot deploys successfully to Kubernetes
