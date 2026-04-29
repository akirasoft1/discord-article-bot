# Agentic Sandbox Manifests

These manifests support the Python agent sidecar and Kata-Containers-based
sandbox executions (see
`docs/superpowers/specs/2026-04-28-agentic-sandbox-skills-runtime-design.md`).

## Why Kata, not gVisor

The cluster runs on Harvester (immutable SLE Micro host OS, KubeVirt for VM
workloads). The original spec called for gVisor + `runsc`, but installing
runsc into `/usr/local/bin` on each Harvester worker node is fragile under
the transactional update model — the install either fails outright or gets
wiped on the next OS update.

Kata Containers replaces the syscall-interception isolation model with a
"pod-as-tiny-VM" model: each sandbox pod boots its own QEMU/KVM guest with a
fresh kernel. The host kernel never executes the workload's syscalls; the
guest kernel does. That's a stronger isolation boundary than gVisor's
ptrace-based filtering and it leans into what Harvester already does
extremely well — so this is, on balance, a better fit even setting the
install pain aside.

**Trade-offs:**
- Cold start per sandbox call: ~1.5–3 s vs gVisor's ~200–500 ms. Acceptable
  given Discord conversational latency, and called out to the agent in its
  prompt so it doesn't think a long call has hung.
- No syscall-deny telemetry. gVisor's `gvisor_events` field has been
  renamed to a runtime-neutral `runtime_events` (kept empty by default
  under Kata; reserved for future `auditd`-in-guest signals).
- Host-side memory overhead per pod is ~50–100 MiB higher (guest kernel +
  agent). Within our existing limits.

## Files

| File | Purpose |
|---|---|
| `runtimeclass-kata.yaml` | Cluster-wide `kata-qemu` RuntimeClass that uses the `kata` handler. |
| `agent-serviceaccount.yaml` | `agent-sa` SA used by the sidecar Deployment. |
| `agent-role.yaml` | `agent-sandbox-orchestrator` Role: create/get/list/delete Jobs, get/list/watch/create Pods + pods/log + pods/attach. |
| `agent-rolebinding.yaml` | Binds the role to `agent-sa`. |
| `sandbox-serviceaccount.yaml` | `sandbox-sa` SA for sandbox Pods (no SA token mount). |
| `sandbox-networkpolicy.yaml` | Egress: allow public internet, deny all RFC1918 + cluster pod/service CIDRs (10.52/16 and 10.53/16 — pinned to this Harvester cluster's RKE2 defaults). |
| `agent-networkpolicy.yaml` | Sidecar can reach kube-dns, in-cluster MongoDB and Qdrant, the K8s API server, and OpenAI's public API only. Ingress only from the bot pod. |
| `configmap-sandbox.yaml` | Sandbox tunables (concurrency caps, wall clock, resource limits, retention, agent toggle). |
| `agent-deployment.yaml` | Sidecar Deployment (Recreate strategy, single replica). Update the `:latest` tag to a git-sha after `Phase 9 / Task 9.1` builds the image. |
| `agent-service.yaml` | ClusterIP Service exposing the sidecar's gRPC port (50051). |

## Required modifications to existing manifests

The existing bot manifests need two small additions. Working copies live
locally in `k8s/overlays/deployed/` (gitignored); the diffs are reproduced
here for traceability.

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

## Prereq: install Kata via `kata-deploy`

`kata-deploy` is the upstream DaemonSet that drops the Kata runtime binaries
and the QEMU shim into `/opt/kata/` on each node and patches the
containerd/CRI-O config to expose the `kata`, `kata-qemu`, and `kata-clh`
handlers. On RKE2 (Harvester's K8s distro) the containerd config drop-in
path is writable even on the immutable host because RKE2 needs to manage
it itself.

The exact upstream apply URL changes per release; check
[`kata-containers/kata-containers`](https://github.com/kata-containers/kata-containers/tree/main/tools/packaging/kata-deploy)
for the current `kata-deploy.yaml`. Typical flow:

```bash
# Label the worker nodes that should host sandboxes.
kubectl label nodes <worker> katacontainers.io/kata-runtime=true

# Apply the kata-deploy DaemonSet (URL: replace with the latest release).
kubectl apply -f https://raw.githubusercontent.com/kata-containers/kata-containers/<TAG>/tools/packaging/kata-deploy/kata-deploy/base/kata-deploy.yaml

# Wait for it to settle on every labeled node.
kubectl rollout status -n kube-system ds/kata-deploy --timeout=300s

# Confirm the RuntimeClasses landed (kata-deploy ships its own; we
# additionally apply our own kata-qemu one so the manifest is self-contained).
kubectl get runtimeclass kata-qemu
```

Smoke-test with a throwaway pod:

```bash
kubectl run kata-smoke --rm -it --image=busybox \
  --overrides='{"spec":{"runtimeClassName":"kata-qemu"}}' \
  --restart=Never -- sh -c 'uname -a; cat /proc/cpuinfo | head'
```

You should see a kernel version that is *not* the host's, plus the
QEMU-style virtual CPU model — confirmation that the workload ran inside
the guest VM and not on the host kernel.

## Apply order (after kata-deploy is healthy)

```bash
# 1. Cluster-wide RuntimeClass (idempotent)
kubectl apply -f runtimeclass-kata.yaml

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

- [ ] `kata-deploy` DaemonSet healthy on every worker node that should host sandboxes
- [ ] `sandbox-networkpolicy.yaml`'s pod/service CIDRs match this cluster (default: 10.52.0.0/16 and 10.53.0.0/16)
- [ ] `mvilliger/discord-article-bot-agent:<TAG>` and `mvilliger/sandbox-base:<TAG>` pushed (Task 9.1)
- [ ] Bot deployment + bot networkpolicy updates merged (see above)
