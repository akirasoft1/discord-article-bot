"""gRPC server entrypoint for the agent sidecar."""
import logging
import signal
from concurrent import futures

import grpc

from . import agent_pb2, agent_pb2_grpc
from .config import load as load_config
from .tracing import setup as setup_tracing

log = logging.getLogger(__name__)


class AgentServicer(agent_pb2_grpc.AgentServicer):
    def __init__(self) -> None:
        pass

    def Health(self, request: agent_pb2.HealthRequest, context):  # noqa: N802
        return agent_pb2.HealthResponse(healthy=True)

    def Chat(self, request: agent_pb2.ChatRequest, context):  # noqa: N802
        # Wired in Phase 4.
        context.set_code(grpc.StatusCode.UNIMPLEMENTED)
        context.set_details("Chat not yet implemented")
        return agent_pb2.ChatResponse()


def serve() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = load_config()
    setup_tracing(config)
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=16))
    agent_pb2_grpc.add_AgentServicer_to_server(AgentServicer(), server)
    server.add_insecure_port(config.grpc_listen_addr)
    server.start()
    log.info(f"agent sidecar listening on {config.grpc_listen_addr}")

    def handle_term(signum, frame):
        log.info("shutting down (signal %s)", signum)
        server.stop(grace=10)

    signal.signal(signal.SIGTERM, handle_term)
    signal.signal(signal.SIGINT, handle_term)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
