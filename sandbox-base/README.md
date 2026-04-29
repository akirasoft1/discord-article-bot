# sandbox-base

Container image used by the agent-sidecar to spawn ephemeral execution pods.

## Build

```bash
docker build -t mvilliger/sandbox-base:$(git rev-parse --short HEAD) .
docker tag  mvilliger/sandbox-base:$(git rev-parse --short HEAD) mvilliger/sandbox-base:latest
docker push mvilliger/sandbox-base:$(git rev-parse --short HEAD)
docker push mvilliger/sandbox-base:latest
```

## Local smoke test

```bash
echo '{"language":"python","code":"print(2+2)"}' \
  | docker run --rm -i mvilliger/sandbox-base:latest
```

Expected: `4`, exit 0.

```bash
echo '{"language":"bash","code":"curl -s https://example.com | head -1"}' \
  | docker run --rm -i mvilliger/sandbox-base:latest
```

Expected: HTML doctype line, exit 0.

## Image contents

- python3, node 20, go, rust stable, .NET 8 SDK
- build-essential, git, jq, ripgrep
- nmap, dig, nc
- ollama (binary only; pull models at runtime via `ollama pull <model>`)

The image is ~3-4Gi. Pulled once per K8s node and cached.

## Security properties

- Runs as uid 65534 (nobody).
- No shell-escape pre-baked configuration. The `executor` is the only entrypoint.
- Image is consumed only by sandbox K8s pods that disable SA token automount,
  drop all capabilities, and run with `readOnlyRootFilesystem: true` plus
  `runtimeClassName: gvisor`.
