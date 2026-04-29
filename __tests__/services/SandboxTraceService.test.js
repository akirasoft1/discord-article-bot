const SandboxTraceService = require('../../services/SandboxTraceService');

describe('SandboxTraceService', () => {
  let service;
  let fakeColl;

  beforeEach(() => {
    fakeColl = {
      findOne: jest.fn().mockImplementation(({ execution_id }) => {
        if (execution_id === 'exec-1') {
          return Promise.resolve({
            execution_id: 'exec-1',
            language: 'python',
            code: 'print(1)',
            stdout: '1\n',
            stderr: '',
            exit_code: 0,
          });
        }
        return Promise.resolve(null);
      }),
    };
    service = new SandboxTraceService({ collection: fakeColl });
  });

  it('returns trace by execution_id', async () => {
    const result = await service.getByExecutionId('exec-1');
    expect(result.code).toBe('print(1)');
  });

  it('returns null when not found', async () => {
    expect(await service.getByExecutionId('missing')).toBeNull();
  });

  it('returns null when executionId falsy', async () => {
    expect(await service.getByExecutionId('')).toBeNull();
    expect(fakeColl.findOne).not.toHaveBeenCalled();
  });

  it('builds code attachment buffer with correct extension', () => {
    const trace = { execution_id: 'exec-1', language: 'python', code: 'print(42)' };
    const att = service.buildCodeAttachment(trace);
    expect(att.filename).toBe('code-exec-1.py');
    expect(att.buffer.toString()).toBe('print(42)');
  });

  it('uses .sh for bash and .cs for csharp', () => {
    expect(service.buildCodeAttachment({ execution_id: 'a', language: 'bash', code: 'x' }).filename).toMatch(/\.sh$/);
    expect(service.buildCodeAttachment({ execution_id: 'a', language: 'csharp', code: 'x' }).filename).toMatch(/\.cs$/);
  });

  it('falls back to .txt for unknown language', () => {
    expect(service.buildCodeAttachment({ execution_id: 'a', language: 'cobol', code: 'x' }).filename).toMatch(/\.txt$/);
  });

  it('builds stdout/stderr attachments', () => {
    const stdout = service.buildStdoutAttachment({ execution_id: 'e1', stdout: 'hello' });
    const stderr = service.buildStderrAttachment({ execution_id: 'e1', stderr: 'oops' });
    expect(stdout.filename).toBe('stdout-e1.txt');
    expect(stdout.buffer.toString()).toBe('hello');
    expect(stderr.filename).toBe('stderr-e1.txt');
    expect(stderr.buffer.toString()).toBe('oops');
  });
});
