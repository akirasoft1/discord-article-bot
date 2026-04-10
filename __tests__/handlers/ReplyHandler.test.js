// __tests__/handlers/ReplyHandler.test.js
const ReplyHandler = require('../../handlers/ReplyHandler');

// Mock the logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Personality manager no longer used by ReplyHandler (personality detection removed)

describe('ReplyHandler', () => {
  let replyHandler;
  let mockChatService;
  let mockSummarizationService;
  let mockOpenAIClient;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockChatService = {
      chat: jest.fn().mockResolvedValue({
        success: true,
        message: 'Test response',
        personality: {
          id: 'channel-voice',
          name: 'Channel Voice',
          emoji: '🗣️'
        },
        tokens: { input: 100, output: 50, total: 150 }
      })
    };

    mockSummarizationService = {
      mongoService: {
        recordTokenUsage: jest.fn().mockResolvedValue(true)
      }
    };

    mockOpenAIClient = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: 'Test AI response',
          usage: { input_tokens: 100, output_tokens: 50 }
        })
      }
    };

    mockConfig = {
      openai: {
        model: 'gpt-5.1'
      }
    };

    replyHandler = new ReplyHandler(
      mockChatService,
      mockSummarizationService,
      mockOpenAIClient,
      mockConfig
    );
  });

  describe('isSummarizationMessage', () => {
    it('should detect summarization message with Reading Time', () => {
      const content = '**Article**\n\nSummary.\n\n**Reading Time:** 5 min | **Topic:** Tech';
      expect(replyHandler.isSummarizationMessage(content)).toBe(true);
    });

    it('should detect summarization message with Archived Version', () => {
      const content = '**Article**\n\nSummary.\n\n**Archived Version:** <https://example.com/archive>';
      expect(replyHandler.isSummarizationMessage(content)).toBe(true);
    });

    it('should detect summarization message with Source Rating', () => {
      const content = '**Article**\n\nSummary.\n\n**Source Rating:** ⭐⭐⭐⭐';
      expect(replyHandler.isSummarizationMessage(content)).toBe(true);
    });

    it('should return false for personality messages', () => {
      const content = '🕵️ **Jack Shadows**\n\nThe rain fell like memories.';
      expect(replyHandler.isSummarizationMessage(content)).toBe(false);
    });

    it('should return false for plain messages', () => {
      const content = 'Just a regular message without any special formatting.';
      expect(replyHandler.isSummarizationMessage(content)).toBe(false);
    });
  });

  describe('extractArticleUrl', () => {
    it('should extract URL from Original field', () => {
      const content = '**Article**\n\nSummary.\n\n**Original:** <https://example.com/article>';
      const url = replyHandler.extractArticleUrl(content);
      expect(url).toBe('https://example.com/article');
    });

    it('should extract URL from Archived Version field', () => {
      const content = '**Article**\n\nSummary.\n\n**Archived Version:** <https://archive.example.com/123>';
      const url = replyHandler.extractArticleUrl(content);
      expect(url).toBe('https://archive.example.com/123');
    });

    it('should extract any URL as fallback', () => {
      const content = 'Check out this article: https://example.com/news';
      const url = replyHandler.extractArticleUrl(content);
      expect(url).toBe('https://example.com/news');
    });

    it('should return null when no URL found', () => {
      const content = 'This message has no URLs.';
      const url = replyHandler.extractArticleUrl(content);
      expect(url).toBeNull();
    });
  });

  describe('extractSummaryText', () => {
    it('should extract summary from standard format', () => {
      const content = '**Article Title**\n\nThis is the summary text.\n\n**Archived Version:** <https://example.com>';
      const summary = replyHandler.extractSummaryText(content);
      expect(summary).toBe('This is the summary text.');
    });

    it('should extract multi-line summary', () => {
      const content = '**Article Title**\n\nFirst paragraph of summary.\nSecond line of summary.\n\n**Reading Time:** 5 min';
      const summary = replyHandler.extractSummaryText(content);
      expect(summary).toContain('First paragraph');
      expect(summary).toContain('Second line');
    });
  });

  describe('handleReply', () => {
    let mockMessage;
    let mockReferencedMessage;

    beforeEach(() => {
      mockMessage = {
        content: 'Continue the story!',
        author: {
          id: 'user123',
          username: 'TestUser',
          tag: 'TestUser#1234',
          bot: false
        },
        channel: {
          id: 'channel123',
          send: jest.fn().mockResolvedValue({}),
          sendTyping: jest.fn().mockResolvedValue({})
        },
        guild: { id: 'guild456' },
        reply: jest.fn().mockResolvedValue({})
      };

      mockReferencedMessage = {
        author: { bot: true },
        content: 'Just a regular bot message.'
      };
    });

    it('should return false if referenced message is not from bot', async () => {
      mockReferencedMessage.author.bot = false;
      const result = await replyHandler.handleReply(mockMessage, mockReferencedMessage);
      expect(result).toBe(false);
    });

    it('should handle summarization follow-up reply', async () => {
      mockReferencedMessage.content = '**Article Title**\n\nGreat summary here.\n\n**Original:** <https://example.com/article>\n\n**Reading Time:** 5 min';

      const result = await replyHandler.handleReply(mockMessage, mockReferencedMessage);

      expect(result).toBe(true);
      expect(mockOpenAIClient.responses.create).toHaveBeenCalled();
      expect(mockMessage.reply).toHaveBeenCalled();
    });

    it('should return false for unrecognized message types', async () => {
      mockReferencedMessage.content = 'Just a plain bot message without any special formatting.';

      const result = await replyHandler.handleReply(mockMessage, mockReferencedMessage);

      expect(result).toBe(false);
    });
  });

  describe('handleSummarizationReply', () => {
    let mockMessage;
    const originalContent = '**Article Title**\n\nThis is a great summary of the article.\n\n**Original:** <https://example.com/article>\n\n**Reading Time:** 5 min';

    beforeEach(() => {
      mockMessage = {
        content: 'What are the main points?',
        author: {
          id: 'user123',
          username: 'TestUser',
          tag: 'TestUser#1234'
        },
        channel: {
          send: jest.fn().mockResolvedValue({}),
          sendTyping: jest.fn().mockResolvedValue({})
        },
        reply: jest.fn().mockResolvedValue({})
      };
    });

    it('should call OpenAI with summary context', async () => {
      await replyHandler.handleSummarizationReply(mockMessage, originalContent);

      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5.1',
          instructions: expect.stringContaining('This is a great summary'),
          input: 'What are the main points?'
        })
      );
    });

    it('should include article URL in context', async () => {
      await replyHandler.handleSummarizationReply(mockMessage, originalContent);

      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs.instructions).toContain('https://example.com/article');
    });

    it('should format response with Follow-up Answer header', async () => {
      await replyHandler.handleSummarizationReply(mockMessage, originalContent);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('**Follow-up Answer:**')
        })
      );
    });

    it('should record token usage', async () => {
      await replyHandler.handleSummarizationReply(mockMessage, originalContent);

      expect(mockSummarizationService.mongoService.recordTokenUsage).toHaveBeenCalledWith(
        'user123',
        'TestUser#1234',
        100,
        50,
        'summarize_followup',
        'gpt-5.1'
      );
    });
  });

  describe('splitMessage', () => {
    it('should not split short messages', () => {
      const text = 'Short message';
      const chunks = replyHandler.splitMessage(text, 2000);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('should split long messages at newlines', () => {
      const line = 'A'.repeat(100) + '\n';
      const text = line.repeat(25); // 2525 chars
      const chunks = replyHandler.splitMessage(text, 2000);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should split at spaces when no newlines', () => {
      const text = 'word '.repeat(500); // 2500 chars
      const chunks = replyHandler.splitMessage(text, 2000);
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('isImageGenerationMessage', () => {
    it('should detect image generation message with Prompt prefix', () => {
      const content = '**Prompt:** A beautiful sunset over mountains';
      const attachments = [{ contentType: 'image/png' }];
      expect(replyHandler.isImageGenerationMessage(content, attachments)).toBe(true);
    });

    it('should detect image generation message with image attachment', () => {
      const content = '**Prompt:** A cyberpunk city at night';
      const attachments = [{ contentType: 'image/jpeg' }];
      expect(replyHandler.isImageGenerationMessage(content, attachments)).toBe(true);
    });

    it('should return false without Prompt prefix', () => {
      const content = 'Just a regular message with an image';
      const attachments = [{ contentType: 'image/png' }];
      expect(replyHandler.isImageGenerationMessage(content, attachments)).toBe(false);
    });

    it('should return false without image attachment', () => {
      const content = '**Prompt:** A beautiful sunset';
      const attachments = [];
      expect(replyHandler.isImageGenerationMessage(content, attachments)).toBe(false);
    });

    it('should return false for personality messages with Prompt-like content', () => {
      const content = '🕵️ **Jack Shadows**\n\n**Prompt:** I need you to find something.';
      const attachments = [];
      expect(replyHandler.isImageGenerationMessage(content, attachments)).toBe(false);
    });

    it('should handle webp image attachments', () => {
      const content = '**Prompt:** An abstract art piece';
      const attachments = [{ contentType: 'image/webp' }];
      expect(replyHandler.isImageGenerationMessage(content, attachments)).toBe(true);
    });
  });

  describe('extractOriginalPrompt', () => {
    it('should extract prompt from standard format', () => {
      const content = '**Prompt:** A beautiful sunset over mountains';
      expect(replyHandler.extractOriginalPrompt(content)).toBe('A beautiful sunset over mountains');
    });

    it('should extract prompt with special characters', () => {
      const content = '**Prompt:** A "cyberpunk" city at night, neon lights & rain';
      expect(replyHandler.extractOriginalPrompt(content)).toBe('A "cyberpunk" city at night, neon lights & rain');
    });

    it('should return null for messages without Prompt prefix', () => {
      const content = 'Just a regular message';
      expect(replyHandler.extractOriginalPrompt(content)).toBeNull();
    });

    it('should handle multi-line prompts (take first line only)', () => {
      const content = '**Prompt:** A sunset over mountains\nSome other text on another line';
      expect(replyHandler.extractOriginalPrompt(content)).toBe('A sunset over mountains');
    });

    it('should trim whitespace from extracted prompt', () => {
      const content = '**Prompt:**   A sunset with extra spaces   ';
      expect(replyHandler.extractOriginalPrompt(content)).toBe('A sunset with extra spaces');
    });
  });

  describe('handleImageReply', () => {
    let mockMessage;
    let mockImagenService;
    const originalPrompt = 'A beautiful sunset over mountains';

    beforeEach(() => {
      mockImagenService = {
        generateImage: jest.fn().mockResolvedValue({
          success: true,
          buffer: Buffer.from('fake-image-data'),
          mimeType: 'image/png'
        })
      };

      // Inject the imagenService into the handler
      replyHandler.imagenService = mockImagenService;

      mockMessage = {
        content: 'Make it more colorful and add some birds',
        author: {
          id: 'user123',
          username: 'TestUser',
          tag: 'TestUser#1234'
        },
        channel: {
          id: 'channel123',
          send: jest.fn().mockResolvedValue({}),
          sendTyping: jest.fn().mockResolvedValue({})
        },
        guild: { id: 'guild456' },
        reply: jest.fn().mockResolvedValue({})
      };
    });

    it('should call OpenAI to generate enhanced prompt', async () => {
      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: expect.stringContaining('image generation prompt'),
          input: expect.stringContaining(originalPrompt)
        })
      );
    });

    it('should include user feedback in prompt generation', async () => {
      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs.input).toContain('Make it more colorful');
    });

    it('should instruct AI not to include aspect ratio in enhanced prompt', async () => {
      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs.instructions.toLowerCase()).toMatch(/aspect ratio/i);
      expect(callArgs.instructions.toLowerCase()).toMatch(/do not|don't|never|exclude|omit|avoid/i);
    });

    it('should call ImagenService with enhanced prompt', async () => {
      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: 'A beautiful colorful sunset over mountains with birds flying',
        usage: { input_tokens: 50, output_tokens: 20 }
      });

      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      expect(mockImagenService.generateImage).toHaveBeenCalledWith(
        'A beautiful colorful sunset over mountains with birds flying',
        expect.any(Object),
        expect.objectContaining({ id: 'user123' })
      );
    });

    it('should send regenerated image to channel', async () => {
      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: 'Enhanced prompt here',
        usage: { input_tokens: 50, output_tokens: 20 }
      });

      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.arrayContaining([
            expect.objectContaining({
              name: expect.stringContaining('.png')
            })
          ])
        })
      );
    });

    it('should include the enhanced prompt in response', async () => {
      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: 'Enhanced sunset with birds',
        usage: { input_tokens: 50, output_tokens: 20 }
      });

      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('**Prompt:**')
        })
      );
    });

    it('should strip aspect ratio directives from AI-enhanced prompt before calling generateImage', async () => {
      // Simulate the AI returning a prompt that includes aspect ratio info
      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: 'A beautiful sunset over mountains in 3:2 aspect ratio with dramatic clouds',
        usage: { input_tokens: 50, output_tokens: 20 }
      });

      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      const generatedPrompt = mockImagenService.generateImage.mock.calls[0][0];
      // Should not contain aspect ratio patterns like "3:2", "16:9", "aspect ratio"
      expect(generatedPrompt).not.toMatch(/\b\d+:\d+\b.*aspect|aspect.*\b\d+:\d+\b/i);
    });

    it('should pass isAdmin true for admin users when generating image', async () => {
      // Configure admin user IDs in config
      replyHandler.config.discord = { adminUserIds: ['user123'] };

      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: 'Enhanced prompt here',
        usage: { input_tokens: 50, output_tokens: 20 }
      });

      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      const options = mockImagenService.generateImage.mock.calls[0][1];
      expect(options.isAdmin).toBe(true);
    });

    it('should pass isAdmin false for non-admin users when generating image', async () => {
      replyHandler.config.discord = { adminUserIds: ['otheradmin999'] };

      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: 'Enhanced prompt here',
        usage: { input_tokens: 50, output_tokens: 20 }
      });

      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      const options = mockImagenService.generateImage.mock.calls[0][1];
      expect(options.isAdmin).toBe(false);
    });

    it('should handle missing discord config gracefully for admin check', async () => {
      // Config without discord section
      replyHandler.config = { openai: { model: 'gpt-5.1' } };

      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: 'Enhanced prompt here',
        usage: { input_tokens: 50, output_tokens: 20 }
      });

      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      const options = mockImagenService.generateImage.mock.calls[0][1];
      expect(options.isAdmin).toBe(false);
    });

    it('should handle image generation failure gracefully', async () => {
      mockOpenAIClient.responses.create.mockResolvedValue({
        output_text: 'Enhanced prompt',
        usage: { input_tokens: 50, output_tokens: 20 }
      });
      mockImagenService.generateImage.mockResolvedValue({
        success: false,
        error: 'Content blocked by safety filter'
      });

      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to regenerate')
        })
      );
    });

    it('should handle prompt enhancement failure gracefully', async () => {
      mockOpenAIClient.responses.create.mockRejectedValue(new Error('API Error'));

      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('error')
        })
      );
    });

    it('should show typing indicator while processing', async () => {
      await replyHandler.handleImageReply(mockMessage, originalPrompt);

      expect(mockMessage.channel.sendTyping).toHaveBeenCalled();
    });
  });

  describe('handleReply with image generation messages', () => {
    let mockMessage;
    let mockReferencedMessage;
    let mockImagenService;

    beforeEach(() => {
      mockImagenService = {
        generateImage: jest.fn().mockResolvedValue({
          success: true,
          buffer: Buffer.from('fake-image-data'),
          mimeType: 'image/png'
        })
      };

      replyHandler.imagenService = mockImagenService;

      mockMessage = {
        content: 'Add some clouds',
        author: {
          id: 'user123',
          username: 'TestUser',
          tag: 'TestUser#1234',
          bot: false
        },
        channel: {
          id: 'channel123',
          send: jest.fn().mockResolvedValue({}),
          sendTyping: jest.fn().mockResolvedValue({})
        },
        guild: { id: 'guild456' },
        reply: jest.fn().mockResolvedValue({})
      };

      mockReferencedMessage = {
        author: { bot: true },
        content: '**Prompt:** A sunset over mountains',
        attachments: {
          size: 1,
          first: () => ({ contentType: 'image/png' }),
          map: (fn) => [fn({ contentType: 'image/png' })]
        }
      };
    });

    it('should handle reply to image generation message', async () => {
      const result = await replyHandler.handleReply(mockMessage, mockReferencedMessage);

      expect(result).toBe(true);
      expect(mockOpenAIClient.responses.create).toHaveBeenCalled();
      expect(mockImagenService.generateImage).toHaveBeenCalled();
    });

  });
});
