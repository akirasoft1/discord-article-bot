#!/usr/bin/env python3
"""Sandbox executor shim — reads {language, code, stdin?} from stdin,
runs it, exits with the child's exit code. Output is unmodified."""
import json
import pathlib
import subprocess
import sys
import tempfile

LANG_RUNNERS = {
    "bash":   ("sh",   None),
    "python": ("py",   ["python3", "{file}"]),
    "node":   ("js",   ["node", "{file}"]),
    "go":     ("go",   ["go", "run", "{file}"]),
    "rust":   ("rs",   ["sh", "-c", "rustc -o /tmp/a {file} && /tmp/a"]),
    "csharp": ("cs",   ["sh", "-c",
                        "mkdir -p /work/proj && cd /work/proj && "
                        "dotnet new console --force -o . > /dev/null && "
                        "cp {file} Program.cs && dotnet run"]),
    "raw":    (None,   None),
}


def main() -> None:
    spec = json.load(sys.stdin)
    lang = spec.get("language", "bash")
    code = spec.get("code", "")
    stdin_data = spec.get("stdin")

    if lang not in LANG_RUNNERS:
        print(f"unsupported language: {lang}", file=sys.stderr)
        sys.exit(2)

    ext, argv = LANG_RUNNERS[lang]

    if lang in ("raw", "bash"):
        proc_argv = ["sh", "-c", code]
    else:
        f = pathlib.Path(tempfile.mkstemp(suffix=f".{ext}", dir="/work")[1])
        f.write_text(code)
        proc_argv = [a.replace("{file}", str(f)) for a in argv]

    try:
        result = subprocess.run(
            proc_argv,
            input=stdin_data,
            text=True,
            capture_output=False,
            timeout=None,
        )
        sys.exit(result.returncode)
    except FileNotFoundError as e:
        print(f"runtime missing: {e}", file=sys.stderr)
        sys.exit(127)


if __name__ == "__main__":
    main()
