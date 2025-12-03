// __tests__/commands/image/ImagineCommand.test.js
const ImagineCommand = require('../../../commands/image/ImagineCommand');

// Mock the logger
jest.mock('../../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('ImagineCommand', () => {
  let command;
  let mockImagenService;
  let mockMessage;
  let mockContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockImagenService = {
      validatePrompt: jest.fn().mockReturnValue({ valid: true }),
      validateAspectRatio: jest.fn().mockReturnValue({ valid: true }),
      generateImage: jest.fn().mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image'),
        mimeType: 'image/png',
        prompt: 'A beautiful sunset'
      }),
      isOnCooldown: jest.fn().mockReturnValue(false),
      getRemainingCooldown: jest.fn().mockReturnValue(0),
      getValidAspectRatios: jest.fn().mockReturnValue(['1:1', '16:9', '9:16']),
      isImageUrl: jest.fn().mockImplementation(url => {
        return url && (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.gif') || url.endsWith('.webp'));
      })
    };

    mockMessage = {
      author: { id: 'user123', username: 'TestUser', tag: 'TestUser#1234' },
      channel: {
        send: jest.fn().mockResolvedValue({}),
        sendTyping: jest.fn().mockResolvedValue({})
      },
      reply: jest.fn().mockResolvedValue({})
    };

    mockContext = {
      bot: {
        imagenService: mockImagenService
      },
      config: {
        imagen: {
          enabled: true,
          defaultAspectRatio: '1:1'
        }
      }
    };

    command = new ImagineCommand(mockImagenService);
  });

  describe('constructor', () => {
    it('should have correct command properties', () => {
      expect(command.name).toBe('imagine');
      expect(command.aliases).toContain('img');
      expect(command.aliases).toContain('generate');
      expect(command.category).toBe('image');
    });

    it('should store imagenService reference', () => {
      expect(command.imagenService).toBe(mockImagenService);
    });
  });

  describe('parseArgs', () => {
    it('should parse simple prompt without options', () => {
      const result = command.parseArgs(['A', 'beautiful', 'sunset']);

      expect(result.prompt).toBe('A beautiful sunset');
      expect(result.aspectRatio).toBeNull();
    });

    it('should parse prompt with --ratio option', () => {
      const result = command.parseArgs(['A', 'sunset', '--ratio', '16:9']);

      expect(result.prompt).toBe('A sunset');
      expect(result.aspectRatio).toBe('16:9');
    });

    it('should parse prompt with -r shorthand', () => {
      const result = command.parseArgs(['A', 'sunset', '-r', '9:16']);

      expect(result.prompt).toBe('A sunset');
      expect(result.aspectRatio).toBe('9:16');
    });

    it('should handle --ratio at beginning of args', () => {
      const result = command.parseArgs(['--ratio', '16:9', 'A', 'sunset']);

      expect(result.prompt).toBe('A sunset');
      expect(result.aspectRatio).toBe('16:9');
    });

    it('should return empty prompt for empty args', () => {
      const result = command.parseArgs([]);

      expect(result.prompt).toBe('');
      expect(result.aspectRatio).toBeNull();
    });

    it('should handle ratio option without value', () => {
      const result = command.parseArgs(['A', 'sunset', '--ratio']);

      expect(result.prompt).toBe('A sunset');
      expect(result.aspectRatio).toBeNull();
    });
  });

  describe('execute', () => {
    it('should show usage if no prompt provided', async () => {
      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Usage:')
        })
      );
    });

    it('should check cooldown before generating', async () => {
      mockImagenService.isOnCooldown.mockReturnValue(true);
      mockImagenService.getRemainingCooldown.mockReturnValue(15);

      await command.execute(mockMessage, ['A', 'sunset'], mockContext);

      expect(mockImagenService.isOnCooldown).toHaveBeenCalledWith('user123');
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('cooldown')
        })
      );
    });

    it('should send typing indicator before generating', async () => {
      await command.execute(mockMessage, ['A', 'sunset'], mockContext);

      expect(mockMessage.channel.sendTyping).toHaveBeenCalled();
    });

    it('should generate image with prompt', async () => {
      await command.execute(mockMessage, ['A', 'beautiful', 'sunset'], mockContext);

      expect(mockImagenService.generateImage).toHaveBeenCalledWith(
        'A beautiful sunset',
        { aspectRatio: null, referenceImageUrl: null },
        mockMessage.author
      );
    });

    it('should generate image with custom aspect ratio', async () => {
      await command.execute(mockMessage, ['A', 'sunset', '--ratio', '16:9'], mockContext);

      expect(mockImagenService.generateImage).toHaveBeenCalledWith(
        'A sunset',
        { aspectRatio: '16:9', referenceImageUrl: null },
        mockMessage.author
      );
    });

    it('should send image as attachment on success', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      mockImagenService.generateImage.mockResolvedValue({
        success: true,
        buffer: mockBuffer,
        mimeType: 'image/png',
        prompt: 'A beautiful sunset'
      });

      await command.execute(mockMessage, ['A', 'beautiful', 'sunset'], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.arrayContaining([
            expect.objectContaining({
              attachment: mockBuffer,
              name: expect.stringMatching(/\.png$/)
            })
          ])
        })
      );
    });

    it('should include prompt in success message', async () => {
      await command.execute(mockMessage, ['A', 'sunset'], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('A beautiful sunset')
        })
      );
    });

    it('should reply with error message on failure', async () => {
      mockImagenService.generateImage.mockResolvedValue({
        success: false,
        error: 'Safety filter blocked the request'
      });

      await command.execute(mockMessage, ['Something', 'bad'], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Safety filter blocked')
        })
      );
    });

    it('should handle service not available', async () => {
      // Create command without imagenService
      const commandWithoutService = new ImagineCommand(null);
      const contextWithoutService = { bot: {}, config: mockContext.config };

      await commandWithoutService.execute(mockMessage, ['A', 'sunset'], contextWithoutService);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not available')
        })
      );
    });
  });

  describe('getFileExtension', () => {
    it('should return png for image/png', () => {
      expect(command.getFileExtension('image/png')).toBe('png');
    });

    it('should return jpg for image/jpeg', () => {
      expect(command.getFileExtension('image/jpeg')).toBe('jpg');
    });

    it('should return webp for image/webp', () => {
      expect(command.getFileExtension('image/webp')).toBe('webp');
    });

    it('should default to png for unknown types', () => {
      expect(command.getFileExtension('image/unknown')).toBe('png');
    });
  });

  describe('generateFilename', () => {
    it('should generate filename with timestamp', () => {
      const filename = command.generateFilename('png');

      expect(filename).toMatch(/^imagine_\d+\.png$/);
    });

    it('should use provided extension', () => {
      const filename = command.generateFilename('jpg');

      expect(filename).toMatch(/\.jpg$/);
    });
  });

  describe('reference image support', () => {
    describe('parseArgs with image URL', () => {
      it('should extract image URL from prompt', () => {
        const result = command.parseArgs(
          ['Make', 'this', 'look', 'like', 'a', 'painting', 'https://example.com/photo.png'],
          mockImagenService
        );

        expect(result.prompt).toBe('Make this look like a painting');
        expect(result.referenceImageUrl).toBe('https://example.com/photo.png');
      });

      it('should handle image URL at the beginning', () => {
        const result = command.parseArgs(
          ['https://example.com/image.jpg', 'Turn', 'into', 'watercolor'],
          mockImagenService
        );

        expect(result.prompt).toBe('Turn into watercolor');
        expect(result.referenceImageUrl).toBe('https://example.com/image.jpg');
      });

      it('should handle image URL in the middle', () => {
        const result = command.parseArgs(
          ['Edit', 'https://example.com/photo.jpeg', 'to', 'add', 'sunset'],
          mockImagenService
        );

        expect(result.prompt).toBe('Edit to add sunset');
        expect(result.referenceImageUrl).toBe('https://example.com/photo.jpeg');
      });

      it('should handle prompt without image URL', () => {
        const result = command.parseArgs(
          ['A', 'beautiful', 'sunset'],
          mockImagenService
        );

        expect(result.prompt).toBe('A beautiful sunset');
        expect(result.referenceImageUrl).toBeNull();
      });

      it('should ignore non-image URLs', () => {
        const result = command.parseArgs(
          ['A', 'website', 'like', 'https://example.com/page.html'],
          mockImagenService
        );

        expect(result.prompt).toBe('A website like https://example.com/page.html');
        expect(result.referenceImageUrl).toBeNull();
      });

      it('should handle both image URL and aspect ratio', () => {
        const result = command.parseArgs(
          ['https://example.com/photo.png', 'Make', 'darker', '--ratio', '16:9'],
          mockImagenService
        );

        expect(result.prompt).toBe('Make darker');
        expect(result.referenceImageUrl).toBe('https://example.com/photo.png');
        expect(result.aspectRatio).toBe('16:9');
      });
    });

    describe('execute with reference image', () => {
      it('should pass reference image URL to generateImage', async () => {
        await command.execute(
          mockMessage,
          ['https://example.com/photo.png', 'Make', 'this', 'a', 'painting'],
          mockContext
        );

        expect(mockImagenService.generateImage).toHaveBeenCalledWith(
          'Make this a painting',
          expect.objectContaining({
            referenceImageUrl: 'https://example.com/photo.png'
          }),
          mockMessage.author
        );
      });
    });
  });
});
