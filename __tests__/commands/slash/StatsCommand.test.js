// __tests__/commands/slash/StatsCommand.test.js

jest.mock('../../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

const StatsSlashCommand = require('../../../commands/slash/StatsCommand');

describe('StatsSlashCommand', () => {
  let command;
  let mockMongoService;
  let mockInteraction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockMongoService = {
      getTokenUsageLeaderboard: jest.fn().mockResolvedValue([
        { userId: 'user1', username: 'Alice', totalTokens: 50000, requestCount: 25 },
        { userId: 'user2', username: 'Bob', totalTokens: 30000, requestCount: 15 },
        { userId: 'user3', username: 'Charlie', totalTokens: 10000, requestCount: 8 }
      ])
    };

    mockInteraction = {
      user: { id: 'user123', tag: 'TestUser#1234' },
      guild: { id: 'guild456' },
      options: {
        getInteger: jest.fn().mockReturnValue(null)
      },
      editReply: jest.fn().mockResolvedValue({}),
      deferReply: jest.fn().mockResolvedValue({}),
      reply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deferred: true,
      replied: false
    };

    command = new StatsSlashCommand(mockMongoService);
  });

  describe('execute', () => {
    it('should default to 1 day when no days parameter', async () => {
      await command.execute(mockInteraction, {});

      expect(mockMongoService.getTokenUsageLeaderboard).toHaveBeenCalledWith(1, 5);
    });

    it('should use provided days parameter', async () => {
      mockInteraction.options.getInteger.mockReturnValue(7);

      await command.execute(mockInteraction, {});

      expect(mockMongoService.getTokenUsageLeaderboard).toHaveBeenCalledWith(7, 5);
    });

    it('should display leaderboard as embed', async () => {
      await command.execute(mockInteraction, {});

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: expect.stringContaining('Token Usage')
              })
            })
          ])
        })
      );
    });

    it('should include usernames and token counts', async () => {
      await command.execute(mockInteraction, {});

      const embed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      const desc = embed.data.description;
      expect(desc).toContain('Alice');
      expect(desc).toContain('50,000');
      expect(desc).toContain('Bob');
    });

    it('should handle empty leaderboard', async () => {
      mockMongoService.getTokenUsageLeaderboard.mockResolvedValue([]);

      await command.execute(mockInteraction, {});

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('No token usage')
        })
      );
    });
  });
});
