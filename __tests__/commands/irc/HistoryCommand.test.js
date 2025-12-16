// __tests__/commands/irc/HistoryCommand.test.js

const HistoryCommand = require('../../../commands/irc/HistoryCommand');

describe('HistoryCommand', () => {
  let command;
  let mockMessage;
  let mockContext;
  let mockQdrantService;
  let mockNickMappingService;

  beforeEach(() => {
    command = new HistoryCommand();

    mockMessage = {
      author: { id: '123456789', tag: 'testuser#1234' },
      reply: jest.fn().mockResolvedValue({}),
      mentions: { users: { first: jest.fn() } }
    };

    mockQdrantService = {
      getByParticipants: jest.fn(),
      formatResult: jest.fn()
    };

    mockNickMappingService = {
      getIrcNicks: jest.fn(),
      getDiscordUser: jest.fn()
    };

    mockContext = {
      bot: {
        qdrantService: mockQdrantService,
        nickMappingService: mockNickMappingService
      }
    };
  });

  describe('constructor', () => {
    it('should have correct name', () => {
      expect(command.name).toBe('history');
    });

    it('should have correct aliases', () => {
      expect(command.aliases).toContain('irchistory');
      expect(command.aliases).toContain('myirc');
    });
  });

  describe('execute', () => {
    it('should return error if services not available', async () => {
      mockContext.bot.qdrantService = null;

      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not available')
        })
      );
    });

    it('should show own history when no user mentioned', async () => {
      mockNickMappingService.getIrcNicks.mockReturnValue(['Akira1', 'Akira1_']);
      mockQdrantService.getByParticipants.mockResolvedValue([
        { id: 1, payload: { text: 'test', year: 2005 } }
      ]);
      mockQdrantService.formatResult.mockReturnValue('formatted');

      await command.execute(mockMessage, [], mockContext);

      expect(mockNickMappingService.getIrcNicks).toHaveBeenCalledWith('123456789');
      expect(mockQdrantService.getByParticipants).toHaveBeenCalledWith(
        ['Akira1', 'Akira1_'],
        expect.any(Object)
      );
    });

    it('should return error if user has no IRC nicks mapped', async () => {
      mockNickMappingService.getIrcNicks.mockReturnValue([]);

      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('any IRC nicks mapped')
        })
      );
    });

    it('should show mentioned user history', async () => {
      const mentionedUser = { id: '987654321', tag: 'other#5678' };
      mockMessage.mentions.users.first.mockReturnValue(mentionedUser);

      mockNickMappingService.getIrcNicks.mockReturnValue(['vise', 'cK-visE']);
      mockQdrantService.getByParticipants.mockResolvedValue([]);

      await command.execute(mockMessage, ['<@987654321>'], mockContext);

      expect(mockNickMappingService.getIrcNicks).toHaveBeenCalledWith('987654321');
    });

    it('should return message if no history found', async () => {
      mockNickMappingService.getIrcNicks.mockReturnValue(['Akira1']);
      mockQdrantService.getByParticipants.mockResolvedValue([]);

      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('No IRC history found')
        })
      );
    });

    it('should format and display results', async () => {
      mockNickMappingService.getIrcNicks.mockReturnValue(['Akira1']);
      mockQdrantService.getByParticipants.mockResolvedValue([
        { id: 1, payload: { text: 'convo 1' } },
        { id: 2, payload: { text: 'convo 2' } }
      ]);
      mockQdrantService.formatResult
        .mockReturnValueOnce('formatted 1')
        .mockReturnValueOnce('formatted 2');

      await command.execute(mockMessage, [], mockContext);

      expect(mockQdrantService.formatResult).toHaveBeenCalledTimes(2);
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('formatted 1')
        })
      );
    });
  });
});
