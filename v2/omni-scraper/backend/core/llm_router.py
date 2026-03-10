"""
╔══════════════════════════════════════════════════════╗
║  OMNI-SCRAPER — Unified LLM Router                  ║
║  Supports: OpenAI GPT-4o | Claude | Kimi K2.5 | Qwen║
╚══════════════════════════════════════════════════════╝

All models are treated as equal-capability providers.
Switch provider via LLM_PROVIDER env var or at runtime.
"""

from __future__ import annotations
import os
import json
import base64
from enum import Enum
from typing import Any, Optional
from dataclasses import dataclass

import httpx
from openai import AsyncOpenAI
from anthropic import AsyncAnthropic
from pydantic import BaseModel
import structlog
from dotenv import load_dotenv
load_dotenv()

log = structlog.get_logger()


class LLMProvider(str, Enum):
    OPENAI  = "openai"   # GPT-4o — closed source
    CLAUDE  = "claude"   # Claude 3.5 Sonnet — closed source
    KIMI    = "kimi"     # moonshotai/kimi-k2.5 — open weights
    QWEN    = "qwen"     # qwen/qwen3.5-397b-a17b — open weights


# ── Model registry ──────────────────────────────────────────────────────────
MODEL_REGISTRY: dict[LLMProvider, dict] = {
    LLMProvider.OPENAI: {
        "model":        "gpt-4o",
        "vision":       True,
        "context_k":    128,
        "description":  "OpenAI GPT-4o — best-in-class reasoning + vision",
        "client_type":  "openai",
    },
    LLMProvider.CLAUDE: {
        "model":        "claude-sonnet-4-5",
        "vision":       True,
        "context_k":    200,
        "description":  "Anthropic Claude 3.5 Sonnet — superior instruction following",
        "client_type":  "anthropic",
    },
    LLMProvider.KIMI: {
        "model":        "moonshotai/kimi-k2.5",
        "vision":       True,
        "context_k":    128,
        "description":  "Moonshot Kimi K2.5 — long-context open weights via OpenRouter",
        "client_type":  "openrouter",
    },
    LLMProvider.QWEN: {
        "model":        "qwen/qwen3.5-397b-a17b",
        "vision":       False,
        "context_k":    32,
        "description":  "Qwen 3.5 397B MoE — massive open-source model via OpenRouter",
        "client_type":  "openrouter",
    },
}

OPENROUTER_BASE = "https://openrouter.ai/api/v1"


@dataclass
class LLMResponse:
    content:   str
    provider:  LLMProvider
    model:     str
    tokens_in: int
    tokens_out: int
    latency_ms: float


