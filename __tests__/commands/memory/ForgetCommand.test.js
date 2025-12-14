// __tests__/commands/memory/ForgetCommand.test.js
// TDD tests for ForgetCommand - delete memories

const ForgetCommand = require('../../../commands/memory/ForgetCommand');

// Mock the logger
jest.mock('../../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('ForgetCommand', () => {
  let command;
  let mockMem0Service;
  let mockMessage;
  let mockContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockMem0Service = {
      isEnabled: jest.fn().mockReturnValue(true),
      deleteMemory: jest.fn().mockResolvedValue({ message: 'Memory deleted' }),
      deleteAllUserMemories: jest.fn().mockResolvedValue({ message: 'All memories deleted' }),
      getUserMemories: jest.fn().mockResolvedValue({
        results: [
          { id: 'mem-1', memory: 'User prefers dark mode' },
          { id: 'mem-2', memory: 'User likes cats' }
        ]
      })
    };

    mockMessage = {
      author: { id: 'user123', username: 'TestUser', tag: 'TestUser#1234' },
      channel: {
        send: jest.fn().mockResolvedValue({}),
        awaitMessages: jest.fn()
      },
      reply: jest.fn().mockResolvedValue({})
    };

    mockContext = {
      bot: {
        mem0Service: mockMem0Service
      },
      config: {}
    };

    command = new ForgetCommand();
  });

  describe('constructor', () => {
    it('should have correct command properties', () => {
      expect(command.name).toBe('forget');
      expect(command.aliases).toContain('forgetme');
      expect(command.aliases).toContain('deletememory');
      expect(command.category).toBe('memory');
    });

    it('should have helpful description mentioning GDPR', () => {
      expect(command.description.toLowerCase()).toMatch(/delete|forget|remove/);
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

    describe('delete specific memory', () => {
      it('should delete a specific memory by ID', async () => {
        await command.execute(mockMessage, ['mem-1'], mockContext);

        expect(mockMem0Service.deleteMemory).toHaveBeenCalledWith('mem-1');
      });

      it('should confirm successful deletion', async () => {
        await command.execute(mockMessage, ['mem-1'], mockContext);

        expect(mockMessage.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringMatching(/deleted|removed|forgotten/i)
          })
        );
      });

      it('should handle deletion errors gracefully', async () => {
        mockMem0Service.deleteMemory.mockRejectedValue(new Error('Not found'));

        await command.execute(mockMessage, ['invalid-id'], mockContext);

        expect(mockMessage.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('error')
          })
        );
      });
    });

    describe('delete all memories', () => {
      beforeEach(() => {
        // Mock confirmation response
        const mockConfirmMessage = {
          content: 'yes',
          author: { id: 'user123' }
        };
        mockMessage.channel.awaitMessages.mockResolvedValue({
          first: () => mockConfirmMessage,
          size: 1
        });
      });

      it('should require confirmation for deleting all memories', async () => {
        await command.execute(mockMessage, ['all'], mockContext);

        // Should ask for confirmation
        expect(mockMessage.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringMatching(/confirm|sure|warning/i)
          })
        );
      });

      it('should delete all memories after confirmation', async () => {
        await command.execute(mockMessage, ['all'], mockContext);

        expect(mockMem0Service.deleteAllUserMemories).toHaveBeenCalledWith('user123');
      });

      it('should cancel if user does not confirm', async () => {
        mockMessage.channel.awaitMessages.mockResolvedValue({
          first: () => ({ content: 'no', author: { id: 'user123' } }),
          size: 1
        });

        await command.execute(mockMessage, ['all'], mockContext);

        expect(mockMem0Service.deleteAllUserMemories).not.toHaveBeenCalled();
      });

      it('should cancel if confirmation times out', async () => {
        mockMessage.channel.awaitMessages.mockResolvedValue({
          size: 0
        });

        await command.execute(mockMessage, ['all'], mockContext);

        expect(mockMem0Service.deleteAllUserMemories).not.toHaveBeenCalled();
        expect(mockMessage.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringMatching(/cancel|timed? ?out/i)
          })
        );
      });

      it('should confirm successful deletion of all memories', async () => {
        await command.execute(mockMessage, ['all'], mockContext);

        // Find the final confirmation message (not the "are you sure?" prompt)
        const calls = mockMessage.reply.mock.calls;
        const finalCall = calls[calls.length - 1];
        expect(finalCall[0].content).toMatch(/deleted|cleared|removed/i);
      });
    });

    describe('no arguments', () => {
      it('should show usage instructions when no memory ID provided', async () => {
        await command.execute(mockMessage, [], mockContext);

        expect(mockMessage.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('Usage')
          })
        );
      });

      it('should mention !memories command for finding IDs', async () => {
        await command.execute(mockMessage, [], mockContext);

        expect(mockMessage.reply).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.stringContaining('!memories')
          })
        );
      });
    });
  });
});
