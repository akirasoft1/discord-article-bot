// __tests__/services/MongoService.test.js
const MongoService = require('../../services/MongoService');

// Mock the MongoDB client
jest.mock('mongodb', () => {
  const mockCollection = {
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'test-id' }),
    aggregate: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([])
    })
  };

  const mockDb = {
    collection: jest.fn().mockReturnValue(mockCollection)
  };

  const mockClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    db: jest.fn().mockReturnValue(mockDb)
  };

  return {
    MongoClient: jest.fn().mockImplementation(() => mockClient)
  };
});

// Mock the logger
jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('MongoService', () => {
  let mongoService;
  let mockCollection;

  beforeEach(async () => {
    jest.clearAllMocks();
    mongoService = new MongoService('mongodb://localhost:27017/test');
    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 10));
    // Get reference to mock collection
    mockCollection = mongoService.db.collection('token_usage');
  });

  describe('recordTokenUsage', () => {
    it('should record token usage successfully', async () => {
      const result = await mongoService.recordTokenUsage(
        'user123',
        'TestUser',
        100,
        50,
        'summarize',
        'gpt-5.1'
      );

      expect(result).toBe(true);
      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user123',
          username: 'TestUser',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          commandType: 'summarize',
          model: 'gpt-5.1',
          timestamp: expect.any(Date)
        })
      );
    });

    it('should use default model if not specified', async () => {
      await mongoService.recordTokenUsage(
        'user123',
        'TestUser',
        100,
        50,
        'chat'
      );

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5.1'
        })
      );
    });

    it('should return false if db is not connected', async () => {
      mongoService.db = null;
      const result = await mongoService.recordTokenUsage(
        'user123',
        'TestUser',
        100,
        50,
        'summarize'
      );

      expect(result).toBe(false);
    });
  });

  describe('getUserTokenUsage', () => {
    it('should return empty stats for user with no usage', async () => {
      mockCollection.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([])
      });

      const result = await mongoService.getUserTokenUsage('user123');

      expect(result).toEqual({
        userId: 'user123',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        commandBreakdown: {}
      });
    });

    it('should return aggregated stats for user with usage', async () => {
      mockCollection.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{
          _id: 'user123',
          totalInputTokens: 500,
          totalOutputTokens: 250,
          totalTokens: 750,
          requestCount: 5,
          byCommand: [
            { commandType: 'summarize', tokens: 300 },
            { commandType: 'summarize', tokens: 200 },
            { commandType: 'chat', tokens: 250 }
          ]
        }])
      });

      const result = await mongoService.getUserTokenUsage('user123');

      expect(result).toEqual({
        userId: 'user123',
        totalInputTokens: 500,
        totalOutputTokens: 250,
        totalTokens: 750,
        requestCount: 5,
        commandBreakdown: {
          summarize: { count: 2, tokens: 500 },
          chat: { count: 1, tokens: 250 }
        }
      });
    });

    it('should return null if db is not connected', async () => {
      mongoService.db = null;
      const result = await mongoService.getUserTokenUsage('user123');

      expect(result).toBe(null);
    });
  });

  describe('getTokenUsageLeaderboard', () => {
    it('should return empty array when no usage data', async () => {
      mockCollection.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([])
      });

      const result = await mongoService.getTokenUsageLeaderboard();

      expect(result).toEqual([]);
    });

    it('should return formatted leaderboard data', async () => {
      mockCollection.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: 'user1', username: 'TopUser', totalTokens: 10000, requestCount: 50 },
          { _id: 'user2', username: 'SecondUser', totalTokens: 5000, requestCount: 25 }
        ])
      });

      const result = await mongoService.getTokenUsageLeaderboard(30, 10);

      expect(result).toEqual([
        { userId: 'user1', username: 'TopUser', totalTokens: 10000, requestCount: 50 },
        { userId: 'user2', username: 'SecondUser', totalTokens: 5000, requestCount: 25 }
      ]);
    });

    it('should return empty array if db is not connected', async () => {
      mongoService.db = null;
      const result = await mongoService.getTokenUsageLeaderboard();

      expect(result).toEqual([]);
    });
  });

  // ========== Chat Conversation Memory Tests ==========

  describe('Chat Conversation Memory', () => {
    beforeEach(() => {
      // Reset mock for conversation tests
      mockCollection.findOne = jest.fn();
      mockCollection.updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    });

    describe('_getConversationId', () => {
      it('should generate composite ID from channel and personality', () => {
        const id = mongoService._getConversationId('channel123', 'noir-detective');
        expect(id).toBe('channel123_noir-detective');
      });
    });

    describe('getOrCreateConversation', () => {
      it('should return existing active conversation', async () => {
        const existingConversation = {
          conversationId: 'channel123_noir-detective',
          channelId: 'channel123',
          personalityId: 'noir-detective',
          status: 'active',
          messages: [{ role: 'user', content: 'Hello' }]
        };
        mockCollection.findOne.mockResolvedValue(existingConversation);

        const result = await mongoService.getOrCreateConversation('channel123', 'noir-detective', 'guild456');

        expect(result).toEqual(existingConversation);
        expect(mockCollection.insertOne).not.toHaveBeenCalled();
      });

      it('should create new conversation if none exists', async () => {
        mockCollection.findOne.mockResolvedValue(null);

        const result = await mongoService.getOrCreateConversation('channel123', 'noir-detective', 'guild456');

        expect(result).toMatchObject({
          conversationId: 'channel123_noir-detective',
          channelId: 'channel123',
          guildId: 'guild456',
          personalityId: 'noir-detective',
          messages: [],
          status: 'active',
          messageCount: 0,
          totalTokens: 0
        });
        expect(mockCollection.insertOne).toHaveBeenCalled();
      });

      it('should return null if db is not connected', async () => {
        mongoService.db = null;
        const result = await mongoService.getOrCreateConversation('channel123', 'noir-detective', 'guild456');
        expect(result).toBeNull();
      });
    });

    describe('addMessageToConversation', () => {
      it('should add user message with userId and username', async () => {
        const result = await mongoService.addMessageToConversation(
          'channel123',
          'noir-detective',
          'user',
          'Hello detective!',
          'user789',
          'Alice',
          50
        );

        expect(result).toBe(true);
        expect(mockCollection.updateOne).toHaveBeenCalledWith(
          { conversationId: 'channel123_noir-detective', status: 'active' },
          expect.objectContaining({
            $push: { messages: expect.objectContaining({
              role: 'user',
              content: 'Hello detective!',
              userId: 'user789',
              username: 'Alice'
            })},
            $inc: { messageCount: 1, totalTokens: 50 }
          })
        );
      });

      it('should add assistant message without userId', async () => {
        const result = await mongoService.addMessageToConversation(
          'channel123',
          'noir-detective',
          'assistant',
          'The rain fell hard that night...',
          null,
          null,
          75
        );

        expect(result).toBe(true);
        expect(mockCollection.updateOne).toHaveBeenCalledWith(
          { conversationId: 'channel123_noir-detective', status: 'active' },
          expect.objectContaining({
            $push: { messages: expect.objectContaining({
              role: 'assistant',
              content: 'The rain fell hard that night...'
            })}
          })
        );
      });

      it('should return false if db is not connected', async () => {
        mongoService.db = null;
        const result = await mongoService.addMessageToConversation(
          'channel123', 'noir-detective', 'user', 'Hello', 'user789', 'Alice'
        );
        expect(result).toBe(false);
      });
    });

    describe('getConversationHistory', () => {
      it('should return conversation with messages', async () => {
        const conversation = {
          conversationId: 'channel123_noir-detective',
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' }
          ]
        };
        mockCollection.findOne.mockResolvedValue(conversation);

        const result = await mongoService.getConversationHistory('channel123', 'noir-detective');

        expect(result).toEqual(conversation);
      });

      it('should return null if no conversation exists', async () => {
        mockCollection.findOne.mockResolvedValue(null);

        const result = await mongoService.getConversationHistory('channel123', 'noir-detective');

        expect(result).toBeNull();
      });
    });

    describe('getConversationStatus', () => {
      it('should return status info for existing conversation', async () => {
        const conversation = {
          status: 'active',
          lastActivity: new Date('2024-01-15T10:30:00Z'),
          messageCount: 5,
          totalTokens: 500
        };
        mockCollection.findOne.mockResolvedValue(conversation);

        const result = await mongoService.getConversationStatus('channel123', 'noir-detective');

        expect(result).toEqual({
          exists: true,
          status: 'active',
          lastActivity: expect.any(Date),
          messageCount: 5,
          totalTokens: 500
        });
      });

      it('should return exists: false for non-existent conversation', async () => {
        mockCollection.findOne.mockResolvedValue(null);

        const result = await mongoService.getConversationStatus('channel123', 'noir-detective');

        expect(result).toEqual({ exists: false });
      });
    });

    describe('resetConversation', () => {
      it('should mark conversation as reset', async () => {
        const result = await mongoService.resetConversation('channel123', 'noir-detective');

        expect(result).toBe(true);
        expect(mockCollection.updateOne).toHaveBeenCalledWith(
          { conversationId: 'channel123_noir-detective', status: 'active' },
          { $set: { status: 'reset', resetAt: expect.any(Date) } }
        );
      });
    });

    describe('expireConversation', () => {
      it('should mark conversation as expired', async () => {
        const result = await mongoService.expireConversation('channel123', 'noir-detective');

        expect(result).toBe(true);
        expect(mockCollection.updateOne).toHaveBeenCalledWith(
          { conversationId: 'channel123_noir-detective', status: 'active' },
          { $set: { status: 'expired', expiredAt: expect.any(Date) } }
        );
      });
    });

    describe('resumeConversation', () => {
      it('should reactivate expired conversation', async () => {
        mockCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

        const result = await mongoService.resumeConversation('channel123', 'noir-detective');

        expect(result).toBe(true);
        expect(mockCollection.updateOne).toHaveBeenCalledWith(
          { conversationId: 'channel123_noir-detective', status: 'expired' },
          {
            $set: { status: 'active', resumedAt: expect.any(Date) },
            $unset: { expiredAt: '' }
          }
        );
      });

      it('should return false if no expired conversation found', async () => {
        mockCollection.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

        const result = await mongoService.resumeConversation('channel123', 'noir-detective');

        expect(result).toBe(false);
      });
    });

    describe('isConversationIdle', () => {
      it('should return false for non-existent conversation', async () => {
        mockCollection.findOne.mockResolvedValue(null);

        const result = await mongoService.isConversationIdle('channel123', 'noir-detective');

        expect(result).toBe(false);
      });

      it('should return true for already expired conversation', async () => {
        mockCollection.findOne.mockResolvedValue({
          status: 'expired',
          lastActivity: new Date()
        });

        const result = await mongoService.isConversationIdle('channel123', 'noir-detective');

        expect(result).toBe(true);
      });

      it('should return true if last activity exceeds timeout', async () => {
        const oldDate = new Date();
        oldDate.setMinutes(oldDate.getMinutes() - 45); // 45 minutes ago
        mockCollection.findOne.mockResolvedValue({
          status: 'active',
          lastActivity: oldDate,
          messageCount: 5,
          totalTokens: 500
        });

        const result = await mongoService.isConversationIdle('channel123', 'noir-detective', 30);

        expect(result).toBe(true);
      });

      it('should return false if last activity within timeout', async () => {
        const recentDate = new Date();
        recentDate.setMinutes(recentDate.getMinutes() - 10); // 10 minutes ago
        mockCollection.findOne.mockResolvedValue({
          status: 'active',
          lastActivity: recentDate,
          messageCount: 5,
          totalTokens: 500
        });

        const result = await mongoService.isConversationIdle('channel123', 'noir-detective', 30);

        expect(result).toBe(false);
      });
    });
  });

  // ========== Image Generation Tracking Tests ==========

  describe('Image Generation Tracking', () => {
    beforeEach(() => {
      mockCollection.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([])
          })
        })
      });
    });

    describe('recordImageGeneration', () => {
      it('should record successful image generation', async () => {
        const result = await mongoService.recordImageGeneration(
          'user123',
          'TestUser',
          'A beautiful sunset',
          '16:9',
          'gemini-3-pro-image-preview',
          true,
          null,
          524288
        );

        expect(result).toBe(true);
        expect(mockCollection.insertOne).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'user123',
            username: 'TestUser',
            prompt: 'A beautiful sunset',
            aspectRatio: '16:9',
            model: 'gemini-3-pro-image-preview',
            success: true,
            error: null,
            imageSizeBytes: 524288,
            timestamp: expect.any(Date)
          })
        );
      });

      it('should record failed image generation with error', async () => {
        const result = await mongoService.recordImageGeneration(
          'user123',
          'TestUser',
          'Something bad',
          '1:1',
          'gemini-3-pro-image-preview',
          false,
          'Safety filter blocked',
          0
        );

        expect(result).toBe(true);
        expect(mockCollection.insertOne).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: 'Safety filter blocked',
            imageSizeBytes: 0
          })
        );
      });

      it('should return false if db is not connected', async () => {
        mongoService.db = null;
        const result = await mongoService.recordImageGeneration(
          'user123',
          'TestUser',
          'A sunset',
          '1:1',
          'gemini-3-pro-image-preview',
          true
        );

        expect(result).toBe(false);
      });
    });

    describe('getImageGenerationStats', () => {
      it('should return empty stats for user with no generations', async () => {
        mockCollection.aggregate.mockReturnValue({
          toArray: jest.fn().mockResolvedValue([])
        });

        const result = await mongoService.getImageGenerationStats('user123');

        expect(result).toEqual({
          totalGenerations: 0,
          successfulGenerations: 0,
          failedGenerations: 0,
          totalBytes: 0
        });
      });

      it('should return aggregated stats for user with generations', async () => {
        mockCollection.aggregate.mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{
            _id: null,
            totalGenerations: 10,
            successfulGenerations: 8,
            failedGenerations: 2,
            totalBytes: 5242880
          }])
        });

        const result = await mongoService.getImageGenerationStats('user123', 30);

        expect(result).toEqual({
          totalGenerations: 10,
          successfulGenerations: 8,
          failedGenerations: 2,
          totalBytes: 5242880
        });
      });

      it('should return empty stats if db is not connected', async () => {
        mongoService.db = null;
        const result = await mongoService.getImageGenerationStats('user123');

        expect(result).toEqual({
          totalGenerations: 0,
          successfulGenerations: 0,
          failedGenerations: 0,
          totalBytes: 0
        });
      });
    });

    describe('getRecentImageGenerations', () => {
      it('should return empty array for user with no generations', async () => {
        const result = await mongoService.getRecentImageGenerations('user123');

        expect(result).toEqual([]);
      });

      it('should return recent generations for user', async () => {
        const mockGenerations = [
          { prompt: 'Sunset', success: true, timestamp: new Date() },
          { prompt: 'Mountain', success: true, timestamp: new Date() }
        ];
        mockCollection.find.mockReturnValue({
          sort: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              toArray: jest.fn().mockResolvedValue(mockGenerations)
            })
          })
        });

        const result = await mongoService.getRecentImageGenerations('user123', 10);

        expect(result).toEqual(mockGenerations);
        expect(mockCollection.find).toHaveBeenCalledWith({ userId: 'user123' });
      });

      it('should return empty array if db is not connected', async () => {
        mongoService.db = null;
        const result = await mongoService.getRecentImageGenerations('user123');

        expect(result).toEqual([]);
      });
    });
  });
});
