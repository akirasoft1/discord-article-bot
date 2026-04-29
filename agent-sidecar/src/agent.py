"""ADK Agent assembly. One Agent per ChatRequest so per-turn tool state is fresh.

Adapted for google-adk 1.31.1: uses LiteLlm wrapper (from google-adk[extensions])
to drive OpenAI models, requires explicit session creation, and wraps the user
message in google.genai.types.Content.
"""
import logging
from dataclasses import dataclass

from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner
from google.adk.models.lite_llm import LiteLlm
from google.genai import types

from .config import Config
from .orchestrator import SandboxOrchestrator
from .tools import RunInSandboxTool, ToolBudgetExceeded

log = logging.getLogger(__name__)

_APP_NAME = "discord-article-bot"

TOOL_AVAILABILITY_PREAMBLE = """
You have access to a sandboxed Linux environment via the run_in_sandbox tool.
Each call lands in a fresh, lightweight Kata VM with 2 vCPU, 2Gi RAM, 256Mi
tmpfs, and a 300s wall clock. The first call in a turn typically takes a
couple of extra seconds for VM startup; that's normal, not a hang. The
sandbox has internet access (RFC1918 blocked) and ships with python, node,
dotnet, go, rust, ollama, and common build/network tools. You cannot persist
state between calls — each invocation is a fresh pod. You receive {exit_code,
stdout, stderr, duration_ms, egress_events, runtime_events} back.

Use the sandbox WHEN:
  - The user asked you to run, build, compile, scan, fetch, or test something.
  - You need to verify a fact you'd otherwise hallucinate.
  - The user explicitly asked you to do a task that's mechanically executable.
Do NOT use the sandbox WHEN:
  - The user is having a casual conversation.
  - The task is purely social/creative writing/discussion.
  - You can answer accurately from your own knowledge or recent channel context.

You do not have to ask permission to use the sandbox; the user has pre-consented.
Surface what you actually did in your final reply (one short sentence).
Do NOT prefix your reply with a personality header. Do NOT include code blocks
unless they're trivially short and serve the explanation; long code is auto-attached
via reaction reveal.
""".strip()


@dataclass
class AgentChatResult:
    message_text: str
    execution_ids: list[str]
    any_failed: bool


class ChannelVoiceAgent:
    """Wraps the ADK Agent so the gRPC server can call it without
    knowing ADK internals."""

    def __init__(
        self,
        *,
        config: Config,
        orchestrator: SandboxOrchestrator,
        base_system_prompt: str,
    ) -> None:
        self._config = config
        self._orch = orchestrator
        self._base_system_prompt = base_system_prompt

    async def process_chat(self, *, user_id: str, user_message: str) -> AgentChatResult:
        tool = RunInSandboxTool(
            orch=self._orch,
            user_id=user_id,
            call_budget=self._config.sandbox_agent_turn_call_budget,
        )

        async def run_in_sandbox(
            language: str,
            code: str,
            stdin: str | None = None,
            env: dict[str, str] | None = None,
        ) -> dict:
            """Execute code in the Kata sandbox.

            Args:
              language: one of 'bash', 'python', 'node', 'csharp', 'go', 'rust', 'raw'.
              code: full source or shell command.
              stdin: optional stdin piped to the process.
              env: extra environment variables. Use ONLY for user-supplied keys; never invent.

            Returns:
              dict with exit_code, stdout, stderr, duration_ms, egress_events, etc.
            """
            try:
                return await tool.run(language=language, code=code, stdin=stdin, env=env)
            except ToolBudgetExceeded:
                return {"exit_code": -3, "error": "turn_call_budget_exceeded"}

        agent = Agent(
            name="channel_voice",
            description="Discord channel-voice agent with sandboxed execution capabilities.",
            instruction=f"{self._base_system_prompt}\n\n{TOOL_AVAILABILITY_PREAMBLE}",
            tools=[run_in_sandbox],
            model=LiteLlm(model=f"openai/{self._config.openai_model}"),
        )
        runner = InMemoryRunner(agent=agent, app_name=_APP_NAME)
        await runner.session_service.create_session(
            app_name=_APP_NAME, user_id=user_id, session_id=user_id,
        )

        new_message = types.Content(role="user", parts=[types.Part(text=user_message)])
        message_text = ""
        try:
            async for event in runner.run_async(
                user_id=user_id, session_id=user_id, new_message=new_message,
            ):
                content = getattr(event, "content", None)
                if content is None:
                    continue
                parts = getattr(content, "parts", None) or []
                for part in parts:
                    text = getattr(part, "text", None)
                    if text:
                        message_text = text
        finally:
            try:
                await runner.close()
            except Exception:  # noqa: BLE001
                log.debug("runner.close() failed", exc_info=True)

        any_failed = any(getattr(r, "exit_code", 0) != 0 for r in tool.results)
        return AgentChatResult(
            message_text=message_text,
            execution_ids=list(tool.execution_ids),
            any_failed=any_failed,
        )
