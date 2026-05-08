"""Real-cluster adapter implementing the orchestrator's K8sClient Protocol.

No unit tests — this code is only meaningfully correct when run against a
real Kubernetes API server, which happens in Phase 9 manual integration tests.
"""
import asyncio
import time

from kubernetes import client as kube_client  # noqa: F401  (typing reference)
from kubernetes.client.rest import ApiException
from kubernetes.stream import stream


class LiveK8sClient:
    def __init__(self, *, batch, core, namespace: str) -> None:
        self._batch = batch
        self._core = core
        self._ns = namespace

    async def create_job(self, spec: dict) -> str:
        try:
            created = await asyncio.to_thread(
                self._batch.create_namespaced_job, self._ns, spec,
            )
            return created.metadata.name
        except ApiException as e:
            if e.status in (403, 422):
                raise RuntimeError("unschedulable") from e
            raise

    async def wait_pod_ready(self, job_name: str, timeout_s: int) -> str:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            pods = await asyncio.to_thread(
                self._core.list_namespaced_pod,
                self._ns,
                label_selector=f"job-name={job_name}",
            )
            if pods.items:
                pod = pods.items[0]
                for cs in (pod.status.container_statuses or []):
                    waiting = cs.state.waiting if cs.state else None
                    if waiting and waiting.reason in ("ImagePullBackOff", "ErrImagePull"):
                        raise RuntimeError("image_pull")
                if pod.status.phase == "Running":
                    return pod.metadata.name
            await asyncio.sleep(0.5)
        raise RuntimeError("ready_timeout")

    async def stream_stdin_and_wait(
        self, pod_name: str, payload: bytes, deadline_s: int,
    ) -> tuple[int, str, bool, bool]:
        """Open an exec/attach channel, write payload to stdin, wait for the
        pod to terminate, then return (exit_code, combined_logs, timed_out,
        oom_killed). Runs the blocking kubernetes-client calls on a worker
        thread."""

        def _do() -> tuple[int, str, bool, bool]:
            ws = stream(
                self._core.connect_get_namespaced_pod_attach,
                pod_name,
                self._ns,
                stdin=True,
                stdout=False,
                stderr=False,
                tty=False,
                _preload_content=False,
            )
            try:
                ws.write_stdin(payload.decode("utf-8"))
                ws.close()
            finally:
                try:
                    ws.update(timeout=1)
                except Exception:  # noqa: BLE001
                    pass

            t0 = time.monotonic()
            pod = self._core.read_namespaced_pod(pod_name, self._ns)
            while time.monotonic() - t0 < deadline_s + 5:
                if pod.status.phase in ("Succeeded", "Failed"):
                    break
                time.sleep(0.5)
                pod = self._core.read_namespaced_pod(pod_name, self._ns)

            timed_out = False
            oom_killed = False
            exit_code = 0
            for cs in (pod.status.container_statuses or []):
                terminated = cs.state.terminated if cs.state else None
                if terminated:
                    exit_code = terminated.exit_code or 0
                    if terminated.reason == "OOMKilled":
                        oom_killed = True
                    if terminated.reason == "DeadlineExceeded":
                        timed_out = True
            if pod.status.reason == "DeadlineExceeded":
                timed_out = True

            logs = self._core.read_namespaced_pod_log(pod_name, self._ns)
            return exit_code, logs, timed_out, oom_killed

        return await asyncio.to_thread(_do)

    async def get_pod_node(self, pod_name: str) -> str | None:
        try:
            pod = await asyncio.to_thread(self._core.read_namespaced_pod, pod_name, self._ns)
            return pod.spec.node_name
        except ApiException:
            return None

    async def delete_job(self, job_name: str) -> None:
        try:
            await asyncio.to_thread(
                self._batch.delete_namespaced_job,
                job_name,
                self._ns,
                propagation_policy="Foreground",
            )
        except ApiException:
            pass
