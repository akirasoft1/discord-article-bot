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
        'gpt-4o-mini'
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
          model: 'gpt-4o-mini',
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
          model: 'gpt-4o-mini'
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
});
