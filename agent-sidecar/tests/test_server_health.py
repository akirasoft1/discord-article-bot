import grpc
import pytest
from concurrent import futures

from src import agent_pb2, agent_pb2_grpc
from src.server import AgentServicer


@pytest.fixture
def grpc_server():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=2))
    agent_pb2_grpc.add_AgentServicer_to_server(AgentServicer(), server)
    port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    yield port
    server.stop(grace=0)


def test_health_returns_healthy(grpc_server):
    port = grpc_server
    with grpc.insecure_channel(f"127.0.0.1:{port}") as channel:
        stub = agent_pb2_grpc.AgentStub(channel)
        resp = stub.Health(agent_pb2.HealthRequest())
    assert resp.healthy is True


def test_chat_unimplemented_for_now(grpc_server):
    port = grpc_server
    with grpc.insecure_channel(f"127.0.0.1:{port}") as channel:
        stub = agent_pb2_grpc.AgentStub(channel)
        with pytest.raises(grpc.RpcError) as exc:
            stub.Chat(agent_pb2.ChatRequest(user_id="u", user_message="hi"))
    assert exc.value.code() == grpc.StatusCode.UNIMPLEMENTED
