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

// Mock axios for image fetching
jest.mock('axios', () => ({
  get: jest.fn()
}));

describe('ImagenService', () => {
  let imagenService;
  let mockConfig;
  let mockGeminiModel;
  let mockMongoService;

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

    mockMongoService = {
      recordImageGeneration: jest.fn().mockResolvedValue(true)
    };

    imagenService = new ImagenService(mockConfig, mockMongoService);

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

    it('should record successful generation in MongoDB', async () => {
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

      await imagenService.generateImage('A beautiful sunset', {}, mockUser);

      expect(mockMongoService.recordImageGeneration).toHaveBeenCalledWith(
        'user123',
        'TestUser#1234',
        'A beautiful sunset',
        '1:1',
        'gemini-3-pro-image-preview',
        true,
        null,
        expect.any(Number)
      );
    });

    it('should record failed generation in MongoDB', async () => {
      mockGeminiModel.generateContent.mockRejectedValue(new Error('API rate limit exceeded'));

      await imagenService.generateImage('A sunset', {}, mockUser);

      expect(mockMongoService.recordImageGeneration).toHaveBeenCalledWith(
        'user123',
        'TestUser#1234',
        'A sunset',
        '1:1',
        'gemini-3-pro-image-preview',
        false,
        expect.stringContaining('rate limit'),
        0
      );
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

  describe('reference image support', () => {
    const mockUser = {
      id: 'user123',
      username: 'TestUser',
      tag: 'TestUser#1234'
    };
    const axios = require('axios');

    beforeEach(() => {
      axios.get.mockReset();
    });

    describe('isImageUrl', () => {
      it('should detect PNG image URLs', () => {
        expect(imagenService.isImageUrl('https://example.com/image.png')).toBe(true);
      });

      it('should detect JPG image URLs', () => {
        expect(imagenService.isImageUrl('https://example.com/photo.jpg')).toBe(true);
      });

      it('should detect JPEG image URLs', () => {
        expect(imagenService.isImageUrl('https://example.com/photo.jpeg')).toBe(true);
      });

      it('should detect GIF image URLs', () => {
        expect(imagenService.isImageUrl('https://example.com/animation.gif')).toBe(true);
      });

      it('should detect WEBP image URLs', () => {
        expect(imagenService.isImageUrl('https://example.com/image.webp')).toBe(true);
      });

      it('should handle URLs with query parameters', () => {
        expect(imagenService.isImageUrl('https://example.com/image.png?size=large')).toBe(true);
      });

      it('should be case insensitive', () => {
        expect(imagenService.isImageUrl('https://example.com/image.PNG')).toBe(true);
        expect(imagenService.isImageUrl('https://example.com/image.JPG')).toBe(true);
      });

      it('should return false for non-image URLs', () => {
        expect(imagenService.isImageUrl('https://example.com/page.html')).toBe(false);
        expect(imagenService.isImageUrl('https://example.com/video.mp4')).toBe(false);
      });

      it('should return false for non-URLs', () => {
        expect(imagenService.isImageUrl('not a url')).toBe(false);
        expect(imagenService.isImageUrl('')).toBe(false);
      });
    });

    describe('fetchImageAsBase64', () => {
      it('should fetch and encode image as base64', async () => {
        const fakeImageBuffer = Buffer.from('fake-image-data');
        axios.get.mockResolvedValue({
          data: fakeImageBuffer,
          headers: { 'content-type': 'image/png' }
        });

        const result = await imagenService.fetchImageAsBase64('https://example.com/image.png');

        expect(result.success).toBe(true);
        expect(result.data).toBe(fakeImageBuffer.toString('base64'));
        expect(result.mimeType).toBe('image/png');
      });

      it('should infer mime type from URL if not in headers', async () => {
        const fakeImageBuffer = Buffer.from('fake-image-data');
        axios.get.mockResolvedValue({
          data: fakeImageBuffer,
          headers: {}
        });

        const result = await imagenService.fetchImageAsBase64('https://example.com/photo.jpg');

        expect(result.success).toBe(true);
        expect(result.mimeType).toBe('image/jpeg');
      });

      it('should handle fetch errors', async () => {
        axios.get.mockRejectedValue(new Error('Network error'));

        const result = await imagenService.fetchImageAsBase64('https://example.com/image.png');

        expect(result.success).toBe(false);
        expect(result.error).toContain('fetch');
      });

      it('should reject non-image content types for non-image URLs', async () => {
        axios.get.mockResolvedValue({
          data: Buffer.from('not an image'),
          headers: { 'content-type': 'text/html' }
        });

        // URL without image extension, so it relies on content-type header
        const result = await imagenService.fetchImageAsBase64('https://example.com/image');

        expect(result.success).toBe(false);
        expect(result.error).toContain('does not point to a valid image');
      });
    });

    describe('generateImage with reference image', () => {
      it('should include reference image in API call', async () => {
        const fakeImageBuffer = Buffer.from('reference-image-data');
        const mockOutputImage = Buffer.from('generated-image').toString('base64');

        axios.get.mockResolvedValue({
          data: fakeImageBuffer,
          headers: { 'content-type': 'image/png' }
        });

        mockGeminiModel.generateContent.mockResolvedValue({
          response: {
            candidates: [{
              content: {
                parts: [{
                  inlineData: {
                    mimeType: 'image/png',
                    data: mockOutputImage
                  }
                }]
              }
            }]
          }
        });

        const result = await imagenService.generateImage(
          'Make this image look like a painting',
          { referenceImageUrl: 'https://example.com/photo.png' },
          mockUser
        );

        expect(result.success).toBe(true);
        expect(axios.get).toHaveBeenCalledWith(
          'https://example.com/photo.png',
          expect.objectContaining({ responseType: 'arraybuffer' })
        );

        // Verify the API was called with both text and image parts
        const callArgs = mockGeminiModel.generateContent.mock.calls[0][0];
        expect(callArgs.contents[0].parts).toHaveLength(2);
        expect(callArgs.contents[0].parts[0]).toHaveProperty('text');
        expect(callArgs.contents[0].parts[1]).toHaveProperty('inlineData');
      });

      it('should return error if reference image fetch fails', async () => {
        axios.get.mockRejectedValue(new Error('Image not found'));

        const result = await imagenService.generateImage(
          'Make this image look like a painting',
          { referenceImageUrl: 'https://example.com/missing.png' },
          mockUser
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('fetch');
      });
    });
  });
});
