// __tests__/commands/slash/MemoriesCommand.test.js
// Tests for MemoriesSlashCommand

const MemoriesSlashCommand = require('../../../commands/slash/MemoriesCommand');

describe('MemoriesSlashCommand', () => {
  let command;
  let mockMem0Service;
  let mockInteraction;

  beforeEach(() => {
    // Mock Mem0Service
    mockMem0Service = {
      getUserMemories: jest.fn()
    };

    // Mock Discord interaction
    mockInteraction = {
      user: { id: 'user123', tag: 'TestUser#1234' },
      options: { getString: jest.fn() },
      editReply: jest.fn().mockResolvedValue({}),
      deferReply: jest.fn().mockResolvedValue({}),
      reply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deferred: true,  // Simulate that deferReply was called
      replied: false
    };

    command = new MemoriesSlashCommand(mockMem0Service);
  });

  describe('execute', () => {
    it('should show message when user has no memories', async () => {
      mockMem0Service.getUserMemories.mockResolvedValue({ results: [] });

      await command.execute(mockInteraction, {});

      expect(mockMem0Service.getUserMemories).toHaveBeenCalledWith('user123', { limit: 20 });
      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('don\'t have any memories')
        })
      );
    });

    it('should display memories in embed when user has memories', async () => {
      mockMem0Service.getUserMemories.mockResolvedValue({
        results: [
          { id: 'mem1', memory: 'User likes coding' },
          { id: 'mem2', memory: 'User prefers dark mode' }
        ]
      });

      await command.execute(mockInteraction, {});

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: 'What I Remember About You',
                fields: expect.arrayContaining([
                  expect.objectContaining({
                    name: 'Your Memories',
                    value: expect.stringContaining('User likes coding')
                  })
                ])
              })
            })
          ])
        })
      );
    });

    it('should handle memories with empty content gracefully', async () => {
      mockMem0Service.getUserMemories.mockResolvedValue({
        results: [
          { id: 'mem1', memory: '' },
          { id: 'mem2', memory: null },
          { id: 'mem3' }  // No memory or text field
        ]
      });

      await command.execute(mockInteraction, {});

      // Should not throw and should show "Unknown memory" fallback
      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                fields: expect.arrayContaining([
                  expect.objectContaining({
                    value: expect.stringContaining('Unknown memory')
                  })
                ])
              })
            })
          ])
        })
      );
    });

    it('should truncate long memories', async () => {
      const longMemory = 'A'.repeat(200);
      mockMem0Service.getUserMemories.mockResolvedValue({
        results: [{ id: 'mem1', memory: longMemory }]
      });

      await command.execute(mockInteraction, {});

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                fields: expect.arrayContaining([
                  expect.objectContaining({
                    value: expect.stringMatching(/\.\.\./)  // Should be truncated
                  })
                ])
              })
            })
          ])
        })
      );
    });

    it('should handle many memories without exceeding embed limits', async () => {
      // Create 20 memories
      const memories = Array.from({ length: 20 }, (_, i) => ({
        id: `mem${i}`,
        memory: `Memory number ${i + 1} with some content`
      }));

      mockMem0Service.getUserMemories.mockResolvedValue({ results: memories });

      await command.execute(mockInteraction, {});

      // Should not throw and embed field value should be under 1024 chars
      const call = mockInteraction.editReply.mock.calls[0][0];
      const fieldValue = call.embeds[0].data.fields[0].value;
      expect(fieldValue.length).toBeLessThanOrEqual(1024);
    });

    it('should use text field as fallback when memory field is missing', async () => {
      mockMem0Service.getUserMemories.mockResolvedValue({
        results: [{ id: 'mem1', text: 'Fallback text content' }]
      });

      await command.execute(mockInteraction, {});

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                fields: expect.arrayContaining([
                  expect.objectContaining({
                    value: expect.stringContaining('Fallback text content')
                  })
                ])
              })
            })
          ])
        })
      );
    });
  });

  describe('command metadata', () => {
    it('should have correct command name', () => {
      expect(command.data.name).toBe('memories');
    });

    it('should be configured as ephemeral', () => {
      expect(command.ephemeral).toBe(true);
    });

    it('should have a cooldown', () => {
      expect(command.cooldown).toBe(10);
    });
  });
});
