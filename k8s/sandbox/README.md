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

## Prereq: install Kata via the upstream Helm chart

Upstream's preferred install path is the `kata-deploy` Helm chart, published
as an OCI artifact at `oci://ghcr.io/kata-containers/kata-deploy-charts/kata-deploy`.
The chart deploys the kata-deploy DaemonSet (which drops Kata binaries and
the QEMU shim into `/opt/kata/` on each labeled node and patches the
containerd config) AND installs the standard Kata `RuntimeClass`es
(`kata`, `kata-qemu`, `kata-clh`, `kata-fc`). On RKE2 (Harvester's K8s
distro) the containerd config drop-in path under `/var/lib/rancher/rke2/`
is writable even on SLE Micro's immutable root because RKE2 needs to
manage it itself.

```bash
# Pin to the latest stable Kata release.
export KATA_VERSION=$(curl -sSL https://api.github.com/repos/kata-containers/kata-containers/releases/latest | jq -r .tag_name)
export KATA_CHART="oci://ghcr.io/kata-containers/kata-deploy-charts/kata-deploy"
echo "kata version: $KATA_VERSION"

# (Optional) inspect what's configurable for this release before installing.
helm show values "$KATA_CHART" --version "$KATA_VERSION"

# Install. The chart creates kata-deploy in kube-system by default and
# installs the kata, kata-qemu, kata-clh, kata-fc RuntimeClasses for you.
helm install kata-deploy "$KATA_CHART" --version "$KATA_VERSION" -n kube-system

# Wait for the DaemonSet to settle on every node it targets.
kubectl rollout status -n kube-system ds/kata-deploy --timeout=600s

# Confirm the kata-qemu RuntimeClass is present.
kubectl get runtimeclass kata-qemu
```

Smoke-test with a throwaway pod that selects the runtime class:

```bash
kubectl run kata-smoke --rm -it --image=busybox \
  --overrides='{"spec":{"runtimeClassName":"kata-qemu"}}' \
  --restart=Never -- sh -c 'uname -a; cat /proc/cpuinfo | head'
```

You should see a kernel version that is *not* the host's, plus the
QEMU-style virtual CPU model — confirmation that the workload ran inside
the guest VM and not on the host kernel.

> **About `runtimeclass-kata.yaml` in this directory.** The Helm chart
> already creates the `kata-qemu` RuntimeClass, so this manifest is
> **not** part of the apply order below. It's kept in the repo as an
> explicit, in-version-control declaration of the RuntimeClass we depend
> on (and as a fallback if Kata is ever installed by some other path
> that doesn't ship the RuntimeClass for us).

## Apply order (after kata-deploy is healthy)

```bash
# All resources are namespace-scoped; the Helm chart already created the
# RuntimeClass so we don't need to apply runtimeclass-kata.yaml here.
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

- [ ] `helm list -n kube-system` shows `kata-deploy` deployed; the DaemonSet is healthy on every worker node
- [ ] `sandbox-networkpolicy.yaml`'s pod/service CIDRs match this cluster (default: 10.52.0.0/16 and 10.53.0.0/16)
- [ ] `mvilliger/discord-article-bot-agent:<TAG>` and `mvilliger/sandbox-base:<TAG>` pushed (Task 9.1)
- [ ] Bot deployment + bot networkpolicy updates merged (see above)
