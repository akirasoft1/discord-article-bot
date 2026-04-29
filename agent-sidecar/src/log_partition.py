"""Split combined pod logs into stdout/stderr streams.

The sandbox executor prefixes stderr lines with __SBSTDERR__: so they can
be separated from stdout in K8s pod logs. This module reverses that.
"""
STDERR_PREFIX = "__SBSTDERR__:"


def partition_logs(raw: str) -> tuple[str, str]:
    if not raw:
        return "", ""
    stdout_parts: list[str] = []
    stderr_parts: list[str] = []
    has_trailing_newline = raw.endswith("\n")
    lines = raw.split("\n")
    # split("\n") on "a\nb" gives ["a", "b"] — 2 items, no trailing newline.
    # split("\n") on "a\nb\n" gives ["a", "b", ""] — last item is empty sentinel.
    # The last item in each case should NOT receive a trailing "\n" unless it was
    # present in the original (i.e. has_trailing_newline).
    last_idx = len(lines) - 1
    for i, line in enumerate(lines):
        is_last = i == last_idx
        # Skip the empty sentinel produced by a trailing newline
        if is_last and has_trailing_newline and line == "":
            break
        terminator = "\n" if (not is_last or has_trailing_newline) else ""
        if line.startswith(STDERR_PREFIX):
            stderr_parts.append(line[len(STDERR_PREFIX):] + terminator)
        else:
            stdout_parts.append(line + terminator)
    return "".join(stdout_parts), "".join(stderr_parts)