class LLMRouter:
    """
    Unified LLM interface. All 4 providers expose identical capability:
    - complete(messages, system) → LLMResponse
    - vision(screenshot_b64, prompt) → LLMResponse  (where supported)
    - json_complete(messages, schema) → dict
    """

    def __init__(self, provider: Optional[LLMProvider] = None):
        raw = provider or os.getenv("LLM_PROVIDER", "claude")
        self.provider = LLMProvider(raw.lower())
        self.meta     = MODEL_REGISTRY[self.provider]

        # Instantiate the appropriate client
        if self.meta["client_type"] == "openai":
            self._openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        elif self.meta["client_type"] == "anthropic":
            self._anthropic = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        elif self.meta["client_type"] == "openrouter":
            self._openrouter = AsyncOpenAI(
                api_key=os.getenv("OPENROUTER_API_KEY"),
                base_url=OPENROUTER_BASE,
            )

        log.info("llm_router_initialized",
                 provider=self.provider,
                 model=self.meta["model"],
                 vision=self.meta["vision"])

    # ── Core completion ──────────────────────────────────────────────────────
    async def complete(
        self,
        messages: list[dict],
        system:   str  = "",
        max_tokens: int = 2048,
        temperature: float = 0.2,
    ) -> LLMResponse:
        import time
        t0 = time.monotonic()

        ct = self.meta["client_type"]

        if ct == "openai":
            resp = await self._openai_complete(messages, system, max_tokens, temperature)
        elif ct == "anthropic":
            resp = await self._anthropic_complete(messages, system, max_tokens, temperature)
        elif ct == "openrouter":
            resp = await self._openrouter_complete(messages, system, max_tokens, temperature)
        else:
            raise ValueError(f"Unknown client type: {ct}")

        resp.latency_ms = round((time.monotonic() - t0) * 1000, 1)
        log.debug("llm_complete", provider=self.provider.value,
                  tokens_in=resp.tokens_in, tokens_out=resp.tokens_out,
                  latency_ms=resp.latency_ms)
        return resp

    # ── Vision completion ────────────────────────────────────────────────────
    async def vision(
        self,
        screenshot_b64: str,
        prompt:         str,
        system:         str = "",
    ) -> LLMResponse:
        """Send screenshot + text to a vision-capable model."""
        if not self.meta["vision"]:
            # Qwen fallback: skip screenshot, use text-only
            log.warning("vision_not_supported_falling_back", provider=self.provider.value)
            return await self.complete([{"role": "user", "content": prompt}], system)

        msg = {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{screenshot_b64}"}},
                {"type": "text", "text": prompt},
            ]
        }

        if self.meta["client_type"] == "anthropic":
            msg = {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": screenshot_b64}},
                    {"type": "text", "text": prompt},
                ]
            }

        return await self.complete([msg], system)

    # ── JSON-mode completion ─────────────────────────────────────────────────
    async def json_complete(
        self,
        messages: list[dict],
        system:   str = "",
    ) -> dict:
        """Returns parsed JSON dict. Injects JSON-mode instruction."""
        json_sys = system + "\n\nYou MUST respond ONLY with valid JSON. No preamble, no markdown, no explanation."
        resp = await self.complete(messages, system=json_sys, temperature=0.0)
        raw = resp.content.strip()
        # Strip markdown fences if model adds them anyway
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return json.loads(raw)

    # ── Provider implementations ─────────────────────────────────────────────
    async def _openai_complete(self, messages, system, max_tokens, temperature) -> LLMResponse:
        msgs = ([{"role": "system", "content": system}] if system else []) + messages
        r = await self._openai.chat.completions.create(
            model=self.meta["model"],
            messages=msgs,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return LLMResponse(
            content=r.choices[0].message.content,
            provider=self.provider,
            model=self.meta["model"],
            tokens_in=r.usage.prompt_tokens,
            tokens_out=r.usage.completion_tokens,
            latency_ms=0,
        )

    async def _anthropic_complete(self, messages, system, max_tokens, temperature) -> LLMResponse:
        r = await self._anthropic.messages.create(
            model=self.meta["model"],
            system=system or "You are a helpful assistant.",
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return LLMResponse(
            content=r.content[0].text,
            provider=self.provider,
            model=self.meta["model"],
            tokens_in=r.usage.input_tokens,
            tokens_out=r.usage.output_tokens,
            latency_ms=0,
        )

    async def _openrouter_complete(self, messages, system, max_tokens, temperature) -> LLMResponse:
        msgs = ([{"role": "system", "content": system}] if system else []) + messages
        r = await self._openrouter.chat.completions.create(
            model=self.meta["model"],
            messages=msgs,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return LLMResponse(
            content=r.choices[0].message.content,
            provider=self.provider,
            model=self.meta["model"],
            tokens_in=r.usage.prompt_tokens if r.usage else 0,
            tokens_out=r.usage.completion_tokens if r.usage else 0,
            latency_ms=0,
        )

    # ── Utility ──────────────────────────────────────────────────────────────
    @staticmethod
    def list_providers() -> list[dict]:
        return [
            {
                "id":          p.value,
                "model":       m["model"],
                "vision":      m["vision"],
                "context_k":   m["context_k"],
                "description": m["description"],
                "source":      "closed" if p in (LLMProvider.OPENAI, LLMProvider.CLAUDE) else "open",
            }
            for p, m in MODEL_REGISTRY.items()
        ]