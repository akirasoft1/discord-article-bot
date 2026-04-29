jest.mock('../../logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

jest.mock('../../tracing', () => ({
  withRootSpan: (_n, _a, fn) => fn({ setAttribute: () => {}, setAttributes: () => {} }),
  withSpan: (_n, _a, fn) => fn({ setAttribute: () => {}, setAttributes: () => {} }),
}));

const ReactionHandler = require('../../handlers/ReactionHandler');

describe('ReactionHandler.handleSandboxRevealReaction', () => {
  let handler;
  let mockMongo;
  let mockSandboxTrace;
  let mockReply;
  const user = { id: 'u1', tag: 'u#0' };

  beforeEach(() => {
    mockMongo = {
      getMessageExecutionIds: jest.fn().mockResolvedValue(['exec-1']),
    };
    mockSandboxTrace = {
      getByExecutionId: jest.fn().mockResolvedValue({
        execution_id: 'exec-1',
        language: 'python',
        code: 'print(1)',
        stdout: '1\n',
        stderr: '',
        exit_code: 0,
      }),
      buildCodeAttachment: jest.fn().mockReturnValue({ filename: 'code-exec-1.py', buffer: Buffer.from('print(1)') }),
      buildStdoutAttachment: jest.fn().mockReturnValue({ filename: 'stdout-exec-1.txt', buffer: Buffer.from('1\n') }),
      buildStderrAttachment: jest.fn().mockReturnValue({ filename: 'stderr-exec-1.txt', buffer: Buffer.from('') }),
    };
    mockReply = jest.fn().mockResolvedValue({});
    handler = new ReactionHandler({}, mockMongo, mockSandboxTrace);
  });

  function makeReaction(emojiName) {
    return {
      emoji: { name: emojiName },
      message: { id: 'm1', reply: mockReply },
    };
  }

  it('returns false for unrelated emoji', async () => {
    const result = await handler.handleSandboxRevealReaction(makeReaction('👍'), user);
    expect(result).toBe(false);
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('replies with code attachment on 🔍', async () => {
    const result = await handler.handleSandboxRevealReaction(makeReaction('🔍'), user);
    expect(result).toBe(true);
    expect(mockSandboxTrace.buildCodeAttachment).toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledTimes(1);
    const args = mockReply.mock.calls[0][0];
    expect(Array.isArray(args.files)).toBe(true);
    expect(args.files).toHaveLength(1);
    expect(args.allowedMentions).toEqual({ repliedUser: false });
  });

  it('replies with stdout only on 📜 when stderr empty', async () => {
    const result = await handler.handleSandboxRevealReaction(makeReaction('📜'), user);
    expect(result).toBe(true);
    expect(mockSandboxTrace.buildStdoutAttachment).toHaveBeenCalled();
    expect(mockSandboxTrace.buildStderrAttachment).not.toHaveBeenCalled();
    const args = mockReply.mock.calls[0][0];
    expect(args.files).toHaveLength(1);
  });

  it('includes stderr on 📜 when non-empty', async () => {
    mockSandboxTrace.getByExecutionId.mockResolvedValue({
      execution_id: 'exec-1', language: 'python', code: 'print(1)', stdout: '1\n', stderr: 'oops\n',
    });
    const result = await handler.handleSandboxRevealReaction(makeReaction('📜'), user);
    expect(result).toBe(true);
    expect(mockSandboxTrace.buildStderrAttachment).toHaveBeenCalled();
    const args = mockReply.mock.calls[0][0];
    expect(args.files).toHaveLength(2);
  });

  it('replies with stderr-only attachment on 🐛', async () => {
    const result = await handler.handleSandboxRevealReaction(makeReaction('🐛'), user);
    expect(result).toBe(true);
    expect(mockSandboxTrace.buildStderrAttachment).toHaveBeenCalled();
    const args = mockReply.mock.calls[0][0];
    expect(args.files).toHaveLength(1);
  });

  it('uses the rightmost executionId when multiple are recorded', async () => {
    mockMongo.getMessageExecutionIds.mockResolvedValue(['exec-1', 'exec-2', 'exec-3']);
    await handler.handleSandboxRevealReaction(makeReaction('🔍'), user);
    expect(mockSandboxTrace.getByExecutionId).toHaveBeenCalledWith('exec-3');
  });

  it('returns false when no executionIds tied to message', async () => {
    mockMongo.getMessageExecutionIds.mockResolvedValue([]);
    const result = await handler.handleSandboxRevealReaction(makeReaction('🔍'), user);
    expect(result).toBe(false);
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('returns false when sandboxTraceService not configured', async () => {
    handler = new ReactionHandler({}, mockMongo, null);
    const result = await handler.handleSandboxRevealReaction(makeReaction('🔍'), user);
    expect(result).toBe(false);
  });

  it('returns false when trace lookup yields nothing', async () => {
    mockSandboxTrace.getByExecutionId.mockResolvedValue(null);
    const result = await handler.handleSandboxRevealReaction(makeReaction('🔍'), user);
    expect(result).toBe(false);
  });
});
