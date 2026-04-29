"""Environment-driven configuration for the agent sidecar."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    # gRPC
    grpc_listen_addr: str

    # OpenAI (borrowed from bot's secret mount)
    openai_api_key: str
    openai_model: str

    # MongoDB
    mongo_uri: str

    # Sandbox knobs (mirror the spec's ConfigMap)
    sandbox_inline_output_chars: int
    sandbox_wall_clock_seconds: int
    sandbox_per_user_concurrency: int
    sandbox_global_concurrency: int
    sandbox_memory_limit: str
    sandbox_cpu_limit: str
    sandbox_base_image: str
    sandbox_trace_retention_per_user: int
    sandbox_agent_turn_call_budget: int

    # K8s
    k8s_namespace: str

    # OTel
    otlp_endpoint: str | None
    otlp_headers: str | None


def load() -> Config:
    return Config(
        grpc_listen_addr=os.environ.get("GRPC_LISTEN_ADDR", "0.0.0.0:50051"),
        openai_api_key=os.environ["OPENAI_API_KEY"],
        openai_model=os.environ.get("OPENAI_MODEL", "gpt-5.1"),
        mongo_uri=os.environ["MONGO_URI"],
        sandbox_inline_output_chars=int(os.environ.get("SANDBOX_INLINE_OUTPUT_CHARS", "750")),
        sandbox_wall_clock_seconds=int(os.environ.get("SANDBOX_WALL_CLOCK_SECONDS", "300")),
        sandbox_per_user_concurrency=int(os.environ.get("SANDBOX_PER_USER_CONCURRENCY", "2")),
        sandbox_global_concurrency=int(os.environ.get("SANDBOX_GLOBAL_CONCURRENCY", "15")),
        sandbox_memory_limit=os.environ.get("SANDBOX_MEMORY_LIMIT", "2Gi"),
        sandbox_cpu_limit=os.environ.get("SANDBOX_CPU_LIMIT", "2"),
        sandbox_base_image=os.environ["SANDBOX_BASE_IMAGE"],
        sandbox_trace_retention_per_user=int(os.environ.get("SANDBOX_TRACE_RETENTION_PER_USER", "50")),
        sandbox_agent_turn_call_budget=int(os.environ.get("SANDBOX_AGENT_TURN_CALL_BUDGET", "8")),
        k8s_namespace=os.environ.get("K8S_NAMESPACE", "discord-article-bot"),
        otlp_endpoint=os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"),
        otlp_headers=os.environ.get("OTEL_EXPORTER_OTLP_HEADERS"),
    )
