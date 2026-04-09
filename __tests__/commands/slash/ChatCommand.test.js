// __tests__/commands/slash/ChatCommand.test.js
// Tests for ChatSlashCommand - prompt display in responses

// Mock the logger
jest.mock('../../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Mock personalities
jest.mock('../../../personalities', () => ({
  get: jest.fn((id) => {
    const personalities = {
      'friendly': {
        id: 'friendly',
        name: 'Friendly Assistant',
        emoji: '😊',
        description: 'A friendly assistant',
        systemPrompt: 'You are a friendly assistant.'
      }
    };
    return personalities[id] || null;
  }),
  list: jest.fn(() => [
    { id: 'friendly', name: 'Friendly Assistant', emoji: '😊', description: 'A friendly assistant' }
  ])
}));

// Mock LocalLlmService
jest.mock('../../../services/LocalLlmService', () => ({
  checkUncensoredAccess: jest.fn()
}));

const ChatSlashCommand = require('../../../commands/slash/ChatCommand');

describe('ChatSlashCommand', () => {
  let command;
  let mockChatService;
  let mockInteraction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockChatService = {
      chat: jest.fn().mockResolvedValue({
        success: true,
        message: 'Hello! How can I help you today?',
        personality: {
          id: 'friendly',
          name: 'Friendly Assistant',
          emoji: '😊'
        },
        tokens: { input: 100, output: 50, total: 150 }
      })
    };

    mockInteraction = {
      user: { id: 'user123', tag: 'TestUser#1234' },
      channel: { id: 'channel123', nsfw: false },
      guild: { id: 'guild456' },
      options: {
        getString: jest.fn((name) => {
          if (name === 'message') return 'What is the meaning of life?';
          if (name === 'personality') return 'friendly';
          return null;
        }),
        getAttachment: jest.fn().mockReturnValue(null),
        getBoolean: jest.fn().mockReturnValue(false)
      },
      editReply: jest.fn().mockResolvedValue({}),
      deferReply: jest.fn().mockResolvedValue({}),
      reply: jest.fn().mockResolvedValue({}),
      followUp: jest.fn().mockResolvedValue({}),
      deferred: true,
      replied: false
    };

    command = new ChatSlashCommand(mockChatService);
  });

  describe('execute', () => {
    it('should include user prompt in response', async () => {
      await command.execute(mockInteraction, {});

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('**Prompt:** What is the meaning of life?')
        })
      );
    });

    it('should include personality header after prompt', async () => {
      await command.execute(mockInteraction, {});

      const response = mockInteraction.editReply.mock.calls[0][0].content;
      expect(response).toContain('**Prompt:**');
      expect(response).toContain('😊 **Friendly Assistant**');
    });

    it('should show prompt before personality response', async () => {
      await command.execute(mockInteraction, {});

      const response = mockInteraction.editReply.mock.calls[0][0].content;
      const promptIndex = response.indexOf('**Prompt:**');
      const personalityIndex = response.indexOf('😊 **Friendly Assistant**');
      expect(promptIndex).toBeLessThan(personalityIndex);
    });

    it('should include the AI response message', async () => {
      await command.execute(mockInteraction, {});

      const response = mockInteraction.editReply.mock.calls[0][0].content;
      expect(response).toContain('Hello! How can I help you today?');
    });

    it('should not include prompt line in error responses', async () => {
      mockChatService.chat.mockResolvedValue({
        success: false,
        error: 'Something went wrong'
      });

      await command.execute(mockInteraction, {});

      const response = mockInteraction.editReply.mock.calls[0][0].content;
      expect(response).not.toContain('**Prompt:**');
    });
  });
});
