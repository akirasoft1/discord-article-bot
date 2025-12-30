// __tests__/handlers/ImageRetryHandler.test.js
// TDD tests for ImageRetryHandler

const ImageRetryHandler = require('../../handlers/ImageRetryHandler');

// Mock the logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('ImageRetryHandler', () => {
  let handler;
  let mockImagenService;
  let mockImagePromptAnalyzerService;
  let mockMessage;
  let mockUser;

  beforeEach(() => {
    jest.clearAllMocks();

    mockImagenService = {
      generateImage: jest.fn().mockResolvedValue({
        success: true,
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/png',
        prompt: 'test prompt'
      })
    };

    mockImagePromptAnalyzerService = {
      analyzeFailedPrompt: jest.fn().mockResolvedValue({
        failureType: 'safety',
        analysis: 'The prompt was blocked due to safety concerns.',
        suggestedPrompts: [
          'A serene landscape with soft lighting',
          'An abstract art piece with bold colors',
          'A peaceful nature scene'
        ],
        confidence: 0.85
      }),
      formatAnalysisForEmbed: jest.fn().mockReturnValue({
        title: 'Image Generation: Safety Filter Blocked',
        description: 'I analyzed why your image generation failed.',
        color: 0xED4245,
        fields: [
          { name: 'Analysis', value: 'Safety concerns', inline: false },
          { name: 'Suggested Prompts', value: '1️⃣ Prompt A\n2️⃣ Prompt B', inline: false }
        ],
        footer: { text: 'React with a number to retry' }
      }),
      recordFailureAnalysis: jest.fn().mockResolvedValue({ success: true, id: 'analysis-123' }),
      updateRetryAttempt: jest.fn().mockResolvedValue({ success: true })
    };

    mockMessage = {
      id: 'msg-123',
      channel: {
        id: 'channel-456',
        send: jest.fn().mockResolvedValue({
          id: 'embed-msg-789',
          react: jest.fn().mockResolvedValue(true)
        })
      },
      guild: { id: 'guild-789' },
      reply: jest.fn().mockResolvedValue({ id: 'reply-123' })
    };

    mockUser = {
      id: 'user-123',
      username: 'TestUser',
      tag: 'TestUser#1234'
    };

    handler = new ImageRetryHandler(mockImagenService, mockImagePromptAnalyzerService);
  });

  describe('constructor', () => {
    it('should initialize with required services', () => {
      expect(handler.imagenService).toBe(mockImagenService);
      expect(handler.analyzerService).toBe(mockImagePromptAnalyzerService);
      expect(handler.pendingRetries).toBeInstanceOf(Map);
    });
  });

  describe('handleFailedGeneration', () => {
    const failureContext = {
      type: 'safety',
      originalPrompt: 'Inappropriate content',
      details: { finishReason: 'SAFETY' }
    };

    it('should analyze the failed prompt', async () => {
      await handler.handleFailedGeneration(
        mockMessage,
        'Inappropriate content',
        failureContext,
        mockUser
      );

      expect(mockImagePromptAnalyzerService.analyzeFailedPrompt).toHaveBeenCalledWith(
        'Inappropriate content',
        expect.any(String),
        failureContext
      );
    });

    it('should send an embed with suggestions', async () => {
      await handler.handleFailedGeneration(
        mockMessage,
        'Inappropriate content',
        failureContext,
        mockUser
      );

      expect(mockMessage.channel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array)
        })
      );
    });

    it('should add reactions for each suggested prompt', async () => {
      const embedMessage = {
        id: 'embed-123',
        react: jest.fn().mockResolvedValue(true)
      };
      mockMessage.channel.send.mockResolvedValue(embedMessage);

      await handler.handleFailedGeneration(
        mockMessage,
        'Test prompt',
        failureContext,
        mockUser
      );

      // Should add 1️⃣, 2️⃣, 3️⃣ for 3 suggestions, plus ❌
      expect(embedMessage.react).toHaveBeenCalledTimes(4);
      expect(embedMessage.react).toHaveBeenCalledWith('1️⃣');
      expect(embedMessage.react).toHaveBeenCalledWith('2️⃣');
      expect(embedMessage.react).toHaveBeenCalledWith('3️⃣');
      expect(embedMessage.react).toHaveBeenCalledWith('❌');
    });

    it('should store pending retry information', async () => {
      const embedMessage = {
        id: 'embed-123',
        react: jest.fn().mockResolvedValue(true)
      };
      mockMessage.channel.send.mockResolvedValue(embedMessage);

      await handler.handleFailedGeneration(
        mockMessage,
        'Test prompt',
        failureContext,
        mockUser
      );

      expect(handler.pendingRetries.has('embed-123')).toBe(true);
      const pendingData = handler.pendingRetries.get('embed-123');
      expect(pendingData.userId).toBe('user-123');
      expect(pendingData.originalPrompt).toBe('Test prompt');
      expect(pendingData.suggestedPrompts).toHaveLength(3);
    });

    it('should set a timeout to clean up pending retry', async () => {
      jest.useFakeTimers();

      const embedMessage = {
        id: 'embed-123',
        react: jest.fn().mockResolvedValue(true)
      };
      mockMessage.channel.send.mockResolvedValue(embedMessage);

      await handler.handleFailedGeneration(
        mockMessage,
        'Test prompt',
        failureContext,
        mockUser
      );

      expect(handler.pendingRetries.has('embed-123')).toBe(true);

      // Fast-forward 60 seconds
      jest.advanceTimersByTime(60000);

      expect(handler.pendingRetries.has('embed-123')).toBe(false);

      jest.useRealTimers();
    });

    it('should record failure analysis in database', async () => {
      const embedMessage = {
        id: 'embed-123',
        react: jest.fn().mockResolvedValue(true)
      };
      mockMessage.channel.send.mockResolvedValue(embedMessage);

      await handler.handleFailedGeneration(
        mockMessage,
        'Test prompt',
        failureContext,
        mockUser
      );

      expect(mockImagePromptAnalyzerService.recordFailureAnalysis).toHaveBeenCalledWith(
        'Test prompt',
        expect.any(Object),
        'user-123',
        'channel-456',
        expect.objectContaining({ guildId: 'guild-789' })
      );
    });

    it('should handle analysis errors gracefully', async () => {
      mockImagePromptAnalyzerService.analyzeFailedPrompt.mockRejectedValue(new Error('Analysis failed'));

      await expect(
        handler.handleFailedGeneration(mockMessage, 'Test', failureContext, mockUser)
      ).resolves.not.toThrow();

      // Should still try to send a message
      expect(mockMessage.channel.send).toHaveBeenCalled();
    });
  });

  describe('handleRetryReaction', () => {
    let mockReaction;
    let pendingData;

    beforeEach(() => {
      // Set up pending retry
      pendingData = {
        userId: 'user-123',
        originalPrompt: 'Original prompt',
        suggestedPrompts: ['Suggestion A', 'Suggestion B', 'Suggestion C'],
        channelId: 'channel-456',
        messageId: 'embed-123',
        analysisId: 'analysis-123'
      };
      handler.pendingRetries.set('embed-123', pendingData);

      mockReaction = {
        message: {
          id: 'embed-123',
          channel: {
            id: 'channel-456',
            send: jest.fn().mockResolvedValue({ id: 'new-msg' }),
            sendTyping: jest.fn().mockResolvedValue(true)
          },
          delete: jest.fn().mockResolvedValue(true)
        },
        emoji: { name: '1️⃣' }
      };
    });

    it('should generate image with selected suggestion', async () => {
      await handler.handleRetryReaction(mockReaction, mockUser);

      expect(mockImagenService.generateImage).toHaveBeenCalledWith(
        'Suggestion A',
        {},
        mockUser
      );
    });

    it('should select correct prompt based on reaction', async () => {
      mockReaction.emoji.name = '2️⃣';
      await handler.handleRetryReaction(mockReaction, mockUser);

      expect(mockImagenService.generateImage).toHaveBeenCalledWith(
        'Suggestion B',
        {},
        mockUser
      );
    });

    it('should dismiss on ❌ reaction', async () => {
      mockReaction.emoji.name = '❌';
      await handler.handleRetryReaction(mockReaction, mockUser);

      expect(mockImagenService.generateImage).not.toHaveBeenCalled();
      expect(handler.pendingRetries.has('embed-123')).toBe(false);
    });

    it('should only allow the original user to react', async () => {
      const differentUser = { id: 'different-user', username: 'Other' };
      await handler.handleRetryReaction(mockReaction, differentUser);

      expect(mockImagenService.generateImage).not.toHaveBeenCalled();
    });

    it('should remove pending retry after successful generation', async () => {
      await handler.handleRetryReaction(mockReaction, mockUser);

      expect(handler.pendingRetries.has('embed-123')).toBe(false);
    });

    it('should update analysis record with retry result', async () => {
      await handler.handleRetryReaction(mockReaction, mockUser);

      expect(mockImagePromptAnalyzerService.updateRetryAttempt).toHaveBeenCalledWith(
        'analysis-123',
        'Suggestion A',
        true
      );
    });

    it('should send success message on successful retry', async () => {
      await handler.handleRetryReaction(mockReaction, mockUser);

      expect(mockReaction.message.channel.send).toHaveBeenCalled();
    });

    it('should handle retry failure gracefully', async () => {
      mockImagenService.generateImage.mockResolvedValue({
        success: false,
        error: 'Still blocked'
      });

      await handler.handleRetryReaction(mockReaction, mockUser);

      expect(mockImagePromptAnalyzerService.updateRetryAttempt).toHaveBeenCalledWith(
        'analysis-123',
        'Suggestion A',
        false
      );
    });

    it('should ignore reactions on non-pending messages', async () => {
      mockReaction.message.id = 'unknown-msg';
      await handler.handleRetryReaction(mockReaction, mockUser);

      expect(mockImagenService.generateImage).not.toHaveBeenCalled();
    });
  });

  describe('isPendingRetry', () => {
    it('should return true for pending retry messages', () => {
      handler.pendingRetries.set('msg-123', { userId: 'user-123' });
      expect(handler.isPendingRetry('msg-123')).toBe(true);
    });

    it('should return false for non-pending messages', () => {
      expect(handler.isPendingRetry('unknown-msg')).toBe(false);
    });
  });

  describe('cleanupExpiredRetries', () => {
    it('should remove retries older than timeout', () => {
      const oldTime = Date.now() - 120000; // 2 minutes ago
      handler.pendingRetries.set('old-msg', { userId: 'user-1', createdAt: oldTime });
      handler.pendingRetries.set('new-msg', { userId: 'user-2', createdAt: Date.now() });

      handler.cleanupExpiredRetries();

      expect(handler.pendingRetries.has('old-msg')).toBe(false);
      expect(handler.pendingRetries.has('new-msg')).toBe(true);
    });
  });
});
