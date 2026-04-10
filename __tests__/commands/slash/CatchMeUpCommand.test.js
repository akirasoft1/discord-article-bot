// __tests__/commands/slash/CatchMeUpCommand.test.js

jest.mock('../../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

const CatchMeUpSlashCommand = require('../../../commands/slash/CatchMeUpCommand');

describe('CatchMeUpSlashCommand', () => {
  let command;
  let mockCatchMeUpService;
  let mockInteraction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCatchMeUpService = {
      generateCatchUp: jest.fn().mockResolvedValue({
        success: true,
        message: 'Here is what you missed: lots of AI papers and some k8s drama.'
      })
    };

    mockInteraction = {
      user: {
        id: 'user123',
        tag: 'TestUser#1234',
        send: jest.fn().mockResolvedValue({})
      },
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

    command = new CatchMeUpSlashCommand(mockCatchMeUpService);
  });

  describe('execute', () => {
    it('should call generateCatchUp with user and guild IDs', async () => {
      await command.execute(mockInteraction, {});

      expect(mockCatchMeUpService.generateCatchUp).toHaveBeenCalledWith('user123', 'guild456', { days: null });
    });

    it('should send catch-up via DM', async () => {
      await command.execute(mockInteraction, {});

      expect(mockInteraction.user.send).toHaveBeenCalledWith(
        expect.stringContaining('what you missed')
      );
    });

    it('should confirm to user in channel that DM was sent', async () => {
      await command.execute(mockInteraction, {});

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('DM')
        })
      );
    });

    it('should handle nothing-new gracefully', async () => {
      mockCatchMeUpService.generateCatchUp.mockResolvedValue({
        success: true,
        nothingNew: true,
        message: 'Nothing notable happened.'
      });

      await command.execute(mockInteraction, {});

      // Should still reply in channel, not DM (nothing to report)
      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Nothing notable')
        })
      );
      expect(mockInteraction.user.send).not.toHaveBeenCalled();
    });

    it('should handle DM failure gracefully', async () => {
      mockInteraction.user.send.mockRejectedValue(new Error('Cannot send messages to this user'));

      await command.execute(mockInteraction, {});

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('couldn\'t send')
        })
      );
    });

    it('should split long messages into chunks for DM', async () => {
      const longMessage = 'A'.repeat(3000);
      mockCatchMeUpService.generateCatchUp.mockResolvedValue({
        success: true,
        message: longMessage
      });

      await command.execute(mockInteraction, {});

      // Should have sent multiple DMs
      expect(mockInteraction.user.send).toHaveBeenCalledTimes(2);
      // Each chunk should be <= 2000 chars
      mockInteraction.user.send.mock.calls.forEach(call => {
        expect(call[0].length).toBeLessThanOrEqual(2000);
      });
    });

    it('should pass days parameter when specified', async () => {
      mockInteraction.options.getInteger.mockReturnValue(7);

      await command.execute(mockInteraction, {});

      expect(mockCatchMeUpService.generateCatchUp).toHaveBeenCalledWith(
        'user123', 'guild456', { days: 7 }
      );
    });

    it('should pass null days when not specified', async () => {
      await command.execute(mockInteraction, {});

      expect(mockCatchMeUpService.generateCatchUp).toHaveBeenCalledWith(
        'user123', 'guild456', { days: null }
      );
    });

    it('should handle service errors gracefully', async () => {
      mockCatchMeUpService.generateCatchUp.mockResolvedValue({
        success: false,
        error: 'Something broke'
      });

      await command.execute(mockInteraction, {});

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Something broke')
        })
      );
    });
  });
});
