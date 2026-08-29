"""Unified LLM client — supports any OpenAI-compatible online API and llama.cpp (local)."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator

import httpx

from .. import config as _cfg

logger = logging.getLogger("agent.llm")


class LLMError(Exception):
    """Base for all LLM errors."""
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class LLMTimeoutError(LLMError): ...
class LLMAuthError(LLMError): ...
class LLMOverloadError(LLMError): ...
class LLMAPiError(LLMError): ...
class LLMUnexpectedError(LLMError): ...


async def llm_chat(
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    timeout: int | None = None,
    **kwargs,
) -> dict | None:
    """Send chat request to the configured LLM backend.

    kwargs: overrides for model parameters (temperature, max_tokens, top_p, etc.)
    """
    if _cfg.LLM_BACKEND == "online":
        return await _online_chat(messages, tools, timeout=timeout, **kwargs)
    elif _cfg.LLM_BACKEND == "llamacpp":
        return await _llamacpp_chat(messages, tools, timeout=timeout, **kwargs)
    else:
        logger.error("Unknown LLM backend: %s", _cfg.LLM_BACKEND)
        return None


async def llm_chat_text(
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    timeout: int | None = None,
    **kwargs,
) -> str:
    """Like llm_chat but returns just the text content, or empty string on error."""
    try:
        msg = await llm_chat(messages, tools, timeout=timeout, **kwargs)
        if msg is None:
            return ""
        return msg.get("content", "") or ""
    except LLMError:
        return ""


async def llm_chat_stream(
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    timeout: int | None = None,
    **kwargs,
) -> AsyncGenerator[dict, None]:
    """Streaming llm_chat.

    Yields {"type": "delta", "text": str} chunks as they arrive, then a final
    {"type": "message", "msg": {...}} with accumulated content/tool_calls.
    Raises LLMError/LLMTimeoutError/... on failure. No mid-stream retry
    (a retry would duplicate already-emitted tokens); only the connect
    phase is retried.
    """
    if _cfg.LLM_BACKEND == "online":
        async for ev in _online_chat_stream(messages, tools, timeout=timeout, **kwargs):
            yield ev
    elif _cfg.LLM_BACKEND == "llamacpp":
        async for ev in _llamacpp_chat_stream(messages, tools, timeout=timeout, **kwargs):
            yield ev
    else:
        logger.error("Unknown LLM backend: %s", _cfg.LLM_BACKEND)
        raise LLMUnexpectedError("未知 LLM 后端")

# ── Online backend (any OpenAI-compatible API) ────────────────

def _build_openai_headers() -> dict:
    return {
        "Authorization": f"Bearer {_cfg.ONLINE_API_KEY}",
        "Content-Type": "application/json",
    }


async def _online_chat(
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    timeout: int | None = None,
    **kwargs,
) -> dict | None:
    # 兼容用户填入带 /v1 的完整地址（如阿里云 compatible-mode/v1），
    # 避免拼出 /v1/v1/chat/completions 导致 404
    base = _cfg.ONLINE_BASE_URL.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    url = f"{base}/v1/chat/completions"

    clean_messages = _clean_messages_for_openai(messages)

    body: dict = {
        "model": _cfg.ONLINE_MODEL,
        "messages": clean_messages,
        "max_tokens": 4096,
        "stream": False,
    }
    if tools:
        body["tools"] = _convert_tools_for_openai(tools)
        body["tool_choice"] = "auto"
    body.update(kwargs)

    req_timeout = timeout or _cfg.ONLINE_TIMEOUT
    max_retries = 2
    for attempt in range(max_retries):
        _log_request("online", clean_messages, _cfg.ONLINE_MODEL)
        t0 = time.time()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(req_timeout)) as client:
                resp = await client.post(
                    url,
                    json=body,
                    headers=_build_openai_headers(),
                )
            resp.raise_for_status()
            data = resp.json()
            choice = data.get("choices", [{}])[0]
            msg = choice.get("message", {})
            elapsed = time.time() - t0
            _log_response("online", msg, data.get("usage", {}).get("completion_tokens"))
            logger.info("[online] done in %.1fs, tokens=%s", elapsed, data.get("usage", {}).get("completion_tokens"))
            return msg
        except httpx.TimeoutException:
            elapsed = time.time() - t0
            logger.error("在线模型请求超时 (%.1fs, attempt %d/%d)", elapsed, attempt + 1, max_retries)
            if attempt < max_retries - 1:
                await asyncio.sleep(1)
                continue
            raise LLMTimeoutError("请求超时，请检查网络连接")
        except json.JSONDecodeError:
            logger.error("在线模型返回非 JSON 响应: %s", resp.text[:500])
            raise LLMAPiError("API 返回了非 JSON 格式的响应")
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            detail = e.response.text[:300]
            logger.error("在线模型 HTTP %s: %s (attempt %d/%d)", status, detail, attempt + 1, max_retries)
            if status in (429, 503) and attempt < max_retries - 1:
                await asyncio.sleep(1.5)
                continue
            if status == 401:
                raise LLMAuthError("在线模型 API Key 无效，请在设置中检查")
            err_cls = LLMOverloadError if status in (429, 503) else LLMAPiError
            raise err_cls(f"在线模型返回错误 {status}")
        except Exception as e:
            logger.error("在线模型请求失败: %s (attempt %d/%d)", e, attempt + 1, max_retries)
            if attempt < max_retries - 1:
                await asyncio.sleep(1)
                continue
            raise LLMUnexpectedError(f"请求异常: {e}")


def _clean_messages_for_openai(messages: list[dict]) -> list[dict]:
    """Convert internal messages to OpenAI-compatible format."""
    cleaned = []

    for m in messages:
        role = m.get("role", "user")

        if role == "assistant" and m.get("tool_calls"):
            cleaned.append(m)
        elif role == "tool":
            cleaned.append({
                "role": "tool",
                "tool_call_id": m.get("tool_call_id", "call_auto"),
                "content": m.get("content", ""),
            })
        elif role in ("system", "user", "assistant"):
            cleaned.append({"role": role, "content": m.get("content", "")})
    return cleaned


def _convert_tools_for_openai(tools: list[dict]) -> list[dict]:
    """Normalize tool definitions to OpenAI-compatible format."""
    result = []
    for t in tools:
        func = t.get("function", {})
        params = func.get("parameters") or {"type": "object", "properties": {}}
        result.append({
            "type": "function",
            "function": {
                "name": func.get("name", ""),
                "description": func.get("description", ""),
                "parameters": params,
            },
        })
    return result


# ── llama.cpp backend (OpenAI-compatible, built-in) ─────────────

async def _llamacpp_chat(
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    timeout: int | None = None,
    **kwargs,
) -> dict | None:
    url = f"{_cfg.LLAMACPP_URL}/v1/chat/completions"

    clean_messages = _clean_messages_for_openai(messages)

    body: dict = {
        "model": _cfg.LLAMACPP_MODEL,
        "messages": clean_messages,
        "max_tokens": 8192,
        "stream": False,
        "temperature": 0.5,
        "top_p": 0.8,
    }
    if tools:
        body["tools"] = _convert_tools_for_openai(tools)
        body["tool_choice"] = "auto"
    body.update(kwargs)

    req_timeout = timeout or _cfg.LLAMACPP_TIMEOUT
    max_retries = 2
    for attempt in range(max_retries):
        _log_request("llamacpp", clean_messages, _cfg.LLAMACPP_MODEL)
        t0 = time.time()
        try:
            # trust_env=False: llama.cpp 是本地服务，不能被系统代理(Clash 等)
            # 劫持，否则请求会被代理以 502 拒绝。
            async with httpx.AsyncClient(timeout=httpx.Timeout(req_timeout), trust_env=False) as client:
                resp = await client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()
            choice = data.get("choices", [{}])[0]
            msg = choice.get("message", {})
            elapsed = time.time() - t0
            _log_response("llamacpp", msg, data.get("usage", {}).get("completion_tokens"))
            logger.info("[llamacpp] done in %.1fs, tokens=%s", elapsed, data.get("usage", {}).get("completion_tokens"))
            return msg
        except httpx.TimeoutException:
            elapsed = time.time() - t0
            logger.error("llama.cpp request timed out (%.1fs, attempt %d/%d)", elapsed, attempt + 1, max_retries)
            if attempt < max_retries - 1:
                await asyncio.sleep(1)
                continue
            raise LLMTimeoutError("llama.cpp 请求超时，请检查本地服务是否运行")
        except json.JSONDecodeError:
            logger.error("llama.cpp returned non-JSON response: %s", resp.text[:500])
            raise LLMAPiError("API 返回了非 JSON 格式的响应")
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            detail = e.response.text[:300]
            logger.error("llama.cpp HTTP %s: %s (attempt %d/%d)", status, detail, attempt + 1, max_retries)
            raise LLMAPiError(f"llama.cpp 返回错误 {status}")
        except Exception as e:
            logger.error("llama.cpp request failed: %s (attempt %d/%d)", e, attempt + 1, max_retries)
            if attempt < max_retries - 1:
                await asyncio.sleep(1)
                continue
            raise LLMUnexpectedError(f"llama.cpp 请求异常: {e}")


# ── Streaming backends (SSE) ──────────────────────────────────

async def _online_chat_stream(
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    timeout: int | None = None,
    **kwargs,
) -> AsyncGenerator[dict, None]:
    base = _cfg.ONLINE_BASE_URL.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    url = f"{base}/v1/chat/completions"

    body: dict = {
        "model": _cfg.ONLINE_MODEL,
        "messages": _clean_messages_for_openai(messages),
        "max_tokens": 4096,
        "stream": True,
    }
    if tools:
        body["tools"] = _convert_tools_for_openai(tools)
        body["tool_choice"] = "auto"
    body.update(kwargs)

    async for ev in _stream_openai_core(
        url,
        headers=_build_openai_headers(),
        body=body,
        timeout=timeout or _cfg.ONLINE_TIMEOUT,
        trust_env=True,
        backend="online",
    ):
        yield ev


async def _llamacpp_chat_stream(
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    timeout: int | None = None,
    **kwargs,
) -> AsyncGenerator[dict, None]:
    url = f"{_cfg.LLAMACPP_URL}/v1/chat/completions"

    body: dict = {
        "model": _cfg.LLAMACPP_MODEL,
        "messages": _clean_messages_for_openai(messages),
        "max_tokens": 8192,
        "stream": True,
        "temperature": 0.5,
        "top_p": 0.8,
    }
    if tools:
        body["tools"] = _convert_tools_for_openai(tools)
        body["tool_choice"] = "auto"
    body.update(kwargs)

    async for ev in _stream_openai_core(
        url,
        headers=None,
        body=body,
        timeout=timeout or _cfg.LLAMACPP_TIMEOUT,
        trust_env=False,  # 本地服务不能被系统代理(Clash 等)劫持
        backend="llamacpp",
    ):
        yield ev


async def _stream_openai_core(
    url: str,
    headers: dict | None,
    body: dict,
    *,
    timeout: int,
    trust_env: bool,
    backend: str,
) -> AsyncGenerator[dict, None]:
    """Shared SSE streaming core. Retries only the connect phase; once the
    status line is received, any failure raises immediately."""
    max_retries = 2
    for attempt in range(max_retries):
        t0 = time.time()
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(timeout, connect=10.0),
                trust_env=trust_env,
            ) as client:
                async with client.stream("POST", url, json=body, headers=headers) as resp:
                    resp.raise_for_status()  # HTTP errors: no retry once status received
                    content_parts: list[str] = []
                    reasoning_parts: list[str] = []
                    tool_acc: dict[int, dict] = {}
                    async for line in resp.aiter_lines():
                        line = line.strip()
                        if not line.startswith("data:"):
                            continue
                        data = line[len("data:"):].strip()
                        # 兼容个别兼容 API 把 [DONE] 编码成 JSON 字符串的变体
                        if data in ("[DONE]", '"[DONE]"'):
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        if not chunk.get("choices"):
                            continue
                        delta = chunk["choices"][0].get("delta", {})
                        # reasoning_content 与 content/tool_calls 独立判断——
                        # 个别服务端会把 </think> 与首个答案 token 放在同一 chunk
                        if delta.get("reasoning_content"):
                            reasoning_parts.append(delta["reasoning_content"])
                            yield {"type": "thinking", "delta": delta["reasoning_content"]}
                        if delta.get("content"):
                            content_parts.append(delta["content"])
                            yield {"type": "delta", "text": delta["content"]}
                        for tc in delta.get("tool_calls") or []:
                            idx = tc.get("index", 0)
                            slot = tool_acc.setdefault(
                                idx,
                                {"id": "", "type": "function",
                                 "function": {"name": "", "arguments": ""}},
                            )
                            if tc.get("id"):
                                slot["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["function"]["name"] += fn["name"]
                            if fn.get("arguments"):
                                slot["function"]["arguments"] += fn["arguments"]
            msg: dict = {"role": "assistant", "content": "".join(content_parts)}
            if reasoning_parts:
                msg["reasoning_content"] = "".join(reasoning_parts)
            if tool_acc:
                msg["tool_calls"] = [tool_acc[i] for i in sorted(tool_acc)]
            elapsed = time.time() - t0
            logger.info("[%s] stream done in %.1fs, %d chars, %d thinking, %d tool_calls",
                        backend, elapsed, len(msg["content"]),
                        len(msg.get("reasoning_content", "")), len(msg.get("tool_calls", [])))
            yield {"type": "message", "msg": msg}
            return
        except (httpx.ConnectError, httpx.ConnectTimeout):
            elapsed = time.time() - t0
            logger.error("[%s] stream connect failed (%.1fs, attempt %d/%d)",
                         backend, elapsed, attempt + 1, max_retries)
            if attempt < max_retries - 1:
                await asyncio.sleep(1)
                continue
            if backend == "online":
                raise LLMTimeoutError("请求超时，请检查网络连接")
            raise LLMTimeoutError("llama.cpp 请求超时，请检查本地服务是否运行")
        except httpx.TimeoutException:
            logger.error("[%s] stream timed out mid-read", backend)
            if backend == "online":
                raise LLMTimeoutError("请求超时，请检查网络连接")
            raise LLMTimeoutError("llama.cpp 请求超时，请检查本地服务是否运行")
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            detail = e.response.text[:300]
            logger.error("[%s] stream HTTP %s: %s", backend, status, detail)
            if status == 401:
                raise LLMAuthError("在线模型 API Key 无效，请在设置中检查")
            if status in (429, 503):
                raise LLMOverloadError(f"在线模型返回错误 {status}")
            if backend == "online":
                raise LLMAPiError(f"在线模型返回错误 {status}")
            raise LLMAPiError(f"llama.cpp 返回错误 {status}")
        except Exception as e:
            logger.error("[%s] stream failed: %s", backend, e, exc_info=True)
            raise LLMUnexpectedError(f"请求异常: {e}")


# ── Logging helpers ───────────────────────────────────────────

def _log_request(backend: str, messages: list[dict], model: str):
    total_chars = sum(len(m.get("content", "") or "") for m in messages)
    logger.debug("[%s] request: %d msgs, ~%d chars, model=%s", backend, len(messages), total_chars, model)


def _log_response(backend: str, msg: dict, token_info):
    content = msg.get("content", "") or ""
    tc_count = len(msg.get("tool_calls", []) or [])
    logger.debug("[%s] response: %d chars, %d tool_calls, tokens=%s", backend, len(content), tc_count, token_info)
