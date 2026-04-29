// SandboxTraceService — reads sandbox_executions docs and assembles
// reaction-reveal payloads (code, stdout, stderr) as Discord-ready
// {filename, buffer} pairs.

const EXT = {
  bash: 'sh',
  python: 'py',
  node: 'js',
  go: 'go',
  rust: 'rs',
  csharp: 'cs',
  raw: 'sh',
};

class SandboxTraceService {
  constructor({ collection }) {
    this._coll = collection;
  }

  async getByExecutionId(executionId) {
    if (!executionId) return null;
    return this._coll.findOne({ execution_id: executionId });
  }

  buildCodeAttachment(trace) {
    const ext = EXT[trace.language] || 'txt';
    return {
      filename: `code-${trace.execution_id || 'unknown'}.${ext}`,
      buffer: Buffer.from(trace.code || '', 'utf-8'),
    };
  }

  buildStdoutAttachment(trace) {
    return {
      filename: `stdout-${trace.execution_id || 'unknown'}.txt`,
      buffer: Buffer.from(trace.stdout || '', 'utf-8'),
    };
  }

  buildStderrAttachment(trace) {
    return {
      filename: `stderr-${trace.execution_id || 'unknown'}.txt`,
      buffer: Buffer.from(trace.stderr || '', 'utf-8'),
    };
  }
}

module.exports = SandboxTraceService;
