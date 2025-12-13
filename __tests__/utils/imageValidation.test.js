// __tests__/utils/imageValidation.test.js

// Mock axios before requiring the module
jest.mock('axios');

// Mock logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

const axios = require('axios');
const {
  isSupportedMimeType,
  isSupportedExtension,
  isAnimatedGif,
  validateImageAttachment,
  getSupportedFormatsText,
  SUPPORTED_MIME_TYPES,
  SUPPORTED_EXTENSIONS
} = require('../../utils/imageValidation');

describe('imageValidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isSupportedMimeType', () => {
    it('should accept image/png', () => {
      expect(isSupportedMimeType('image/png')).toBe(true);
    });

    it('should accept image/jpeg', () => {
      expect(isSupportedMimeType('image/jpeg')).toBe(true);
    });

    it('should accept image/webp', () => {
      expect(isSupportedMimeType('image/webp')).toBe(true);
    });

    it('should accept image/gif', () => {
      expect(isSupportedMimeType('image/gif')).toBe(true);
    });

    it('should reject unsupported types', () => {
      expect(isSupportedMimeType('image/bmp')).toBe(false);
      expect(isSupportedMimeType('image/tiff')).toBe(false);
      expect(isSupportedMimeType('video/mp4')).toBe(false);
      expect(isSupportedMimeType('application/pdf')).toBe(false);
    });

    it('should handle null/undefined', () => {
      expect(isSupportedMimeType(null)).toBe(false);
      expect(isSupportedMimeType(undefined)).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isSupportedMimeType('IMAGE/PNG')).toBe(true);
      expect(isSupportedMimeType('Image/Jpeg')).toBe(true);
    });
  });

  describe('isSupportedExtension', () => {
    it('should accept .png', () => {
      expect(isSupportedExtension('image.png')).toBe(true);
    });

    it('should accept .jpg', () => {
      expect(isSupportedExtension('photo.jpg')).toBe(true);
    });

    it('should accept .jpeg', () => {
      expect(isSupportedExtension('photo.jpeg')).toBe(true);
    });

    it('should accept .webp', () => {
      expect(isSupportedExtension('image.webp')).toBe(true);
    });

    it('should accept .gif', () => {
      expect(isSupportedExtension('animation.gif')).toBe(true);
    });

    it('should reject unsupported extensions', () => {
      expect(isSupportedExtension('image.bmp')).toBe(false);
      expect(isSupportedExtension('image.tiff')).toBe(false);
      expect(isSupportedExtension('video.mp4')).toBe(false);
      expect(isSupportedExtension('document.pdf')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isSupportedExtension('IMAGE.PNG')).toBe(true);
      expect(isSupportedExtension('Photo.JPG')).toBe(true);
    });

    it('should handle null/undefined', () => {
      expect(isSupportedExtension(null)).toBe(false);
      expect(isSupportedExtension(undefined)).toBe(false);
    });
  });

  describe('isAnimatedGif', () => {
    it('should detect animated GIF with NETSCAPE2.0 extension', async () => {
      // Create a buffer that mimics an animated GIF with NETSCAPE2.0
      const animatedGifBuffer = Buffer.alloc(100);
      animatedGifBuffer.write('GIF89a', 0, 'ascii');
      animatedGifBuffer.write('NETSCAPE2.0', 20, 'ascii');

      axios.get.mockResolvedValue({
        data: animatedGifBuffer
      });

      const result = await isAnimatedGif('https://example.com/animated.gif');
      expect(result).toBe(true);
    });

    it('should detect animated GIF with multiple Graphics Control Extension blocks', async () => {
      // Create a buffer with multiple 0x21 0xF9 sequences
      const animatedGifBuffer = Buffer.alloc(100);
      animatedGifBuffer.write('GIF89a', 0, 'ascii');
      // First Graphics Control Extension
      animatedGifBuffer[10] = 0x21;
      animatedGifBuffer[11] = 0xF9;
      // Second Graphics Control Extension
      animatedGifBuffer[30] = 0x21;
      animatedGifBuffer[31] = 0xF9;

      axios.get.mockResolvedValue({
        data: animatedGifBuffer
      });

      const result = await isAnimatedGif('https://example.com/animated.gif');
      expect(result).toBe(true);
    });

    it('should return false for static GIF', async () => {
      // Create a buffer that mimics a static GIF (only one frame)
      const staticGifBuffer = Buffer.alloc(100);
      staticGifBuffer.write('GIF89a', 0, 'ascii');
      // Only one Graphics Control Extension
      staticGifBuffer[10] = 0x21;
      staticGifBuffer[11] = 0xF9;

      axios.get.mockResolvedValue({
        data: staticGifBuffer
      });

      const result = await isAnimatedGif('https://example.com/static.gif');
      expect(result).toBe(false);
    });

    it('should return false for non-GIF files', async () => {
      const pngBuffer = Buffer.alloc(100);
      pngBuffer.write('PNG', 0, 'ascii'); // Not a valid GIF header

      axios.get.mockResolvedValue({
        data: pngBuffer
      });

      const result = await isAnimatedGif('https://example.com/image.png');
      expect(result).toBe(false);
    });

    it('should return null on network error', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));

      const result = await isAnimatedGif('https://example.com/image.gif');
      expect(result).toBe(null);
    });
  });

  describe('validateImageAttachment', () => {
    it('should accept valid PNG attachment', async () => {
      const attachment = {
        name: 'image.png',
        contentType: 'image/png',
        url: 'https://cdn.discord.com/image.png'
      };

      const result = await validateImageAttachment(attachment);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept valid JPEG attachment', async () => {
      const attachment = {
        name: 'photo.jpg',
        contentType: 'image/jpeg',
        url: 'https://cdn.discord.com/photo.jpg'
      };

      const result = await validateImageAttachment(attachment);
      expect(result.valid).toBe(true);
    });

    it('should accept valid WEBP attachment', async () => {
      const attachment = {
        name: 'image.webp',
        contentType: 'image/webp',
        url: 'https://cdn.discord.com/image.webp'
      };

      const result = await validateImageAttachment(attachment);
      expect(result.valid).toBe(true);
    });

    it('should reject unsupported content type', async () => {
      const attachment = {
        name: 'image.bmp',
        contentType: 'image/bmp',
        url: 'https://cdn.discord.com/image.bmp'
      };

      const result = await validateImageAttachment(attachment);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported image type');
      expect(result.error).toContain('image/bmp');
    });

    it('should reject animated GIF', async () => {
      const animatedGifBuffer = Buffer.alloc(100);
      animatedGifBuffer.write('GIF89a', 0, 'ascii');
      animatedGifBuffer.write('NETSCAPE2.0', 20, 'ascii');

      axios.get.mockResolvedValue({
        data: animatedGifBuffer
      });

      const attachment = {
        name: 'animation.gif',
        contentType: 'image/gif',
        url: 'https://cdn.discord.com/animation.gif'
      };

      const result = await validateImageAttachment(attachment);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Animated GIFs are not supported');
    });

    it('should accept static GIF', async () => {
      const staticGifBuffer = Buffer.alloc(100);
      staticGifBuffer.write('GIF89a', 0, 'ascii');
      staticGifBuffer[10] = 0x21;
      staticGifBuffer[11] = 0xF9;

      axios.get.mockResolvedValue({
        data: staticGifBuffer
      });

      const attachment = {
        name: 'static.gif',
        contentType: 'image/gif',
        url: 'https://cdn.discord.com/static.gif'
      };

      const result = await validateImageAttachment(attachment);
      expect(result.valid).toBe(true);
    });

    it('should return warning when GIF animation status cannot be determined', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));

      const attachment = {
        name: 'unknown.gif',
        contentType: 'image/gif',
        url: 'https://cdn.discord.com/unknown.gif'
      };

      const result = await validateImageAttachment(attachment);
      expect(result.valid).toBe(true);
      expect(result.warning).toContain('Could not verify');
    });

    it('should use extension fallback when content type is missing', async () => {
      const attachment = {
        name: 'image.png',
        contentType: null,
        url: 'https://cdn.discord.com/image.png'
      };

      const result = await validateImageAttachment(attachment);
      expect(result.valid).toBe(true);
    });

    it('should reject unknown extension when content type is missing', async () => {
      const attachment = {
        name: 'file.xyz',
        contentType: null,
        url: 'https://cdn.discord.com/file.xyz'
      };

      const result = await validateImageAttachment(attachment);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported file type');
    });
  });

  describe('getSupportedFormatsText', () => {
    it('should return human-readable format list', () => {
      const text = getSupportedFormatsText();
      expect(text).toContain('PNG');
      expect(text).toContain('JPEG');
      expect(text).toContain('WEBP');
      expect(text).toContain('GIF');
    });
  });

  describe('constants', () => {
    it('should export SUPPORTED_MIME_TYPES', () => {
      expect(SUPPORTED_MIME_TYPES).toContain('image/png');
      expect(SUPPORTED_MIME_TYPES).toContain('image/jpeg');
      expect(SUPPORTED_MIME_TYPES).toContain('image/webp');
      expect(SUPPORTED_MIME_TYPES).toContain('image/gif');
    });

    it('should export SUPPORTED_EXTENSIONS', () => {
      expect(SUPPORTED_EXTENSIONS).toContain('.png');
      expect(SUPPORTED_EXTENSIONS).toContain('.jpg');
      expect(SUPPORTED_EXTENSIONS).toContain('.jpeg');
      expect(SUPPORTED_EXTENSIONS).toContain('.webp');
      expect(SUPPORTED_EXTENSIONS).toContain('.gif');
    });
  });
});
