# Veo Video Generation Implementation Plan

## Overview
Add video generation support using Google's Veo 3.1 (`veo-3.1-fast-generate-preview`) with first and last frame input. Users can provide two images and a prompt to generate a video that transitions between them.

## Technical Requirements

### API Details
- **Endpoint**: `POST https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/us-central1/publishers/google/models/{MODEL_ID}:predictLongRunning`
- **Authentication**: Google Cloud OAuth2 / Application Default Credentials (NOT API key)
- **Model**: `veo-3.1-fast-generate-001` (fast preview model as specified)

### Input Requirements
- **First Frame**: Required image (JPEG/PNG)
- **Last Frame**: Required image (JPEG/PNG)
- **Prompt**: Text description of the transition/video content
- **Aspect Ratio**: 16:9 (landscape) or 9:16 (portrait)
- **Duration**: 4, 6, or 8 seconds (default: 8)

### Output
- MP4 video file stored in GCS bucket
- Resolution: 720p (default) or 1080p
- Async operation (long-running) - need to poll for completion

### Key Differences from ImagenService
1. Requires Vertex AI authentication (service account), not API key
2. Requires GCS bucket for output storage
3. Async operation with polling (not synchronous like Gemini image gen)
4. Two input images required (first + last frame)

---

## Implementation Phases

### Phase 1: Configuration Setup
- [ ] Add Veo configuration to `config/config.js`
  - `VEO_ENABLED`: Feature toggle
  - `VEO_MODEL`: Model ID (default: `veo-3.1-fast-generate-001`)
  - `VEO_GCS_BUCKET`: GCS bucket for output videos
  - `VEO_DEFAULT_DURATION`: Default video duration (4, 6, or 8 seconds)
  - `VEO_DEFAULT_ASPECT_RATIO`: Default aspect ratio (16:9 or 9:16)
  - `VEO_COOLDOWN_SECONDS`: Per-user cooldown
  - `VEO_MAX_PROMPT_LENGTH`: Maximum prompt length
- [ ] Add environment variables to `k8s/base/configmap.yaml`
- [ ] Document GCS bucket setup requirements

### Phase 2: VeoService Implementation (TDD)
- [ ] Create `services/VeoService.js` with:
  - Constructor with config validation and Vertex AI client setup
  - `validatePrompt(prompt)` - Validate prompt length
  - `validateAspectRatio(aspectRatio)` - Validate 16:9 or 9:16
  - `validateDuration(duration)` - Validate 4, 6, or 8 seconds
  - `isImageUrl(url)` - Check if URL points to valid image (reuse from ImagenService)
  - `fetchImageAsBase64(url)` - Fetch and encode image (reuse pattern from ImagenService)
  - `generateVideo(prompt, firstFrameUrl, lastFrameUrl, options)` - Main generation method
  - `pollOperation(operationName)` - Poll long-running operation until complete
  - `downloadVideo(gcsUri)` - Download video from GCS to buffer
  - Cooldown management methods (similar to ImagenService)
- [ ] Create `__tests__/services/VeoService.test.js` with comprehensive tests
- [ ] Handle async operation lifecycle (start -> poll -> complete/error)

### Phase 3: VideogenCommand Implementation (TDD)
- [ ] Create `commands/video/VideogenCommand.js` with:
  - Command name: `videogen` with aliases `vg`, `veo`, `video`
  - Parse arguments for prompt, two image URLs, and options
  - Support `--duration` / `-d` flag (4, 6, 8)
  - Support `--ratio` / `-r` flag (16:9, 9:16)
  - Discord emoji/sticker support for frame images (reuse pattern)
  - Progress indication during long-running operation
  - Send video as Discord attachment on completion
- [ ] Create `__tests__/commands/video/VideogenCommand.test.js`
- [ ] Register command in `commands/index.js`
- [ ] Create `commands/video/index.js` for category exports

### Phase 4: MongoDB Tracking
- [ ] Add `recordVideoGeneration()` method to MongoService
  - Track: userId, username, prompt, duration, aspectRatio, model, success, error, videoSizeBytes
- [ ] Add tests for MongoDB tracking
- [ ] Integrate tracking into VeoService

### Phase 5: Kubernetes & Documentation
- [ ] Update `k8s/base/configmap.yaml` with Veo config
- [ ] Document GCS bucket and service account requirements
- [ ] Update README.md with video generation documentation
- [ ] Add usage examples

---

## Command Usage Examples

```
# Basic usage with two image URLs
!videogen https://example.com/start.png https://example.com/end.png A flower blooming in timelapse

# With duration option
!vg https://example.com/morning.jpg https://example.com/night.jpg Day turning to night --duration 6

# With aspect ratio
!video <first_image_url> <last_image_url> Camera panning across landscape -r 16:9

# Using Discord emojis as frames
!vg <:emoji1:123456> <:emoji2:789012> The emoji transforming
```

---

## Dependencies
- `@google-cloud/vertexai` - Vertex AI SDK for video generation
- `@google-cloud/storage` - GCS client for downloading output videos
- Existing: `axios` for image fetching

---

## Authentication Requirements
Unlike ImagenService (which uses API key), VeoService requires:
1. Google Cloud service account with Vertex AI permissions
2. `GOOGLE_APPLICATION_CREDENTIALS` environment variable pointing to service account JSON
3. OR Workload Identity in GKE

---

## Notes
- Video generation is async and can take 30-120+ seconds
- Need to handle Discord's file size limits (25MB for normal, 100MB for boosted)
- Consider adding progress updates during polling
- GCS bucket must be in same region as Vertex AI endpoint (us-central1)
