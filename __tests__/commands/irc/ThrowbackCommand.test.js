// __tests__/commands/irc/ThrowbackCommand.test.js

const ThrowbackCommand = require('../../../commands/irc/ThrowbackCommand');

describe('ThrowbackCommand', () => {
  let command;
  let mockMessage;
  let mockContext;
  let mockQdrantService;

  beforeEach(() => {
    command = new ThrowbackCommand();

    mockMessage = {
      author: { id: '123456789', tag: 'testuser#1234' },
      reply: jest.fn().mockResolvedValue({})
    };

    mockQdrantService = {
      getRandomFromDate: jest.fn(),
      formatResult: jest.fn()
    };

    mockContext = {
      bot: {
        qdrantService: mockQdrantService
      }
    };
  });

  describe('constructor', () => {
    it('should have correct name', () => {
      expect(command.name).toBe('throwback');
    });

    it('should have correct aliases', () => {
      expect(command.aliases).toContain('tbt');
      expect(command.aliases).toContain('onthisday');
    });
  });

  describe('execute', () => {
    it('should return error if QdrantService not available', async () => {
      mockContext.bot.qdrantService = null;

      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not available')
        })
      );
    });

    it('should get random conversation from today in history', async () => {
      mockQdrantService.getRandomFromDate.mockResolvedValue({
        id: 1,
        payload: { text: 'old convo', year: 2005, start_time: '2005-12-16T14:00:00' }
      });
      mockQdrantService.formatResult.mockReturnValue('formatted result');

      const now = new Date();
      await command.execute(mockMessage, [], mockContext);

      expect(mockQdrantService.getRandomFromDate).toHaveBeenCalledWith(
        now.getMonth() + 1,
        now.getDate()
      );
    });

    it('should return message if no throwback found', async () => {
      mockQdrantService.getRandomFromDate.mockResolvedValue(null);

      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('No IRC conversations found')
        })
      );
    });

    it('should format and display throwback', async () => {
      mockQdrantService.getRandomFromDate.mockResolvedValue({
        id: 1,
        payload: { text: 'remember this?', year: 2003 }
      });
      mockQdrantService.formatResult.mockReturnValue('formatted throwback');

      await command.execute(mockMessage, [], mockContext);

      expect(mockQdrantService.formatResult).toHaveBeenCalled();
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/Throwback|On This Day/)
        })
      );
    });

    it('should calculate years ago correctly', async () => {
      const currentYear = new Date().getFullYear();
      mockQdrantService.getRandomFromDate.mockResolvedValue({
        id: 1,
        payload: { text: 'old times', year: 2005 }
      });
      mockQdrantService.formatResult.mockReturnValue('formatted');

      await command.execute(mockMessage, [], mockContext);

      const expectedYearsAgo = currentYear - 2005;
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(`${expectedYearsAgo} years ago`)
        })
      );
    });
  });
});
