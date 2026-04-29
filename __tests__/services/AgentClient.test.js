const path = require('path');

jest.mock('../../logger', () => ({
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}));

const AgentClient = require('../../services/AgentClient');

describe('AgentClient', () => {
  let client;

  afterEach(() => {
    if (client) {
      client.close();
      client = null;
    }
  });

  it('reports unhealthy when sidecar unreachable', async () => {
    client = new AgentClient({
      address: '127.0.0.1:65535',
      protoPath: path.join(__dirname, '..', '..', 'proto', 'agent.proto'),
      healthIntervalMs: 50,
      unhealthyThresholdMs: 100,
      healthDeadlineMs: 50,
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(client.isHealthy()).toBe(false);
  });

  it('chat() rejects when unhealthy', async () => {
    client = new AgentClient({
      address: '127.0.0.1:65535',
      protoPath: path.join(__dirname, '..', '..', 'proto', 'agent.proto'),
      healthIntervalMs: 50,
      unhealthyThresholdMs: 100,
      healthDeadlineMs: 50,
    });
    await new Promise((r) => setTimeout(r, 250));
    await expect(
      client.chat({
        userId: 'u',
        userTag: 'u#0',
        channelId: 'c',
        guildId: 'g',
        interactionId: 'i',
        userMessage: 'hi',
        imageUrl: '',
      }),
    ).rejects.toThrow(/sidecar unhealthy/);
  });
});
