"""
╔══════════════════════════════════════════════════════════════╗
║  OMNI-SCRAPER — Unified LLM Router                          ║
║  OpenAI · Claude · Kimi (OpenRouter) · Qwen (OpenRouter)    ║
║  NVIDIA NIM: Kimi K2.5 · Qwen 3.5 122B · MiniMax M2.1      ║
╚══════════════════════════════════════════════════════════════╝
"""

from __future__ import annotations
import os, json, re, time
from enum import Enum
from typing import Optional
from dataclasses import dataclass

from openai import AsyncOpenAI
from anthropic import AsyncAnthropic
import structlog
from dotenv import load_dotenv
# override=True forces .env values to win over Codespaces-injected secrets
load_dotenv(override=True)

log = structlog.get_logger()

NVIDIA_BASE    = "https://integrate.api.nvidia.com/v1"
OPENROUTER_BASE = "https://openrouter.ai/api/v1"


class LLMProvider(str, Enum):
    # ── Original providers ────────────────────────────────────────────────────
    OPENAI      = "openai"        # GPT-4o
    CLAUDE      = "claude"        # Claude Sonnet
    KIMI        = "kimi"          # Kimi K2.5 via OpenRouter
    QWEN        = "qwen"          # Qwen 3.5 397B via OpenRouter
    # ── NVIDIA NIM (free tier, no credit card) ────────────────────────────────
    NV_KIMI     = "nv_kimi"       # Kimi K2.5    via NVIDIA NIM
    NV_QWEN     = "nv_qwen"       # Qwen 3.5 122B via NVIDIA NIM
    NV_MINIMAX  = "nv_minimax"    # MiniMax M2.1 via NVIDIA NIM


MODEL_REGISTRY: dict[LLMProvider, dict] = {
    LLMProvider.OPENAI: {
        "model":       "gpt-4o",
        "vision":      True,
        "context_k":   128,
        "description": "OpenAI GPT-4o",
        "client_type": "openai",
        "env_key":     "OPENAI_API_KEY",
        "base_url":    None,
    },
    LLMProvider.CLAUDE: {
        "model":       "claude-sonnet-4-5",
        "vision":      True,
        "context_k":   200,
        "description": "Anthropic Claude Sonnet",
        "client_type": "anthropic",
        "env_key":     "ANTHROPIC_API_KEY",
        "base_url":    None,
    },
    LLMProvider.KIMI: {
        "model":       "moonshotai/kimi-k2.5",
        "vision":      True,
        "context_k":   128,
        "description": "Kimi K2.5 via OpenRouter",
        "client_type": "openai_compat",
        "env_key":     "OPENROUTER_API_KEY",
        "base_url":    OPENROUTER_BASE,
    },
    LLMProvider.QWEN: {
        "model":       "qwen/qwen3.5-397b-a17b",
        "vision":      False,
        "context_k":   32,
        "description": "Qwen 3.5 397B via OpenRouter",
        "client_type": "openai_compat",
        "env_key":     "OPENROUTER_API_KEY",
        "base_url":    OPENROUTER_BASE,
    },
    # ── NVIDIA NIM ────────────────────────────────────────────────────────────
    LLMProvider.NV_KIMI: {
        "model":       "moonshotai/kimi-k2.5",
        "vision":      True,
        "context_k":   128,
        "description": "Kimi K2.5 via NVIDIA NIM (free)",
        "client_type": "openai_compat",
        "env_key":     "NVIDIA_API_KEY",
        "base_url":    NVIDIA_BASE,
    },
    LLMProvider.NV_QWEN: {
        "model":       "qwen/qwen3.5-122b-a10b",
        "vision":      False,
        "context_k":   32,
        "description": "Qwen 3.5 122B via NVIDIA NIM (free)",
        "client_type": "openai_compat",
        "env_key":     "NVIDIA_API_KEY",
        "base_url":    NVIDIA_BASE,
    },
    LLMProvider.NV_MINIMAX: {
        "model":       "minimaxai/minimax-m2.1",
        "vision":      False,
        "context_k":   32,
        "description": "MiniMax M2.1 via NVIDIA NIM (free)",
        "client_type": "openai_compat",
        "env_key":     "NVIDIA_API_KEY",
        "base_url":    NVIDIA_BASE,
    },
}

