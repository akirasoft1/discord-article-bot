// __tests__/handlers/ReplyHandler.test.js
const ReplyHandler = require('../../handlers/ReplyHandler');

// Mock the logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Mock the personality manager
jest.mock('../../personalities', () => ({
  get: jest.fn((id) => {
    const personalities = {
      'noir-detective': {
        id: 'noir-detective',
        name: 'Jack Shadows',
        emoji: '🕵️',
        description: 'A hardboiled 1940s detective',
        systemPrompt: 'You are Jack Shadows, a noir detective.'
      },
      'grumpy-historian': {
        id: 'grumpy-historian',
        name: 'Professor Grimsworth',
        emoji: '📚',
        description: 'A grumpy historian',
        systemPrompt: 'You are Professor Grimsworth.'
      }
    };
    return personalities[id] || null;
  }),
  getAll: jest.fn(() => [
    {
      id: 'noir-detective',
      name: 'Jack Shadows',
      emoji: '🕵️',
      description: 'A hardboiled 1940s detective',
      systemPrompt: 'You are Jack Shadows, a noir detective.'
    },
    {
      id: 'grumpy-historian',
      name: 'Professor Grimsworth',
      emoji: '📚',
      description: 'A grumpy historian',
      systemPrompt: 'You are Professor Grimsworth.'
    }
  ]),
  list: jest.fn(() => [
    { id: 'noir-detective', name: 'Jack Shadows', emoji: '🕵️', description: 'A hardboiled 1940s detective' },
    { id: 'grumpy-historian', name: 'Professor Grimsworth', emoji: '📚', description: 'A grumpy historian' }
  ])
}));

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
        message: 'Test response from personality',
        personality: {
          id: 'noir-detective',
          name: 'Jack Shadows',
          emoji: '🕵️'
        },
        tokens: { input: 100, output: 50, total: 150 }
      }),
      mongoService: {
        getConversationStatus: jest.fn().mockResolvedValue({ exists: false }),
        isConversationIdle: jest.fn().mockResolvedValue(false),
        recordTokenUsage: jest.fn().mockResolvedValue(true)
      }
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

  describe('detectPersonalityFromMessage', () => {
    it('should detect noir-detective from message format', () => {
      const content = '🕵️ **Jack Shadows**\n\nThe question came at me like a blonde in a red dress.';
      const result = replyHandler.detectPersonalityFromMessage(content);

      expect(result).not.toBeNull();
      expect(result.id).toBe('noir-detective');
      expect(result.name).toBe('Jack Shadows');
      expect(result.emoji).toBe('🕵️');
    });

    it('should detect grumpy-historian from message format', () => {
      const content = '📚 **Professor Grimsworth**\n\nAh yes, this reminds me of ancient Rome.';
      const result = replyHandler.detectPersonalityFromMessage(content);

      expect(result).not.toBeNull();
      expect(result.id).toBe('grumpy-historian');
      expect(result.name).toBe('Professor Grimsworth');
    });

    it('should return null for non-personality messages', () => {
      const content = 'This is just a regular message without personality formatting.';
      const result = replyHandler.detectPersonalityFromMessage(content);

      expect(result).toBeNull();
    });

    it('should return null for summarization messages', () => {
      const content = '**Article Title**\n\nSummary text here.\n\n**Reading Time:** 5 min';
      const result = replyHandler.detectPersonalityFromMessage(content);

      expect(result).toBeNull();
    });
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
        content: '🕵️ **Jack Shadows**\n\nThe rain fell like memories of a case gone cold.'
      };
    });

    it('should return false if referenced message is not from bot', async () => {
      mockReferencedMessage.author.bot = false;
      const result = await replyHandler.handleReply(mockMessage, mockReferencedMessage);
      expect(result).toBe(false);
    });

    it('should handle personality chat reply', async () => {
      const result = await replyHandler.handleReply(mockMessage, mockReferencedMessage);

      expect(result).toBe(true);
      expect(mockChatService.chat).toHaveBeenCalledWith(
        'noir-detective',
        'Continue the story!',
        mockMessage.author,
        'channel123',
        'guild456'
      );
      expect(mockMessage.reply).toHaveBeenCalled();
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

  describe('handlePersonalityChatReply', () => {
    let mockMessage;
    const personalityInfo = {
      id: 'noir-detective',
      name: 'Jack Shadows',
      emoji: '🕵️'
    };

    beforeEach(() => {
      mockMessage = {
        content: 'Tell me more about the case.',
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

    it('should continue active conversation', async () => {
      mockChatService.mongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'active'
      });

      await replyHandler.handlePersonalityChatReply(mockMessage, personalityInfo);

      expect(mockChatService.chat).toHaveBeenCalledWith(
        'noir-detective',
        'Tell me more about the case.',
        mockMessage.author,
        'channel123',
        'guild456'
      );
    });

    it('should handle expired conversation with in-character response', async () => {
      mockChatService.mongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'expired'
      });

      await replyHandler.handlePersonalityChatReply(mockMessage, personalityInfo);

      // Should call OpenAI for in-character "forgotten" response
      expect(mockOpenAIClient.responses.create).toHaveBeenCalled();
      expect(mockMessage.reply).toHaveBeenCalled();

      // Should NOT continue the conversation
      expect(mockChatService.chat).not.toHaveBeenCalled();
    });

    it('should let chatService handle idle conversations (start fresh)', async () => {
      mockChatService.mongoService.getConversationStatus.mockResolvedValue({
        exists: true,
        status: 'active'
      });
      // Note: isConversationIdle is no longer checked in ReplyHandler
      // chatService.chat() handles idle detection and starts fresh if needed

      await replyHandler.handlePersonalityChatReply(mockMessage, personalityInfo);

      // Should continue to chatService (which will handle idle internally)
      expect(mockChatService.chat).toHaveBeenCalled();
    });

    it('should format response with personality header', async () => {
      await replyHandler.handlePersonalityChatReply(mockMessage, personalityInfo);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('🕵️ **Jack Shadows**')
        })
      );
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

  describe('handleExpiredConversationReply', () => {
    let mockMessage;
    const personalityInfo = {
      id: 'noir-detective',
      name: 'Jack Shadows',
      emoji: '🕵️'
    };

    beforeEach(() => {
      mockMessage = {
        content: 'Remember what we talked about?',
        author: { id: 'user123', username: 'TestUser' },
        channel: {
          send: jest.fn().mockResolvedValue({}),
          sendTyping: jest.fn().mockResolvedValue({})
        },
        reply: jest.fn().mockResolvedValue({})
      };
    });

    it('should generate in-character forgotten response', async () => {
      await replyHandler.handleExpiredConversationReply(mockMessage, personalityInfo);

      expect(mockOpenAIClient.responses.create).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: expect.stringContaining('forgotten what you were talking about')
        })
      );
    });

    it('should include command hint in response', async () => {
      await replyHandler.handleExpiredConversationReply(mockMessage, personalityInfo);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('!chat noir-detective')
        })
      );
    });

    it('should handle OpenAI errors gracefully', async () => {
      mockOpenAIClient.responses.create.mockRejectedValue(new Error('API Error'));

      await replyHandler.handleExpiredConversationReply(mockMessage, personalityInfo);

      // Should still reply with a fallback message
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('expired')
        })
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

  describe('escapeRegex', () => {
    it('should escape special regex characters', () => {
      expect(replyHandler.escapeRegex('test.string')).toBe('test\\.string');
      expect(replyHandler.escapeRegex('test*string')).toBe('test\\*string');
      expect(replyHandler.escapeRegex('test?string')).toBe('test\\?string');
      expect(replyHandler.escapeRegex('test[string]')).toBe('test\\[string\\]');
    });

    it('should handle emojis correctly', () => {
      // Emojis don't need escaping but shouldn't break
      expect(replyHandler.escapeRegex('🕵️')).toBe('🕵️');
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

    it('should prioritize personality detection over image detection', async () => {
      // Message that looks like both personality and image
      mockReferencedMessage.content = '🕵️ **Jack Shadows**\n\nHere is the image.';
      mockReferencedMessage.attachments = {
        size: 1,
        first: () => ({ contentType: 'image/png' }),
        map: (fn) => [fn({ contentType: 'image/png' })]
      };

      const result = await replyHandler.handleReply(mockMessage, mockReferencedMessage);

      expect(result).toBe(true);
      // Should use personality chat, not image reply
      expect(mockChatService.chat).toHaveBeenCalled();
      expect(mockImagenService.generateImage).not.toHaveBeenCalled();
    });
  });
});
