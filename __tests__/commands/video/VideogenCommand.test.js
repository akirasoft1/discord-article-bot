// __tests__/commands/video/VideogenCommand.test.js
const VideogenCommand = require('../../../commands/video/VideogenCommand');

// Mock the logger
jest.mock('../../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('VideogenCommand', () => {
  let command;
  let mockVeoService;
  let mockMessage;
  let mockContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockVeoService = {
      validatePrompt: jest.fn().mockReturnValue({ valid: true }),
      validateAspectRatio: jest.fn().mockReturnValue({ valid: true }),
      validateDuration: jest.fn().mockReturnValue({ valid: true }),
      generateVideo: jest.fn().mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-video-data'),
        prompt: 'A flower blooming',
        duration: 8,
        aspectRatio: '16:9'
      }),
      isOnCooldown: jest.fn().mockReturnValue(false),
      getRemainingCooldown: jest.fn().mockReturnValue(0),
      getValidAspectRatios: jest.fn().mockReturnValue(['16:9', '9:16']),
      getValidDurations: jest.fn().mockReturnValue([4, 6, 8]),
      isImageUrl: jest.fn().mockImplementation(url => {
        return url && (url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.jpeg'));
      }),
      extractDiscordAssetUrl: jest.fn().mockImplementation(str => {
        // Match custom emoji format: <:name:id> (not animated)
        const emojiMatch = str.match(/^<:(\w+):(\d+)>$/);
        if (emojiMatch) {
          const id = emojiMatch[2];
          return `https://cdn.discordapp.com/emojis/${id}.png?size=256`;
        }
        // Match raw snowflake ID
        if (/^\d{17,19}$/.test(str)) {
          return `https://cdn.discordapp.com/emojis/${str}.png?size=256`;
        }
        return null;
      })
    };

    mockMessage = {
      author: { id: 'user123', username: 'TestUser', tag: 'TestUser#1234' },
      channel: {
        send: jest.fn().mockResolvedValue({}),
        sendTyping: jest.fn().mockResolvedValue({})
      },
      reply: jest.fn().mockResolvedValue({}),
      edit: jest.fn().mockResolvedValue({})
    };

    mockContext = {
      bot: {
        veoService: mockVeoService
      },
      config: {
        veo: {
          enabled: true,
          defaultDuration: 8,
          defaultAspectRatio: '16:9'
        }
      }
    };

    command = new VideogenCommand(mockVeoService);
  });

  describe('constructor', () => {
    it('should have correct command properties', () => {
      expect(command.name).toBe('videogen');
      expect(command.aliases).toContain('vg');
      expect(command.aliases).toContain('veo');
      expect(command.aliases).toContain('video');
      expect(command.category).toBe('video');
    });

    it('should store veoService reference', () => {
      expect(command.veoService).toBe(mockVeoService);
    });
  });

  describe('parseArgs', () => {
    it('should parse two URLs and prompt', () => {
      const result = command.parseArgs(
        ['https://example.com/first.png', 'https://example.com/last.png', 'A', 'flower', 'blooming'],
        mockVeoService
      );

      expect(result.firstFrameUrl).toBe('https://example.com/first.png');
      expect(result.lastFrameUrl).toBe('https://example.com/last.png');
      expect(result.prompt).toBe('A flower blooming');
      expect(result.duration).toBeNull();
      expect(result.aspectRatio).toBeNull();
    });

    it('should parse with --duration option', () => {
      const result = command.parseArgs(
        ['https://example.com/first.png', 'https://example.com/last.png', 'Transition', '--duration', '6'],
        mockVeoService
      );

      expect(result.prompt).toBe('Transition');
      expect(result.duration).toBe('6');
    });

    it('should parse with -d shorthand', () => {
      const result = command.parseArgs(
        ['https://example.com/first.png', 'https://example.com/last.png', 'Transition', '-d', '4'],
        mockVeoService
      );

      expect(result.duration).toBe('4');
    });

    it('should parse with --ratio option', () => {
      const result = command.parseArgs(
        ['https://example.com/first.png', 'https://example.com/last.png', 'Transition', '--ratio', '9:16'],
        mockVeoService
      );

      expect(result.aspectRatio).toBe('9:16');
    });

    it('should parse with -r shorthand', () => {
      const result = command.parseArgs(
        ['https://example.com/first.png', 'https://example.com/last.png', 'Transition', '-r', '16:9'],
        mockVeoService
      );

      expect(result.aspectRatio).toBe('16:9');
    });

    it('should handle both duration and ratio options', () => {
      const result = command.parseArgs(
        ['https://example.com/first.png', 'https://example.com/last.png', 'Transition', '-d', '6', '-r', '9:16'],
        mockVeoService
      );

      expect(result.duration).toBe('6');
      expect(result.aspectRatio).toBe('9:16');
    });

    it('should handle URLs at different positions', () => {
      const result = command.parseArgs(
        ['https://example.com/first.png', 'A', 'flower', 'https://example.com/last.png', 'blooming'],
        mockVeoService
      );

      expect(result.firstFrameUrl).toBe('https://example.com/first.png');
      expect(result.lastFrameUrl).toBe('https://example.com/last.png');
      expect(result.prompt).toBe('A flower blooming');
    });

    it('should return single image URL when only one image provided', () => {
      const result = command.parseArgs(
        ['https://example.com/only.png', 'A', 'prompt'],
        mockVeoService
      );

      expect(result.firstFrameUrl).toBe('https://example.com/only.png');
      expect(result.lastFrameUrl).toBeNull();
      expect(result.prompt).toBe('A prompt');
    });

    it('should parse single image with options', () => {
      const result = command.parseArgs(
        ['https://example.com/image.png', 'Zoom', 'in', '-d', '6', '-r', '9:16'],
        mockVeoService
      );

      expect(result.firstFrameUrl).toBe('https://example.com/image.png');
      expect(result.lastFrameUrl).toBeNull();
      expect(result.prompt).toBe('Zoom in');
      expect(result.duration).toBe('6');
      expect(result.aspectRatio).toBe('9:16');
    });

    it('should handle single Discord emoji as image', () => {
      const result = command.parseArgs(
        ['<:emoji:123456789012345678>', 'Make', 'it', 'spin'],
        mockVeoService
      );

      expect(result.firstFrameUrl).toBe('https://cdn.discordapp.com/emojis/123456789012345678.png?size=256');
      expect(result.lastFrameUrl).toBeNull();
      expect(result.prompt).toBe('Make it spin');
    });

    it('should return empty values for empty args', () => {
      const result = command.parseArgs([], mockVeoService);

      expect(result.firstFrameUrl).toBeNull();
      expect(result.lastFrameUrl).toBeNull();
      expect(result.prompt).toBe('');
    });

    it('should handle Discord emojis as frame images', () => {
      const result = command.parseArgs(
        ['<:emoji1:123456789012345678>', '<:emoji2:987654321098765432>', 'Transform'],
        mockVeoService
      );

      expect(result.firstFrameUrl).toBe('https://cdn.discordapp.com/emojis/123456789012345678.png?size=256');
      expect(result.lastFrameUrl).toBe('https://cdn.discordapp.com/emojis/987654321098765432.png?size=256');
      expect(result.prompt).toBe('Transform');
    });
  });

  describe('execute', () => {
    it('should show usage if no images provided', async () => {
      await command.execute(mockMessage, ['just', 'a', 'prompt'], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Usage:')
        })
      );
    });

    it('should show usage if no prompt provided with single image', async () => {
      await command.execute(
        mockMessage,
        ['https://example.com/image.png'],
        mockContext
      );

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Usage:')
        })
      );
    });

    it('should show usage if no prompt provided with two images', async () => {
      await command.execute(
        mockMessage,
        ['https://example.com/first.png', 'https://example.com/last.png'],
        mockContext
      );

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Usage:')
        })
      );
    });

    it('should generate video with single image (image-to-video mode)', async () => {
      await command.execute(
        mockMessage,
        ['https://example.com/image.png', 'A', 'flower', 'blooming'],
        mockContext
      );

      expect(mockVeoService.generateVideo).toHaveBeenCalledWith(
        'A flower blooming',
        'https://example.com/image.png',
        null, // lastFrameUrl should be null for single-image mode
        expect.objectContaining({
          duration: null,
          aspectRatio: null
        }),
        mockMessage.author,
        expect.any(Function)
      );
    });

    it('should generate video with single image and options', async () => {
      await command.execute(
        mockMessage,
        ['https://example.com/image.png', 'Zoom', 'out', '-d', '4', '-r', '9:16'],
        mockContext
      );

      expect(mockVeoService.generateVideo).toHaveBeenCalledWith(
        'Zoom out',
        'https://example.com/image.png',
        null,
        expect.objectContaining({
          duration: '4',
          aspectRatio: '9:16'
        }),
        mockMessage.author,
        expect.any(Function)
      );
    });

    it('should check cooldown before generating', async () => {
      mockVeoService.isOnCooldown.mockReturnValue(true);
      mockVeoService.getRemainingCooldown.mockReturnValue(45);

      await command.execute(
        mockMessage,
        ['https://example.com/first.png', 'https://example.com/last.png', 'A', 'transition'],
        mockContext
      );

      expect(mockVeoService.isOnCooldown).toHaveBeenCalledWith('user123');
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('cooldown')
        })
      );
    });

    it('should send typing indicator before generating', async () => {
      await command.execute(
        mockMessage,
        ['https://example.com/first.png', 'https://example.com/last.png', 'A', 'transition'],
        mockContext
      );

      expect(mockMessage.channel.sendTyping).toHaveBeenCalled();
    });

    it('should generate video with correct parameters', async () => {
      await command.execute(
        mockMessage,
        ['https://example.com/first.png', 'https://example.com/last.png', 'A', 'flower', 'blooming'],
        mockContext
      );

      expect(mockVeoService.generateVideo).toHaveBeenCalledWith(
        'A flower blooming',
        'https://example.com/first.png',
        'https://example.com/last.png',
        expect.objectContaining({
          duration: null,
          aspectRatio: null
        }),
        mockMessage.author,
        expect.any(Function)
      );
    });

    it('should pass duration and aspect ratio options', async () => {
      await command.execute(
        mockMessage,
        ['https://example.com/first.png', 'https://example.com/last.png', 'Transition', '-d', '6', '-r', '9:16'],
        mockContext
      );

      expect(mockVeoService.generateVideo).toHaveBeenCalledWith(
        'Transition',
        'https://example.com/first.png',
        'https://example.com/last.png',
        expect.objectContaining({
          duration: '6',
          aspectRatio: '9:16'
        }),
        mockMessage.author,
        expect.any(Function)
      );
    });

    it('should send video as attachment on success', async () => {
      const mockBuffer = Buffer.from('fake-video-data');
      mockVeoService.generateVideo.mockResolvedValue({
        success: true,
        buffer: mockBuffer,
        prompt: 'A flower blooming',
        duration: 8,
        aspectRatio: '16:9'
      });

      await command.execute(
        mockMessage,
        ['https://example.com/first.png', 'https://example.com/last.png', 'A', 'flower', 'blooming'],
        mockContext
      );

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.arrayContaining([
            expect.objectContaining({
              attachment: mockBuffer,
              name: expect.stringMatching(/\.mp4$/)
            })
          ])
        })
      );
    });

    it('should reply with error message on failure', async () => {
      mockVeoService.generateVideo.mockResolvedValue({
        success: false,
        error: 'Safety filter blocked the request'
      });

      await command.execute(
        mockMessage,
        ['https://example.com/first.png', 'https://example.com/last.png', 'Bad', 'prompt'],
        mockContext
      );

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Safety filter blocked')
        })
      );
    });

    it('should handle service not available', async () => {
      const commandWithoutService = new VideogenCommand(null);
      const contextWithoutService = { bot: {}, config: mockContext.config };

      await commandWithoutService.execute(
        mockMessage,
        ['https://example.com/first.png', 'https://example.com/last.png', 'prompt'],
        contextWithoutService
      );

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not available')
        })
      );
    });
  });

  describe('generateFilename', () => {
    it('should generate filename with timestamp', () => {
      const filename = command.generateFilename();

      expect(filename).toMatch(/^videogen_\d+\.mp4$/);
    });
  });
});
