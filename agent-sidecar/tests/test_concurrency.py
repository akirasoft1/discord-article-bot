import asyncio
import pytest

from src.concurrency import ConcurrencyGate, GateAcquireError


async def test_acquire_within_caps_succeeds():
    gate = ConcurrencyGate(per_user=2, global_=15)
    async with gate.acquire(user_id="u1"):
        async with gate.acquire(user_id="u1"):
            pass


async def test_per_user_cap_blocks_third_for_same_user():
    gate = ConcurrencyGate(per_user=2, global_=15)

    async def hold():
        async with gate.acquire(user_id="u1"):
            await asyncio.sleep(0.5)

    t1 = asyncio.create_task(hold())
    t2 = asyncio.create_task(hold())
    await asyncio.sleep(0.05)  # let them grab their slots

    with pytest.raises(GateAcquireError) as exc:
        async with gate.acquire(user_id="u1", wait=False):
            pass
    assert exc.value.scope == "user"

    await t1
    await t2


async def test_per_user_cap_does_not_block_other_users():
    gate = ConcurrencyGate(per_user=2, global_=15)

    async def hold(user):
        async with gate.acquire(user_id=user):
            await asyncio.sleep(0.3)

    holders = [asyncio.create_task(hold("u1")) for _ in range(2)]
    await asyncio.sleep(0.05)

    async with gate.acquire(user_id="u2", wait=False):
        pass  # u2 unaffected

    await asyncio.gather(*holders)


async def test_global_cap_blocks_when_exhausted():
    gate = ConcurrencyGate(per_user=10, global_=2)

    async def hold(user):
        async with gate.acquire(user_id=user):
            await asyncio.sleep(0.3)

    holders = [asyncio.create_task(hold(f"u{i}")) for i in range(2)]
    await asyncio.sleep(0.05)

    with pytest.raises(GateAcquireError) as exc:
        async with gate.acquire(user_id="u3", wait=False):
            pass
    assert exc.value.scope == "global"

    await asyncio.gather(*holders)
