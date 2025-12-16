// __tests__/commands/irc/RecallCommand.test.js

const RecallCommand = require('../../../commands/irc/RecallCommand');

describe('RecallCommand', () => {
  let command;
  let mockMessage;
  let mockContext;
  let mockQdrantService;
  let mockNickMappingService;

  beforeEach(() => {
    command = new RecallCommand();

    mockMessage = {
      author: { id: '123456789', tag: 'testuser#1234' },
      reply: jest.fn().mockResolvedValue({}),
      channel: { send: jest.fn().mockResolvedValue({}) }
    };

    mockQdrantService = {
      search: jest.fn(),
      formatResult: jest.fn()
    };

    mockNickMappingService = {
      getIrcNicks: jest.fn()
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
      expect(command.name).toBe('recall');
    });

    it('should have correct aliases', () => {
      expect(command.aliases).toContain('irc');
      expect(command.aliases).toContain('ircsearch');
    });

    it('should have correct description', () => {
      expect(command.description).toContain('IRC');
    });
  });

  describe('execute', () => {
    it('should return error if QdrantService not available', async () => {
      mockContext.bot.qdrantService = null;

      await command.execute(mockMessage, ['test'], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not available')
        })
      );
    });

    it('should return error if no query provided', async () => {
      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('provide a search query')
        })
      );
    });

    it('should perform search with query', async () => {
      mockQdrantService.search.mockResolvedValue([
        { score: 0.95, payload: { text: 'test convo', year: 2005 } }
      ]);
      mockQdrantService.formatResult.mockReturnValue('formatted result');

      await command.execute(mockMessage, ['test', 'query'], mockContext);

      expect(mockQdrantService.search).toHaveBeenCalledWith(
        'test query',
        expect.any(Object)
      );
    });

    it('should include user nicks when --me flag used', async () => {
      mockNickMappingService.getIrcNicks.mockReturnValue(['Akira1', 'Akira1_']);
      mockQdrantService.search.mockResolvedValue([]);

      await command.execute(mockMessage, ['--me', 'test'], mockContext);

      expect(mockNickMappingService.getIrcNicks).toHaveBeenCalledWith('123456789');
      expect(mockQdrantService.search).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          participants: ['Akira1', 'Akira1_']
        })
      );
    });

    it('should handle year filter', async () => {
      mockQdrantService.search.mockResolvedValue([]);

      await command.execute(mockMessage, ['--year', '2005', 'test'], mockContext);

      expect(mockQdrantService.search).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          year: 2005
        })
      );
    });

    it('should return message if no results found', async () => {
      mockQdrantService.search.mockResolvedValue([]);

      await command.execute(mockMessage, ['obscure', 'query'], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('No IRC conversations found')
        })
      );
    });

    it('should format and send results', async () => {
      mockQdrantService.search.mockResolvedValue([
        { score: 0.95, payload: { text: 'result 1' } },
        { score: 0.85, payload: { text: 'result 2' } }
      ]);
      mockQdrantService.formatResult
        .mockReturnValueOnce('formatted 1')
        .mockReturnValueOnce('formatted 2');

      await command.execute(mockMessage, ['test'], mockContext);

      expect(mockQdrantService.formatResult).toHaveBeenCalledTimes(2);
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('formatted 1')
        })
      );
    });
  });
});
