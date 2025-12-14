// __tests__/commands/memory/RememberCommand.test.js
// TDD tests for RememberCommand - explicitly store a memory

const RememberCommand = require('../../../commands/memory/RememberCommand');

// Mock the logger
jest.mock('../../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('RememberCommand', () => {
  let command;
  let mockMem0Service;
  let mockMessage;
  let mockContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockMem0Service = {
      isEnabled: jest.fn().mockReturnValue(true),
      addMemory: jest.fn().mockResolvedValue({
        results: [{ id: 'mem-new', memory: 'User is allergic to peanuts' }]
      })
    };

    mockMessage = {
      author: { id: 'user123', username: 'TestUser', tag: 'TestUser#1234' },
      channel: {
        id: 'channel456',
        send: jest.fn().mockResolvedValue({})
      },
      guild: { id: 'guild789' },
      reply: jest.fn().mockResolvedValue({})
    };

    mockContext = {
      bot: {
        mem0Service: mockMem0Service
      },
      config: {}
    };

    command = new RememberCommand();
  });

  describe('constructor', () => {
    it('should have correct command properties', () => {
      expect(command.name).toBe('remember');
      expect(command.aliases).toContain('memorize');
      expect(command.aliases).toContain('store');
      expect(command.category).toBe('memory');
    });

    it('should require a fact argument', () => {
      expect(command.args).toContainEqual(
        expect.objectContaining({ name: 'fact', required: true })
      );
    });
  });

  describe('execute', () => {
    it('should show error if Mem0 service is not available', async () => {
      const contextWithoutMem0 = { bot: {}, config: {} };

      await command.execute(mockMessage, ['I', 'like', 'cats'], contextWithoutMem0);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not available')
        })
      );
    });

    it('should show error if Mem0 service is disabled', async () => {
      mockMem0Service.isEnabled.mockReturnValue(false);

      await command.execute(mockMessage, ['I', 'like', 'cats'], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not enabled')
        })
      );
    });

    it('should show usage if no fact provided', async () => {
      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Usage')
        })
      );
    });

    it('should store the provided fact as a memory', async () => {
      await command.execute(mockMessage, ['I', 'am', 'allergic', 'to', 'peanuts'], mockContext);

      expect(mockMem0Service.addMemory).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('allergic to peanuts')
          })
        ]),
        'user123',
        expect.objectContaining({
          channelId: 'channel456'
        })
      );
    });

    it('should confirm successful memory storage', async () => {
      await command.execute(mockMessage, ['I', 'prefer', 'dark', 'mode'], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/remembered|stored|saved/i)
        })
      );
    });

    it('should handle storage errors gracefully', async () => {
      mockMem0Service.addMemory.mockRejectedValue(new Error('Storage failed'));

      await command.execute(mockMessage, ['Remember', 'this'], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('error')
        })
      );
    });

    it('should handle empty results from addMemory', async () => {
      mockMem0Service.addMemory.mockResolvedValue({ results: [] });

      await command.execute(mockMessage, ['Something', 'trivial'], mockContext);

      // Should still acknowledge the request even if Mem0 didn't extract anything
      expect(mockMessage.reply).toHaveBeenCalled();
    });

    it('should include guild ID in metadata when available', async () => {
      await command.execute(mockMessage, ['Test', 'fact'], mockContext);

      expect(mockMem0Service.addMemory).toHaveBeenCalledWith(
        expect.any(Array),
        'user123',
        expect.objectContaining({
          guildId: 'guild789'
        })
      );
    });

    it('should handle DM context (no guild)', async () => {
      mockMessage.guild = null;

      await command.execute(mockMessage, ['Test', 'fact'], mockContext);

      expect(mockMem0Service.addMemory).toHaveBeenCalledWith(
        expect.any(Array),
        'user123',
        expect.objectContaining({
          guildId: null
        })
      );
    });

    it('should reject very long facts', async () => {
      const veryLongFact = 'a'.repeat(1001); // Over 1000 chars

      await command.execute(mockMessage, [veryLongFact], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('too long')
        })
      );
      expect(mockMem0Service.addMemory).not.toHaveBeenCalled();
    });
  });
});
