# Agentic Sandbox Manifests

These manifests support the Python agent sidecar and gVisor sandbox executions
(see `docs/superpowers/specs/2026-04-28-agentic-sandbox-skills-runtime-design.md`).

## Files

| File | Purpose |
|---|---|
| `runtimeclass-gvisor.yaml` | Cluster-wide `gvisor` RuntimeClass that uses `runsc`. Requires `runsc` installed on each worker node. |
| `agent-serviceaccount.yaml` | `agent-sa` SA used by the sidecar Deployment. |
| `agent-role.yaml` | `agent-sandbox-orchestrator` Role: create/get/list/delete Jobs, get/list/watch/create Pods + pods/log + pods/attach. |
| `agent-rolebinding.yaml` | Binds the role to `agent-sa`. |
| `sandbox-serviceaccount.yaml` | `sandbox-sa` SA for sandbox Pods (no SA token mount). |
| `sandbox-networkpolicy.yaml` | Egress: allow public internet, deny all RFC1918 + cluster pod/service CIDRs. **You MUST replace `<CLUSTER_POD_CIDR>` and `<CLUSTER_SERVICE_CIDR>` before applying.** |
| `agent-networkpolicy.yaml` | Sidecar can reach kube-dns, in-cluster MongoDB and Qdrant, the K8s API server, and OpenAI's public API only. Ingress only from the bot pod. |
| `configmap-sandbox.yaml` | Sandbox tunables (concurrency caps, wall clock, resource limits, retention, agent toggle). |
| `agent-deployment.yaml` | Sidecar Deployment (Recreate strategy, single replica). Update the `:latest` tag to a git-sha after `Phase 9 / Task 9.1` builds the image. |
| `agent-service.yaml` | ClusterIP Service exposing the sidecar's gRPC port (50051). |

## Required modifications to existing manifests

The existing bot manifests need two small additions. Working copies are
maintained locally in `k8s/overlays/deployed/` (gitignored); the diffs below
are reproduced here for traceability.

### `deployment.yaml` (bot)

Inside the bot container's `envFrom` list, append a reference to the sandbox
ConfigMap so the bot reads `AGENT_ENABLED` and `AGENT_GRPC_ADDR`:

```yaml
          envFrom:
            - configMapRef:
                name: discord-article-bot-config
            - configMapRef:
                name: sandbox-config
                optional: true
```

### `networkpolicy.yaml` (bot)

Append an egress rule allowing the bot to reach the agent sidecar's gRPC port:

```yaml
    # Allow bot -> agent sidecar gRPC
    - to:
        - podSelector:
            matchLabels:
              app: discord-article-bot-agent
      ports:
        - protocol: TCP
          port: 50051
```

## Apply order

```bash
# 1. Cluster-wide RuntimeClass (idempotent)
kubectl apply -f runtimeclass-gvisor.yaml

# 2. Namespace-scoped resources
kubectl apply -n discord-article-bot \
  -f agent-serviceaccount.yaml \
  -f sandbox-serviceaccount.yaml \
  -f agent-role.yaml \
  -f agent-rolebinding.yaml \
  -f configmap-sandbox.yaml \
  -f agent-networkpolicy.yaml \
  -f sandbox-networkpolicy.yaml \
  -f agent-deployment.yaml \
  -f agent-service.yaml
```

## Pre-apply checklist

- [ ] `runsc` installed on every worker node
- [ ] `<CLUSTER_POD_CIDR>` and `<CLUSTER_SERVICE_CIDR>` filled in `sandbox-networkpolicy.yaml`
- [ ] `mvilliger/discord-article-bot-agent:<TAG>` and `mvilliger/sandbox-base:<TAG>` pushed (Task 9.1)
- [ ] Bot deployment + bot networkpolicy updates merged (see above)
