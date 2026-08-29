"""Code execution sandbox — runs LLM-generated Python code via subprocess or Docker."""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
import textwrap
import traceback

from ..config import AGENT_INPUT_DIR, AGENT_OUTPUT_DIR

EXEC_TIMEOUT = int(os.environ.get("AGENT_EXEC_TIMEOUT", "60"))

logger = logging.getLogger("agent.executor")


# ── Code execution ─────────────────────────────────────────


class CodeExecutor:
    """Executes Python code with safety restrictions and optional Docker sandboxing."""

    def __init__(self, allowed_input: str = AGENT_INPUT_DIR,
                 allowed_output: str = AGENT_OUTPUT_DIR):
        self.allowed_input = allowed_input
        self.allowed_output = allowed_output
        self._docker_sandbox = None

    async def _get_docker_sandbox(self):
        if self._docker_sandbox is None:
            from .sandbox import get_sandbox

            self._docker_sandbox = get_sandbox()
        return self._docker_sandbox

    async def execute(self, code: str, timeout: int = EXEC_TIMEOUT) -> str:
        """Execute Python code, preferring Docker sandbox, falling back to restricted execution.

        Security model:
        - Docker sandbox = the REAL security boundary (hardware isolation).
        - safe_mode_filter = defense-in-depth for restricted execution
          (catches obvious abuse but is NOT a security boundary —
           motivated code can trivially bypass regex filters).
        - Preamble imports are for convenience, not security.
        - Restricted execution (multiprocessing/subprocess) = process isolation
          + directory whitelist only, same tier as industry local agents.
        """
        # Safety filter applies to all paths
        from .sandbox import safe_mode_filter
        safe, reason = safe_mode_filter(code)
        if not safe:
            logger.warning("Code blocked by safe_mode: %s", reason)
            return f"[错误] 代码被安全策略拦截: {reason}，请修改代码后重试"

        sandbox = await self._get_docker_sandbox()
        if await sandbox.check_available():
            if sandbox.is_ready():
                logger.info("Using Docker sandbox for execution")
                return await sandbox.execute(code, timeout)
            logger.warning("Docker daemon available but sandbox image not ready — falling back")
        else:
            logger.info("Docker not available, falling back to restricted execution")
        return await self._execute_fallback(code, timeout)

    async def _execute_fallback(self, code: str, timeout: int) -> str:
        """Restricted execution path.

        PyInstaller bundle: sys.executable is the agent exe itself, so
        `sys.executable -c` would launch a SECOND agent server instead of
        running the code. Use multiprocessing (PyInstaller supports it via
        freeze_support + the --multiprocessing-fork bootloader path) so the
        bundled Python runtime executes the code in a child process.
        """
        if getattr(sys, "frozen", False):
            return await self._execute_multiprocessing(code, timeout)
        return await self._execute_subprocess(code, timeout)

    async def _execute_multiprocessing(self, code: str, timeout: int) -> str:
        """Execute Python code in a child process via multiprocessing (spawn).

        Output goes to a temp file in OUTPUT_DIR: Windows spawn does not
        inherit os.pipe() descriptors, so fd passing is not an option.
        """
        import multiprocessing as mp
        import uuid

        os.makedirs(AGENT_OUTPUT_DIR, exist_ok=True)
        out_path = os.path.join(AGENT_OUTPUT_DIR, f".exec_out_{uuid.uuid4().hex[:12]}.txt")
        ctx = mp.get_context("spawn")
        proc = ctx.Process(target=_run_code_in_child, args=(code, out_path), daemon=True)
        try:
            proc.start()
        except Exception as e:
            logger.error("Multiprocessing executor failed to start: %s", e, exc_info=True)
            return "[错误] 代码执行失败，请检查代码语法和逻辑后重试"

        timed_out = False
        try:
            await asyncio.wait_for(
                asyncio.get_running_loop().run_in_executor(None, proc.join), timeout
            )
        except asyncio.TimeoutError:
            timed_out = True
        finally:
            proc.join(timeout=5)
            if proc.is_alive():
                proc.terminate()
                proc.join(timeout=5)
        try:
            with open(out_path, "r", encoding="utf-8", errors="replace") as f:
                output = f.read()
        except OSError:
            output = ""
        finally:
            try:
                os.remove(out_path)
            except OSError:
                pass
        if timed_out:
            return f"[错误] 代码执行超时 ({timeout}秒)"
        return output.strip() or "(无输出)"

    async def _execute_subprocess(self, code: str, timeout: int) -> str:
        """Execute Python code in a subprocess with safety restrictions.

        Note: subprocess mode has NO memory/CPU resource isolation.
        For resource-constrained execution, use Docker sandbox (DOCKER_MODE=auto).
        """
        wrapped = _wrap_code(code)
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                wrapped,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
            stdout_str = stdout.decode("utf-8", errors="replace").strip()
            stderr_str = stderr.decode("utf-8", errors="replace").strip()

            result = ""
            if stdout_str:
                result += f"[标准输出]\n{stdout_str}\n"
            if stderr_str:
                result += f"[标准错误]\n{stderr_str}\n"
            if proc.returncode != 0 and not result:
                result = f"进程退出码: {proc.returncode}"

            return result.strip() or "(无输出)"
        except asyncio.TimeoutError:
            return f"[错误] 代码执行超时 ({timeout}秒)"
        except Exception as e:
            logger.error("Code execution failed: %s", e, exc_info=True)
            return "[错误] 代码执行失败，请检查代码语法和逻辑后重试"


executor = CodeExecutor(AGENT_INPUT_DIR, AGENT_OUTPUT_DIR)


def _wrap_code(code: str) -> str:
    """Wrap user code in a safe execution environment with restricted globals."""
    preamble = textwrap.dedent("""
    import sys, os, json, math, re, random, statistics, collections, itertools
    import datetime, pathlib, textwrap, fractions, decimal, hashlib, base64
    import typing, copy, pprint, io, csv, string, uuid

    # Third-party
    import pandas as pd
    import numpy as np
    import openpyxl
    from openpyxl import Workbook, load_workbook
    from pathlib import Path

    # 变量名与 Docker 沙箱保持一致（sandbox.py），提示词按 INPUT_DIR/OUTPUT_DIR 引导
    INPUT_DIR = r"{input_dir}"
    OUTPUT_DIR = r"{output_dir}"
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.chdir(OUTPUT_DIR)
    """).format(input_dir=AGENT_INPUT_DIR, output_dir=AGENT_OUTPUT_DIR)

    full_code = preamble + "\n" + code
    return full_code


def _run_code_in_child(code: str, out_path: str) -> None:
    """Multiprocessing child entry: redirect stdout/stderr to a file, then exec the code.

    Runs inside the PyInstaller-bundled Python runtime (spawned via
    `--multiprocessing-fork`), which is a real Python interpreter — unlike
    `sys.executable -c`, which would relaunch the agent exe as a server.
    """
    with open(out_path, "w", encoding="utf-8", errors="replace") as out:
        sys.stdout = out
        sys.stderr = out
        try:
            exec(compile(_wrap_code(code), "<agent_code>", "exec"), {"__name__": "__agent__"})
        except SystemExit:
            pass
        except BaseException:
            traceback.print_exc(file=out)
        finally:
            out.flush()
