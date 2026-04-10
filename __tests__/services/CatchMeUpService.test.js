// __tests__/services/CatchMeUpService.test.js

jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

const CatchMeUpService = require('../../services/CatchMeUpService');

describe('CatchMeUpService', () => {
  let service;
  let mockMongoService;
  let mockChannelContextService;
  let mockVoiceProfileService;
  let mockOpenAIClient;
  let mockConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockMongoService = {
      getUserLastSeen: jest.fn().mockResolvedValue({
        userId: 'user123',
        guildId: 'guild456',
        lastSeenAt: new Date('2026-04-08T00:00:00Z'),
        activeChannels: ['channel1', 'channel2']
      }),
      getRecentArticleSummaries: jest.fn().mockResolvedValue([
        { title: 'New AI Paper', topic: 'AI', summary: 'A paper about AI.', createdAt: new Date() },
        { title: 'Kubernetes Update', topic: 'DevOps', summary: 'K8s 1.31 released.', createdAt: new Date() }
      ]),
      getArticleTrends: jest.fn().mockResolvedValue([
        { _id: 'AI', count: 5 },
        { _id: 'DevOps', count: 3 }
      ])
    };

    mockChannelContextService = {
      getRecentContext: jest.fn().mockReturnValue(
        '[Alice]: Just deployed the new feature\n[Bob]: Nice, tests passing?'
      ),
      isChannelTracked: jest.fn().mockReturnValue(true)
    };

    mockVoiceProfileService = {
      getProfile: jest.fn().mockResolvedValue({
        voiceInstructions: 'Speak casually with tech humor.',
        vocabulary: ['ngl', 'lowkey'],
        toneKeywords: ['casual', 'witty']
      })
    };

    mockOpenAIClient = {
      responses: {
        create: jest.fn().mockResolvedValue({
          output_text: 'Hey! While you were gone: a couple AI papers dropped, Bob shipped the k8s update, and Alice has been on a deploy streak. The usual chaos.',
          usage: { input_tokens: 500, output_tokens: 100 }
        })
      }
    };

    mockConfig = {
      openai: { model: 'gpt-4.1-mini' }
    };

    service = new CatchMeUpService(
      mockMongoService,
      mockChannelContextService,
      mockVoiceProfileService,
      mockOpenAIClient,
      mockConfig
    );
  });

  describe('generateCatchUp', () => {
    it('should gather data and return a synthesized catch-up message', async () => {
      const result = await service.generateCatchUp('user123', 'guild456');

      expect(result.success).toBe(true);
      expect(result.message).toContain('While you were gone');
      expect(mockMongoService.getUserLastSeen).toHaveBeenCalledWith('user123', 'guild456');
      expect(mockMongoService.getRecentArticleSummaries).toHaveBeenCalled();
      expect(mockOpenAIClient.responses.create).toHaveBeenCalled();
    });

    it('should use voice profile for styling when available', async () => {
      await service.generateCatchUp('user123', 'guild456');

      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs.instructions).toContain('casual');
    });

    it('should fall back to default style when voice profile unavailable', async () => {
      mockVoiceProfileService.getProfile.mockResolvedValue(null);

      const result = await service.generateCatchUp('user123', 'guild456');

      expect(result.success).toBe(true);
      expect(mockOpenAIClient.responses.create).toHaveBeenCalled();
    });

    it('should use default lookback when no last-seen record exists', async () => {
      mockMongoService.getUserLastSeen.mockResolvedValue(null);

      const result = await service.generateCatchUp('user123', 'guild456');

      expect(result.success).toBe(true);
      // Should still fetch articles with a default time range
      expect(mockMongoService.getRecentArticleSummaries).toHaveBeenCalled();
    });

    it('should include recent messages from active channels', async () => {
      await service.generateCatchUp('user123', 'guild456');

      expect(mockChannelContextService.getRecentContext).toHaveBeenCalled();
    });

    it('should include article trends in the context', async () => {
      await service.generateCatchUp('user123', 'guild456');

      const callArgs = mockOpenAIClient.responses.create.mock.calls[0][0];
      expect(callArgs.input).toContain('AI');
      expect(callArgs.input).toContain('DevOps');
    });

    it('should use explicit days parameter when provided', async () => {
      await service.generateCatchUp('user123', 'guild456', { days: 7 });

      expect(mockMongoService.getRecentArticleSummaries).toHaveBeenCalledWith(7);
      expect(mockMongoService.getArticleTrends).toHaveBeenCalledWith(7);
    });

    it('should calculate fractional day lookback for short absences', async () => {
      // User was last seen 3 hours ago
      mockMongoService.getUserLastSeen.mockResolvedValue({
        userId: 'user123',
        guildId: 'guild456',
        lastSeenAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        activeChannels: ['channel1']
      });

      await service.generateCatchUp('user123', 'guild456');

      // Should use fractional days (3 hours ≈ 0.125 days)
      const calledDays = mockMongoService.getRecentArticleSummaries.mock.calls[0][0];
      expect(calledDays).toBeLessThan(1);
      expect(calledDays).toBeGreaterThan(0);
    });

    it('should handle errors gracefully', async () => {
      mockOpenAIClient.responses.create.mockRejectedValue(new Error('API Error'));

      const result = await service.generateCatchUp('user123', 'guild456');

      expect(result.success).toBe(false);
      expect(result.error).toContain('error');
    });

    it('should return message about nothing to catch up on when no data', async () => {
      mockMongoService.getRecentArticleSummaries.mockResolvedValue([]);
      mockMongoService.getArticleTrends.mockResolvedValue([]);
      mockChannelContextService.getRecentContext.mockReturnValue('');

      const result = await service.generateCatchUp('user123', 'guild456');

      expect(result.success).toBe(true);
      expect(result.nothingNew).toBe(true);
    });
  });
});