# Fallback chain: most capable → most available
# NVIDIA NIM providers are free so they come before paid OpenRouter ones
FALLBACK_CHAIN = [
    LLMProvider.CLAUDE,
    LLMProvider.OPENAI,
    LLMProvider.NV_KIMI,
    LLMProvider.NV_QWEN,
    LLMProvider.NV_MINIMAX,
    LLMProvider.KIMI,
    LLMProvider.QWEN,
]


@dataclass
class LLMResponse:
    content:    str
    provider:   LLMProvider
    model:      str
    tokens_in:  int
    tokens_out: int
    latency_ms: float


class LLMRouter:
    def __init__(self, provider: Optional[LLMProvider] = None):
        raw = provider or os.getenv("LLM_PROVIDER", "claude")
        self.provider = LLMProvider(raw.lower())
        self.meta     = MODEL_REGISTRY[self.provider]
        self._client  = self._build_client(self.provider)

        log.info("llm_router_initialized",
                 provider=self.provider.value,
                 model=self.meta["model"],
                 vision=self.meta["vision"])

    def _build_client(self, provider: LLMProvider):
        """Build the appropriate async client for this provider."""
        meta = MODEL_REGISTRY[provider]
        ct   = meta["client_type"]
        key  = os.getenv(meta["env_key"], "")

        if ct == "openai":
            return AsyncOpenAI(api_key=key)
        elif ct == "anthropic":
            return AsyncAnthropic(api_key=key)
        elif ct == "openai_compat":
            # All NVIDIA NIM + OpenRouter use the OpenAI-compatible client
            return AsyncOpenAI(api_key=key, base_url=meta["base_url"])
        else:
            raise ValueError(f"Unknown client_type: {ct}")

    # ── Core completion ───────────────────────────────────────────────────────

    async def complete(
        self,
        messages:    list[dict],
        system:      str   = "",
        max_tokens:  int   = 1024,
        temperature: float = 0.2,
        _provider:   LLMProvider = None,
        _client      = None,
    ) -> LLMResponse:
        provider = _provider or self.provider
        client   = _client   or self._client
        meta     = MODEL_REGISTRY[provider]
        t0       = time.monotonic()

        ct = meta["client_type"]

        if ct == "anthropic":
            r = await client.messages.create(
                model       = meta["model"],
                system      = system or "You are a helpful assistant.",
                messages    = messages,
                max_tokens  = max_tokens,
                temperature = temperature,
            )
            content    = r.content[0].text
            tokens_in  = r.usage.input_tokens
            tokens_out = r.usage.output_tokens

        else:
            # openai + openai_compat (NVIDIA NIM, OpenRouter) — identical API
            msgs = ([{"role": "system", "content": system}] if system else []) + messages
            r = await client.chat.completions.create(
                model       = meta["model"],
                messages    = msgs,
                max_tokens  = max_tokens,
                temperature = temperature,
            )
            content    = r.choices[0].message.content or ""
            tokens_in  = r.usage.prompt_tokens     if r.usage else 0
            tokens_out = r.usage.completion_tokens if r.usage else 0

        latency = round((time.monotonic() - t0) * 1000, 1)
        log.debug("llm_complete", provider=provider.value,
                  model=meta["model"], tokens_in=tokens_in,
                  tokens_out=tokens_out, latency_ms=latency)

        return LLMResponse(
            content    = content,
            provider   = provider,
            model      = meta["model"],
            tokens_in  = tokens_in,
            tokens_out = tokens_out,
            latency_ms = latency,
        )

    # ── Vision ────────────────────────────────────────────────────────────────

    async def vision(self, screenshot_b64: str, prompt: str,
                     system: str = "") -> LLMResponse:
        if not self.meta["vision"]:
            log.warning("vision_not_supported", provider=self.provider.value)
            return await self.complete([{"role": "user", "content": prompt}], system)

        if self.meta["client_type"] == "anthropic":
            msg = {"role": "user", "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": "image/png",
                    "data": screenshot_b64,
                }},
                {"type": "text", "text": prompt},
            ]}
        else:
            msg = {"role": "user", "content": [
                {"type": "image_url", "image_url": {
                    "url": f"data:image/png;base64,{screenshot_b64}",
                }},
                {"type": "text", "text": prompt},
            ]}

        return await self.complete([msg], system)

    # ── JSON completion with auto-fallback ────────────────────────────────────

    async def json_complete(
        self,
        messages:   list[dict],
        system:     str = "",
        max_tokens: int = 800,
    ) -> dict:
        """
        Returns parsed JSON dict.
        Auto-fallback: if selected provider fails (402/429/500/quota),
        silently tries the next provider in FALLBACK_CHAIN.
        """
        json_sys = (system or "") + (
            "\n\nYou MUST respond ONLY with valid JSON. "
            "No preamble, no markdown fences, no explanation."
        )

        # Build ordered list: selected provider first, then fallbacks
        providers_to_try = [self.provider] + [
            p for p in FALLBACK_CHAIN if p != self.provider
        ]

        last_err = None
        for provider in providers_to_try:
            # Skip providers with no API key configured
            env_key = MODEL_REGISTRY[provider]["env_key"]
            if not os.getenv(env_key):
                continue

            try:
                client = (self._client if provider == self.provider
                          else self._build_client(provider))

                resp = await self.complete(
                    messages, system=json_sys,
                    max_tokens=max_tokens, temperature=0.0,
                    _provider=provider, _client=client,
                )

                raw = (resp.content or "").strip()
                if not raw:
                    raise ValueError("empty response")

                # Strip markdown fences if present
                if raw.startswith("```"):
                    lines = raw.split("\n")
                    raw   = "\n".join(lines[1:])
                    if raw.endswith("```"):
                        raw = raw[:-3].strip()

                # Extract JSON object or array from response
                for pattern in [r"(\{[\s\S]*\})", r"(\[[\s\S]*\])"]:
                    m = re.search(pattern, raw)
                    if m:
                        try:
                            result = json.loads(m.group(1))
                            if provider != self.provider:
                                log.info("llm_fallback_used",
                                         primary=self.provider.value,
                                         used=provider.value)
                            return result
                        except Exception:
                            continue

                # Last attempt — full raw
                return json.loads(raw)

            except Exception as e:
                err_str = str(e)
                last_err = err_str
                recoverable = any(code in err_str for code in [
                    "402", "429", "401", "500", "503",
                    "quota", "credit", "rate limit", "overloaded",
                ])
                if recoverable:
                    log.warning("llm_provider_failed",
                                provider=provider.value, err=err_str[:100])
                    continue
                raise  # non-recoverable (bad request, JSON error, etc.)

        raise ValueError(f"All providers failed. Last: {last_err}")

    # ── Utility ───────────────────────────────────────────────────────────────

    @staticmethod
    def list_providers() -> list[dict]:
        return [
            {
                "id":          p.value,
                "model":       m["model"],
                "vision":      m["vision"],
                "context_k":   m["context_k"],
                "description": m["description"],
                "host":        ("NVIDIA NIM" if "nv_" in p.value
                                else "OpenRouter" if m["client_type"] == "openai_compat"
                                     and "openrouter" in (m["base_url"] or "")
                                else m["client_type"].upper()),
                "env_key":     m["env_key"],
                "configured":  bool(os.getenv(m["env_key"])),
            }
            for p, m in MODEL_REGISTRY.items()
        ]