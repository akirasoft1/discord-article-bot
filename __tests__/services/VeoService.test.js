// __tests__/services/VeoService.test.js
const VeoService = require('../../services/VeoService');

// Mock the logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Mock @google-cloud/vertexai
jest.mock('@google-cloud/vertexai', () => ({
  VertexAI: jest.fn().mockImplementation(() => ({
    preview: {
      getGenerativeModel: jest.fn().mockReturnValue({})
    }
  }))
}));

// Mock @google-cloud/storage
jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({
        download: jest.fn().mockResolvedValue([Buffer.from('fake-video-data')]),
        exists: jest.fn().mockResolvedValue([true])
      })
    })
  }))
}));

// Mock axios
jest.mock('axios');
const axios = require('axios');

describe('VeoService', () => {
  let veoService;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      veo: {
        enabled: true,
        projectId: 'test-project',
        location: 'us-central1',
        model: 'veo-3.1-fast-generate-001',
        gcsBucket: 'test-bucket',
        defaultDuration: 8,
        defaultAspectRatio: '16:9',
        maxPromptLength: 1000,
        cooldownSeconds: 60,
        maxWaitSeconds: 300,
        pollIntervalMs: 5000
      }
    };

    veoService = new VeoService(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize with valid config', () => {
      expect(veoService).toBeDefined();
      expect(veoService.config).toBe(mockConfig);
    });

    it('should throw error if veo is disabled', () => {
      const disabledConfig = { veo: { ...mockConfig.veo, enabled: false } };
      expect(() => new VeoService(disabledConfig)).toThrow('Video generation is disabled');
    });

    it('should throw error if projectId is missing', () => {
      const noProjectConfig = { veo: { ...mockConfig.veo, projectId: '' } };
      expect(() => new VeoService(noProjectConfig)).toThrow('GOOGLE_CLOUD_PROJECT is required');
    });

    it('should throw error if gcsBucket is missing', () => {
      const noBucketConfig = { veo: { ...mockConfig.veo, gcsBucket: '' } };
      expect(() => new VeoService(noBucketConfig)).toThrow('VEO_GCS_BUCKET is required');
    });
  });

  describe('validatePrompt', () => {
    it('should return valid for normal prompt', () => {
      const result = veoService.validatePrompt('A flower blooming in timelapse');
      expect(result.valid).toBe(true);
    });

    it('should return invalid for empty prompt', () => {
      const result = veoService.validatePrompt('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should return invalid for whitespace-only prompt', () => {
      const result = veoService.validatePrompt('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should return invalid for prompt exceeding max length', () => {
      const longPrompt = 'a'.repeat(1001);
      const result = veoService.validatePrompt(longPrompt);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceeds maximum length');
    });

    it('should accept prompt at max length', () => {
      const maxPrompt = 'a'.repeat(1000);
      const result = veoService.validatePrompt(maxPrompt);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateAspectRatio', () => {
    it('should accept 16:9 aspect ratio', () => {
      const result = veoService.validateAspectRatio('16:9');
      expect(result.valid).toBe(true);
    });

    it('should accept 9:16 aspect ratio', () => {
      const result = veoService.validateAspectRatio('9:16');
      expect(result.valid).toBe(true);
    });

    it('should reject invalid aspect ratio', () => {
      const result = veoService.validateAspectRatio('4:3');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid aspect ratio');
    });

    it('should reject null aspect ratio', () => {
      const result = veoService.validateAspectRatio(null);
      expect(result.valid).toBe(false);
    });
  });

  describe('validateDuration', () => {
    it('should accept 4 seconds', () => {
      const result = veoService.validateDuration(4);
      expect(result.valid).toBe(true);
    });

    it('should accept 6 seconds', () => {
      const result = veoService.validateDuration(6);
      expect(result.valid).toBe(true);
    });

    it('should accept 8 seconds', () => {
      const result = veoService.validateDuration(8);
      expect(result.valid).toBe(true);
    });

    it('should reject 5 seconds', () => {
      const result = veoService.validateDuration(5);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid duration');
    });

    it('should reject negative duration', () => {
      const result = veoService.validateDuration(-1);
      expect(result.valid).toBe(false);
    });

    it('should handle string duration by converting to number', () => {
      const result = veoService.validateDuration('8');
      expect(result.valid).toBe(true);
    });
  });

  describe('getValidAspectRatios', () => {
    it('should return array of valid aspect ratios', () => {
      const ratios = veoService.getValidAspectRatios();
      expect(ratios).toContain('16:9');
      expect(ratios).toContain('9:16');
      expect(ratios.length).toBe(2);
    });
  });

  describe('getValidDurations', () => {
    it('should return array of valid durations', () => {
      const durations = veoService.getValidDurations();
      expect(durations).toContain(4);
      expect(durations).toContain(6);
      expect(durations).toContain(8);
      expect(durations.length).toBe(3);
    });
  });

  describe('isImageUrl', () => {
    it('should detect PNG image URLs', () => {
      expect(veoService.isImageUrl('https://example.com/image.png')).toBe(true);
    });

    it('should detect JPG image URLs', () => {
      expect(veoService.isImageUrl('https://example.com/photo.jpg')).toBe(true);
    });

    it('should detect JPEG image URLs', () => {
      expect(veoService.isImageUrl('https://example.com/photo.jpeg')).toBe(true);
    });

    it('should reject GIF URLs (not supported)', () => {
      expect(veoService.isImageUrl('https://example.com/animation.gif')).toBe(false);
    });

    it('should reject WEBP URLs (not supported by Veo)', () => {
      expect(veoService.isImageUrl('https://example.com/image.webp')).toBe(false);
    });

    it('should reject non-image URLs', () => {
      expect(veoService.isImageUrl('https://example.com/page.html')).toBe(false);
    });

    it('should handle URLs with query parameters', () => {
      expect(veoService.isImageUrl('https://example.com/image.png?size=large')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(veoService.isImageUrl('not-a-url')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(veoService.isImageUrl(null)).toBe(false);
      expect(veoService.isImageUrl(undefined)).toBe(false);
    });
  });

  describe('cooldown management', () => {
    it('should not be on cooldown initially', () => {
      expect(veoService.isOnCooldown('user123')).toBe(false);
    });

    it('should set cooldown for user', () => {
      veoService.setCooldown('user123');
      expect(veoService.isOnCooldown('user123')).toBe(true);
    });

    it('should return remaining cooldown time', () => {
      veoService.setCooldown('user123');
      const remaining = veoService.getRemainingCooldown('user123');
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(60);
    });

    it('should return 0 for user not on cooldown', () => {
      expect(veoService.getRemainingCooldown('user456')).toBe(0);
    });

    it('should clear expired cooldowns', () => {
      // Set a cooldown that expires immediately
      veoService.cooldowns.set('user789', Date.now() - 1000);
      expect(veoService.isOnCooldown('user789')).toBe(false);
    });
  });

  describe('fetchImageAsBase64', () => {
    it('should fetch and encode image successfully', async () => {
      const mockImageData = Buffer.from('fake-image-data');
      axios.get.mockResolvedValue({
        data: mockImageData,
        headers: { 'content-type': 'image/png' }
      });

      const result = await veoService.fetchImageAsBase64('https://example.com/image.png');

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockImageData.toString('base64'));
      expect(result.mimeType).toBe('image/png');
    });

    it('should handle JPEG content type', async () => {
      const mockImageData = Buffer.from('fake-jpeg-data');
      axios.get.mockResolvedValue({
        data: mockImageData,
        headers: { 'content-type': 'image/jpeg' }
      });

      const result = await veoService.fetchImageAsBase64('https://example.com/photo.jpg');

      expect(result.success).toBe(true);
      expect(result.mimeType).toBe('image/jpeg');
    });

    it('should reject non-image content types', async () => {
      axios.get.mockResolvedValue({
        data: Buffer.from('not-an-image'),
        headers: { 'content-type': 'text/html' }
      });

      const result = await veoService.fetchImageAsBase64('https://example.com/page.html');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Veo only supports PNG and JPEG');
    });

    it('should handle network errors', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));

      const result = await veoService.fetchImageAsBase64('https://example.com/image.png');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch');
    });

    it('should infer MIME type from URL if content-type is missing', async () => {
      axios.get.mockResolvedValue({
        data: Buffer.from('fake-image'),
        headers: {}
      });

      const result = await veoService.fetchImageAsBase64('https://example.com/image.png');

      expect(result.success).toBe(true);
      expect(result.mimeType).toBe('image/png');
    });
  });

  describe('Discord emoji support', () => {
    describe('parseDiscordEmoji', () => {
      it('should parse static custom emoji', () => {
        const result = veoService.parseDiscordEmoji('<:blobsad:396521773144866826>');
        expect(result).toEqual({
          name: 'blobsad',
          id: '396521773144866826',
          animated: false
        });
      });

      it('should parse animated custom emoji', () => {
        const result = veoService.parseDiscordEmoji('<a:ablobpanic:506956736113147909>');
        expect(result).toEqual({
          name: 'ablobpanic',
          id: '506956736113147909',
          animated: true
        });
      });

      it('should return null for invalid emoji format', () => {
        expect(veoService.parseDiscordEmoji(':smile:')).toBeNull();
        expect(veoService.parseDiscordEmoji('hello')).toBeNull();
        expect(veoService.parseDiscordEmoji(null)).toBeNull();
      });
    });

    describe('isDiscordEmojiId', () => {
      it('should recognize valid snowflake IDs', () => {
        expect(veoService.isDiscordEmojiId('396521773144866826')).toBe(true);
        expect(veoService.isDiscordEmojiId('1222630577900097627')).toBe(true);
      });

      it('should reject invalid IDs', () => {
        expect(veoService.isDiscordEmojiId('12345')).toBe(false);
        expect(veoService.isDiscordEmojiId('not-a-number')).toBe(false);
        expect(veoService.isDiscordEmojiId(null)).toBe(false);
      });
    });

    describe('extractDiscordAssetUrl', () => {
      it('should extract URL from static emoji', () => {
        const result = veoService.extractDiscordAssetUrl('<:blobsad:396521773144866826>');
        expect(result).toBe('https://cdn.discordapp.com/emojis/396521773144866826.png?size=256');
      });

      it('should return null for animated emoji (GIF not supported)', () => {
        const result = veoService.extractDiscordAssetUrl('<a:ablobpanic:506956736113147909>');
        expect(result).toBeNull();
      });

      it('should extract URL from raw emoji ID', () => {
        const result = veoService.extractDiscordAssetUrl('1222630577900097627');
        expect(result).toBe('https://cdn.discordapp.com/emojis/1222630577900097627.png?size=256');
      });

      it('should return null for non-Discord strings', () => {
        expect(veoService.extractDiscordAssetUrl('hello')).toBeNull();
        expect(veoService.extractDiscordAssetUrl(':smile:')).toBeNull();
      });
    });
  });

  describe('buildGcsOutputUri', () => {
    it('should build GCS URI with timestamp', () => {
      const uri = veoService.buildGcsOutputUri();
      expect(uri).toMatch(/^gs:\/\/test-bucket\/veo-output\/\d+\/$/);
    });
  });

  describe('generateVideo', () => {
    it('should return error for invalid prompt', async () => {
      const result = await veoService.generateVideo(
        '',
        'https://example.com/first.png',
        'https://example.com/last.png'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should return error for invalid aspect ratio', async () => {
      const result = await veoService.generateVideo(
        'A valid prompt',
        'https://example.com/first.png',
        'https://example.com/last.png',
        { aspectRatio: '4:3' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid aspect ratio');
    });

    it('should return error for invalid duration', async () => {
      const result = await veoService.generateVideo(
        'A valid prompt',
        'https://example.com/first.png',
        'https://example.com/last.png',
        { duration: 5 }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid duration');
    });

    it('should return error if first frame fetch fails', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));

      const result = await veoService.generateVideo(
        'A valid prompt',
        'https://example.com/first.png',
        'https://example.com/last.png'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('first frame');
    });

    it('should return error if last frame fetch fails', async () => {
      // First call succeeds, second fails
      axios.get
        .mockResolvedValueOnce({
          data: Buffer.from('first-frame'),
          headers: { 'content-type': 'image/png' }
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await veoService.generateVideo(
        'A valid prompt',
        'https://example.com/first.png',
        'https://example.com/last.png'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('last frame');
    });
  });
});
