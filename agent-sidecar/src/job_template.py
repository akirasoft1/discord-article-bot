"""K8s Job spec generator for sandbox executions."""
from typing import Any


def build_job_spec(
    *,
    execution_id: str,
    user_id: str,
    image: str,
    wall_clock_seconds: int,
    cpu_limit: str,
    memory_limit: str,
    env: dict[str, str],
    namespace: str,
) -> dict[str, Any]:
    """Build a K8s Job spec for a single sandbox execution.

    The Job runs one Pod with one container under runtimeClassName:
    kata-qemu. Each invocation lands in a fresh tiny VM (Kata Containers /
    QEMU shim) — a stronger isolation boundary than syscall interception
    and a natural fit for Harvester clusters where KubeVirt is already in
    use. Returns a plain dict suitable for kubernetes
    BatchV1Api.create_namespaced_job.
    """
    user_short = user_id[:8] if user_id else "anon"
    return {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {
            "generateName": f"sandbox-{user_short}-",
            "namespace": namespace,
            "labels": {
                "app.kubernetes.io/component": "sandbox",
                "sandbox.user-id": user_id,
                "sandbox.execution-id": execution_id,
            },
        },
        "spec": {
            "ttlSecondsAfterFinished": 30,
            "backoffLimit": 0,
            "activeDeadlineSeconds": wall_clock_seconds,
            "template": {
                "metadata": {
                    "labels": {
                        "app.kubernetes.io/component": "sandbox",
                        "sandbox.user-id": user_id,
                        "sandbox.execution-id": execution_id,
                    },
                },
                "spec": {
                    "runtimeClassName": "kata-qemu",
                    "automountServiceAccountToken": False,
                    "serviceAccountName": "sandbox-sa",
                    "restartPolicy": "Never",
                    "enableServiceLinks": False,
                    "securityContext": {
                        "runAsUser": 65534,
                        "runAsGroup": 65534,
                        "runAsNonRoot": True,
                        "fsGroup": 65534,
                        "seccompProfile": {"type": "RuntimeDefault"},
                    },
                    "containers": [
                        {
                            "name": "executor",
                            "image": image,
                            "imagePullPolicy": "IfNotPresent",
                            "command": ["/usr/local/bin/executor"],
                            "stdin": True,
                            "stdinOnce": True,
                            "tty": False,
                            "resources": {
                                "requests": {"cpu": "500m", "memory": "512Mi"},
                                "limits": {
                                    "cpu": cpu_limit,
                                    "memory": memory_limit,
                                    "ephemeral-storage": "256Mi",
                                },
                            },
                            "securityContext": {
                                "allowPrivilegeEscalation": False,
                                "readOnlyRootFilesystem": True,
                                "capabilities": {"drop": ["ALL"]},
                            },
                            "volumeMounts": [
                                {"name": "tmp", "mountPath": "/tmp"},
                                {"name": "work", "mountPath": "/work"},
                            ],
                            "workingDir": "/work",
                            "env": [{"name": k, "value": v} for k, v in env.items()],
                        }
                    ],
                    "volumes": [
                        {
                            "name": "tmp",
                            "emptyDir": {"sizeLimit": "256Mi", "medium": "Memory"},
                        },
                        {
                            "name": "work",
                            "emptyDir": {"sizeLimit": "256Mi", "medium": "Memory"},
                        },
                    ],
                },
            },
        },
    }
