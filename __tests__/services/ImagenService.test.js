// __tests__/services/ImagenService.test.js
const ImagenService = require('../../services/ImagenService');

// Mock the logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Mock the Google Generative AI SDK
jest.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: jest.fn()
      })
    }))
  };
});

describe('ImagenService', () => {
  let imagenService;
  let mockConfig;
  let mockGeminiModel;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfig = {
      imagen: {
        enabled: true,
        apiKey: 'test-api-key',
        model: 'gemini-3-pro-image-preview',
        defaultAspectRatio: '1:1',
        maxPromptLength: 1000,
        cooldownSeconds: 30
      }
    };

    imagenService = new ImagenService(mockConfig);

    // Get reference to the mocked model
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    mockGeminiModel = GoogleGenerativeAI.mock.results[0].value.getGenerativeModel();
  });

  describe('constructor', () => {
    it('should initialize with config', () => {
      expect(imagenService).toBeDefined();
      expect(imagenService.config).toBe(mockConfig);
    });

    it('should throw error if imagen is disabled', () => {
      const disabledConfig = {
        imagen: { ...mockConfig.imagen, enabled: false }
      };

      expect(() => new ImagenService(disabledConfig)).toThrow('Image generation is disabled');
    });

    it('should throw error if API key is missing', () => {
      const noKeyConfig = {
        imagen: { ...mockConfig.imagen, apiKey: '' }
      };

      expect(() => new ImagenService(noKeyConfig)).toThrow('GEMINI_API_KEY is required');
    });
  });

  describe('validatePrompt', () => {
    it('should return valid for a normal prompt', () => {
      const result = imagenService.validatePrompt('A beautiful sunset over mountains');

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid for empty prompt', () => {
      const result = imagenService.validatePrompt('');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should return invalid for whitespace-only prompt', () => {
      const result = imagenService.validatePrompt('   ');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should return invalid for prompt exceeding max length', () => {
      const longPrompt = 'a'.repeat(1001);
      const result = imagenService.validatePrompt(longPrompt);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('1000 characters');
    });

    it('should return valid for prompt at max length', () => {
      const maxPrompt = 'a'.repeat(1000);
      const result = imagenService.validatePrompt(maxPrompt);

      expect(result.valid).toBe(true);
    });
  });

  describe('validateAspectRatio', () => {
    const validRatios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

    validRatios.forEach(ratio => {
      it(`should accept valid aspect ratio: ${ratio}`, () => {
        const result = imagenService.validateAspectRatio(ratio);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid aspect ratio', () => {
      const result = imagenService.validateAspectRatio('5:3');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid aspect ratio');
    });

    it('should reject malformed aspect ratio', () => {
      const result = imagenService.validateAspectRatio('16x9');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid aspect ratio');
    });
  });

  describe('generateImage', () => {
    const mockUser = {
      id: 'user123',
      username: 'TestUser',
      tag: 'TestUser#1234'
    };

    it('should generate image successfully', async () => {
      const mockImageData = Buffer.from('fake-image-data').toString('base64');

      mockGeminiModel.generateContent.mockResolvedValue({
        response: {
          candidates: [{
            content: {
              parts: [{
                inlineData: {
                  mimeType: 'image/png',
                  data: mockImageData
                }
              }]
            }
          }]
        }
      });

      const result = await imagenService.generateImage('A beautiful sunset', {}, mockUser);

      expect(result.success).toBe(true);
      expect(result.buffer).toBeDefined();
      expect(result.mimeType).toBe('image/png');
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
    });

    it('should return error for invalid prompt', async () => {
      const result = await imagenService.generateImage('', {}, mockUser);

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should return error for invalid aspect ratio option', async () => {
      const result = await imagenService.generateImage('A sunset', { aspectRatio: '5:3' }, mockUser);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid aspect ratio');
    });

    it('should use default aspect ratio when not specified', async () => {
      const mockImageData = Buffer.from('fake-image-data').toString('base64');

      mockGeminiModel.generateContent.mockResolvedValue({
        response: {
          candidates: [{
            content: {
              parts: [{
                inlineData: {
                  mimeType: 'image/png',
                  data: mockImageData
                }
              }]
            }
          }]
        }
      });

      await imagenService.generateImage('A sunset', {}, mockUser);

      expect(mockGeminiModel.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          contents: expect.any(Array)
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      mockGeminiModel.generateContent.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await imagenService.generateImage('A sunset', {}, mockUser);

      expect(result.success).toBe(false);
      expect(result.error).toContain('rate limit');
    });

    it('should handle safety filter rejections', async () => {
      mockGeminiModel.generateContent.mockResolvedValue({
        response: {
          candidates: [{
            finishReason: 'SAFETY',
            safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH' }]
          }]
        }
      });

      const result = await imagenService.generateImage('Something inappropriate', {}, mockUser);

      expect(result.success).toBe(false);
      expect(result.error).toContain('safety');
    });

    it('should handle empty response', async () => {
      mockGeminiModel.generateContent.mockResolvedValue({
        response: {
          candidates: []
        }
      });

      const result = await imagenService.generateImage('A sunset', {}, mockUser);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No image');
    });

    it('should handle response without image data', async () => {
      mockGeminiModel.generateContent.mockResolvedValue({
        response: {
          candidates: [{
            content: {
              parts: [{
                text: 'I cannot generate that image'
              }]
            }
          }]
        }
      });

      const result = await imagenService.generateImage('A sunset', {}, mockUser);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No image');
    });
  });

  describe('cooldown management', () => {
    const mockUser = { id: 'user123', username: 'TestUser' };

    it('should track cooldowns per user', () => {
      imagenService.setCooldown(mockUser.id);

      expect(imagenService.isOnCooldown(mockUser.id)).toBe(true);
    });

    it('should return remaining cooldown time', () => {
      imagenService.setCooldown(mockUser.id);

      const remaining = imagenService.getRemainingCooldown(mockUser.id);

      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(30);
    });

    it('should not be on cooldown for new users', () => {
      expect(imagenService.isOnCooldown('newuser456')).toBe(false);
    });

    it('should return 0 remaining for users not on cooldown', () => {
      expect(imagenService.getRemainingCooldown('newuser456')).toBe(0);
    });
  });
});
