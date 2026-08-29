"""Docker sandbox: secure execution of LLM-generated Python code.

Includes safe_mode filtering (inspired by Open Interpreter) that blocks
dangerous function calls before code reaches the container.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from pathlib import Path

from ..config import (
    AGENT_INPUT_DIR,
    AGENT_OUTPUT_DIR,
    DOCKER_IMAGE,
    DOCKER_MEMORY_LIMIT,
    DOCKER_CPU_LIMIT,
)

logger = logging.getLogger("agent.docker")


# ── safe_mode code filter ───────────────────────────────────────

# Patterns that block dangerous calls even inside a Docker container.
# These are defense-in-depth: the container already has --network none,
# --cap-drop ALL, --read-only, but blocking these at the code level
# prevents wasted execution and adds a clear audit trail.
DANGEROUS_PATTERNS: list[tuple[str, str]] = [
    # Shell execution
    (r"\bos\.system\s*\(", "os.system() is blocked by safe_mode"),
    (r"\bimport\s+subprocess\b", "import subprocess is blocked by safe_mode"),
    (r"\bsubprocess\.(call|run|Popen|check_call|check_output)\s*\(", "subprocess calls are blocked by safe_mode"),
    (r"\bpty\.spawn\s*\(", "pty.spawn() is blocked by safe_mode"),
    (r"\bcommands\.(getoutput|getstatusoutput)\s*\(", "commands module is blocked by safe_mode"),
    # Dynamic code execution
    (r"\beval\s*\(", "eval() is blocked by safe_mode"),
    (r"\bexec\s*\(", "exec() is blocked by safe_mode"),
    (r"\bcompile\s*\(", "compile() is blocked by safe_mode"),
    (r"\b__import__\s*\(", "__import__() is blocked by safe_mode"),
    # File system escape
    (r"\bos\.(chmod|chown|setuid|setgid)\s*\(", "os file permission changes are blocked"),
    (r"\bshutil\.rmtree\s*\(", "shutil.rmtree() is blocked by safe_mode"),
    # Network (defense-in-depth, container already has --network none)
    (r"\b(import|from)\s+(urllib|urllib2|urllib3)\b", "urllib imports are blocked by safe_mode"),
    (r"\brequests\.(get|post|put|delete|patch|head)\s*\(", "HTTP requests are blocked by safe_mode"),
    (r"\bsocket\.(socket|connect|send)\s*\(", "raw socket usage is blocked by safe_mode"),
    (r"\bhttp\.(server|client)\b", "HTTP server/client is blocked by safe_mode"),
    # System
    (r"\bos\.(uname|getlogin|getpid|kill|nice|renice)\s*\(", "os system calls are restricted"),
    (r"\bctypes\b", "ctypes is blocked by safe_mode"),
    (r"\bmultiprocessing\b", "multiprocessing is blocked by safe_mode"),
    (r"\bthreading\.Thread\b", "threading.Thread is blocked by safe_mode"),
]


def safe_mode_filter(code: str) -> tuple[bool, str]:
    """Check code against dangerous patterns.

    Returns (is_safe, reason). If is_safe is False, reason contains
    the explanation for the LLM.
    """
    violations: list[str] = []
    for pattern, message in DANGEROUS_PATTERNS:
        if re.search(pattern, code, re.IGNORECASE):
            violations.append(message)

    if violations:
        unique = list(dict.fromkeys(violations))  # dedup, preserve order
        reason = "; ".join(unique)
        return False, reason
    return True, ""


# ── DockerSandbox ───────────────────────────────────────────────

class DockerSandbox:
    """Manage the lifecycle of Docker sandbox code execution."""

    IMAGE_NAME = DOCKER_IMAGE
    MEMORY_LIMIT = DOCKER_MEMORY_LIMIT
    CPU_LIMIT = DOCKER_CPU_LIMIT
    BUILD_TIMEOUT = 120
    EXEC_TIMEOUT = 30

    def __init__(self, input_dir: str, output_dir: str):
        self.input_dir = input_dir
        self.output_dir = output_dir
        self._available: bool | None = None
        self._image_ready: bool = False

    # ── Docker availability ──

    async def check_available(self) -> bool:
        """Check if Docker daemon is reachable. Result is cached for the process lifetime."""
        if self._available is not None:
            return self._available
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "info",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.wait(), timeout=5.0)
            self._available = proc.returncode == 0
        except (FileNotFoundError, asyncio.TimeoutError):
            self._available = False
        logger.info("Docker available: %s", self._available)
        return self._available

    # ── Image management ──

    @property
    def is_ready(self) -> bool:
        return bool(self._available) and self._image_ready

    async def build_image(self) -> bool:
        """Build the Docker sandbox image. Returns True on success."""
        dockerfile_dir = Path(__file__).resolve().parent
        df_path = dockerfile_dir / "Dockerfile"

        if not df_path.exists():
            logger.error("Dockerfile not found at %s", df_path)
            return False

        logger.info("Building Docker sandbox image '%s' ...", self.IMAGE_NAME)
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "build",
                "-t", self.IMAGE_NAME,
                "-f", str(df_path),
                str(dockerfile_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=self.BUILD_TIMEOUT
            )

            if proc.returncode != 0:
                stderr_text = stderr.decode("utf-8", errors="replace")[-2000:]
                logger.error("Docker build failed (exit=%d): %s", proc.returncode, stderr_text)
                self._image_ready = False
                return False

            logger.info("Docker image '%s' built successfully", self.IMAGE_NAME)
            self._image_ready = True
            return True

        except (FileNotFoundError, asyncio.TimeoutError) as e:
            logger.error("Docker build error: %s", e)
            self._image_ready = False
            return False

    # ── Code execution ──

    async def execute(self, code: str, timeout: int = EXEC_TIMEOUT) -> str:
        """Execute code in the Docker sandbox. Returns stdout or JSON error."""
        if not self.is_ready:
            return json.dumps({"error": "Docker sandbox not ready"}, ensure_ascii=False)

        # safe_mode check
        safe, reason = safe_mode_filter(code)
        if not safe:
            return json.dumps({
                "error": f"safe_mode blocked code execution: {reason}",
                "hint": "请用纯 Python 数据处理方式（openpyxl、pandas）完成任务，不要调用系统命令或子进程。",
            }, ensure_ascii=False)

        container_name = f"ew_exec_{uuid.uuid4().hex[:12]}"
        script_filename = f".ew_{uuid.uuid4().hex[:16]}.py"
        script_path = os.path.join(self.output_dir, script_filename)

        try:
            with open(script_path, "w", encoding="utf-8") as f:
                f.write(self._wrap_code(code))

            input_abs = Path(self.input_dir).resolve()
            output_abs = Path(self.output_dir).resolve()

            cmd = [
                "docker", "run",
                "--rm",
                "--name", container_name,
                # Security
                "--network", "none",
                "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges",
                "--read-only",
                # Resources
                "--memory", self.MEMORY_LIMIT,
                "--cpus", str(self.CPU_LIMIT),
                "--pids-limit", "64",
                # Writable temp space
                "--tmpfs", "/tmp:size=64m,noexec,nosuid",
                # Volume mounts
                "-v", f"{input_abs}:/agent_input:ro",
                "-v", f"{output_abs}:/agent_output:rw",
                # Environment
                "-e", "HOME=/tmp",
                "-e", "MPLCONFIGDIR=/tmp/matplotlib",
                # Working directory
                "-w", "/agent_output",
                self.IMAGE_NAME,
                "python", f"/agent_output/{script_filename}",
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                try:
                    proc.kill()
                    await proc.wait()
                except ProcessLookupError:
                    pass
                # Force-kill the container (belt-and-suspenders beyond --rm)
                try:
                    kill_proc = await asyncio.create_subprocess_exec(
                        "docker", "kill", container_name,
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL,
                    )
                    await asyncio.wait_for(kill_proc.wait(), timeout=5)
                except Exception:
                    logger.warning("Failed to kill container %s", container_name)
                return json.dumps({"error": f"执行超时 ({timeout}s)"}, ensure_ascii=False)

            if proc.returncode != 0:
                err_text = stderr.decode("utf-8", errors="replace")
                return json.dumps({
                    "error": f"执行失败 (exit={proc.returncode})",
                    "stderr": err_text,
                }, ensure_ascii=False)

            return stdout.decode("utf-8", errors="replace")

        finally:
            try:
                os.unlink(script_path)
            except OSError:
                logger.debug("Failed to clean up temp script: %s", script_path)

    # ── Code wrapper ──

    @staticmethod
    def _wrap_code(code: str) -> str:
        """Wrap user code in try/except with INPUT_DIR/OUTPUT_DIR setup."""
        setup_lines = [
            "import os, sys",
            "INPUT_DIR = '/agent_input'",
            "OUTPUT_DIR = '/agent_output'",
            "os.makedirs(OUTPUT_DIR, exist_ok=True)",
        ]
        indented_setup = "\n".join(f"    {line}" for line in setup_lines)
        indented_code = "\n".join(
            f"    {line}" if line.strip() else ""
            for line in code.split("\n")
        )
        return (
            "import json, traceback\n"
            "def _result(data): print(json.dumps(data, ensure_ascii=False, default=str))\n"
            "try:\n"
            + indented_setup + "\n"
            + indented_code + "\n"
            "except Exception as e:\n"
            "    _result({'error': str(e), 'traceback': traceback.format_exc()})\n"
        )


# ── Module-level singleton ──

_sandbox: DockerSandbox | None = None


def get_sandbox() -> DockerSandbox:
    global _sandbox
    if _sandbox is None:
        _sandbox = DockerSandbox(AGENT_INPUT_DIR, AGENT_OUTPUT_DIR)
    return _sandbox
