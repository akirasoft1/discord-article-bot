// __tests__/commands/memory/MemoriesCommand.test.js
// TDD tests for MemoriesCommand - view user's stored memories

const MemoriesCommand = require('../../../commands/memory/MemoriesCommand');

// Mock the logger
jest.mock('../../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('MemoriesCommand', () => {
  let command;
  let mockMem0Service;
  let mockMessage;
  let mockContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockMem0Service = {
      isEnabled: jest.fn().mockReturnValue(true),
      getUserMemories: jest.fn().mockResolvedValue({
        results: [
          { id: 'mem-1', memory: 'User prefers dark mode' },
          { id: 'mem-2', memory: 'User is a Python developer' },
          { id: 'mem-3', memory: 'User likes hiking' }
        ]
      })
    };

    mockMessage = {
      author: { id: 'user123', username: 'TestUser', tag: 'TestUser#1234' },
      channel: {
        send: jest.fn().mockResolvedValue({})
      },
      reply: jest.fn().mockResolvedValue({})
    };

    mockContext = {
      bot: {
        mem0Service: mockMem0Service
      },
      config: {}
    };

    command = new MemoriesCommand();
  });

  describe('constructor', () => {
    it('should have correct command properties', () => {
      expect(command.name).toBe('memories');
      expect(command.aliases).toContain('mymemories');
      expect(command.aliases).toContain('whatdoyouknow');
      expect(command.category).toBe('memory');
    });

    it('should have helpful description', () => {
      expect(command.description).toContain('remember');
    });
  });

  describe('execute', () => {
    it('should show error if Mem0 service is not available', async () => {
      const contextWithoutMem0 = { bot: {}, config: {} };

      await command.execute(mockMessage, [], contextWithoutMem0);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not available')
        })
      );
    });

    it('should show error if Mem0 service is disabled', async () => {
      mockMem0Service.isEnabled.mockReturnValue(false);

      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('not enabled')
        })
      );
    });

    it('should fetch memories for the requesting user', async () => {
      await command.execute(mockMessage, [], mockContext);

      expect(mockMem0Service.getUserMemories).toHaveBeenCalledWith(
        'user123',
        expect.any(Object)
      );
    });

    it('should display memories with numbered list', async () => {
      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('dark mode')
        })
      );
      // Should show numbered list for easy deletion via !forget <number>
      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/\*\*1\.\*\*.*dark mode/i)
        })
      );
    });

    it('should show message when user has no memories', async () => {
      mockMem0Service.getUserMemories.mockResolvedValue({ results: [] });

      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('no memories')
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      mockMem0Service.getUserMemories.mockRejectedValue(new Error('API error'));

      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('error')
        })
      );
    });

    it('should limit number of memories displayed', async () => {
      // Create 30 memories
      const manyMemories = Array.from({ length: 30 }, (_, i) => ({
        id: `mem-${i}`,
        memory: `Memory number ${i}`
      }));
      mockMem0Service.getUserMemories.mockResolvedValue({ results: manyMemories });

      await command.execute(mockMessage, [], mockContext);

      // Should request with a limit
      expect(mockMem0Service.getUserMemories).toHaveBeenCalledWith(
        'user123',
        expect.objectContaining({ limit: expect.any(Number) })
      );
    });

    it('should include instructions for deleting memories', async () => {
      await command.execute(mockMessage, [], mockContext);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('!forget')
        })
      );
    });
  });
});
