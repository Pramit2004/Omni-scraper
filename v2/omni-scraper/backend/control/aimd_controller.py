"""
╔══════════════════════════════════════════════════════════╗
║  OMNI-SCRAPER — Adaptive Rate Controller                ║
║  AIMD (Additive Increase / Multiplicative Decrease)     ║
║  + PID (Proportional-Integral-Derivative) overlay       ║
╚══════════════════════════════════════════════════════════╝
"""

from __future__ import annotations
import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import redis.asyncio as aioredis
import structlog

log = structlog.get_logger()


class DomainState(str, Enum):
    PROBING   = "probing"    # Initial slow-start
    CRUISING  = "cruising"   # Healthy, additive increase
    BACKING   = "backing"    # Soft block — multiplicative decrease
    PAUSED    = "paused"     # Hard block — cooldown period


@dataclass
class TelemetryEvent:
    timestamp:       float
    url:             str
    domain:          str
    proxy_id:        str
    status_code:     int
    latency_ms:      float
    captcha_detected: bool = False
    waf_detected:    bool  = False
    content_hash:    str   = ""


@dataclass
class DomainMetrics:
    domain:          str
    state:           DomainState  = DomainState.PROBING
    concurrency:     float        = 1.0
    delay_ms:        float        = 2000.0
    error_rate:      float        = 0.0
    captcha_rate:    float        = 0.0
    p95_latency_ms:  float        = 0.0
    total_requests:  int          = 0
    success_count:   int          = 0
    block_count:     int          = 0

    # PID state
    _pid_integral:   float = field(default=0.0, repr=False)
    _pid_prev_error: float = field(default=0.0, repr=False)
    _pid_last_ts:    float = field(default_factory=time.monotonic, repr=False)

    # Rolling window (last 100 requests)
    _window:         deque = field(default_factory=lambda: deque(maxlen=100), repr=False)


class PIDController:
    """
    PID controller targeting a specific error rate.
    Returns a delay adjustment (positive = slow down, negative = speed up).
    """
    def __init__(self, kp: float = 0.8, ki: float = 0.1, kd: float = 0.05,
                 target_error_rate: float = 0.01):
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.target = target_error_rate
        self._integral = 0.0
        self._prev_error = 0.0
        self._last_ts = time.monotonic()

    def update(self, current_error_rate: float) -> float:
        now = time.monotonic()
        dt  = max(now - self._last_ts, 0.001)
        self._last_ts = now

        error         = current_error_rate - self.target
        self._integral += error * dt
        # Anti-windup clamp
        self._integral = max(-10.0, min(10.0, self._integral))
        derivative     = (error - self._prev_error) / dt
        self._prev_error = error

        return self.kp * error + self.ki * self._integral + self.kd * derivative


class AdaptiveRateController:
    """
    Per-domain AIMD + PID rate controller.

    Usage:
        ctrl = AdaptiveRateController(redis_url)
        await ctrl.record(event)          # log a request
        delay = await ctrl.get_delay(domain)  # get current delay
        sem   = await ctrl.get_semaphore(domain)  # concurrency semaphore
    """

    # AIMD parameters
    ALPHA          = 1.0      # additive increase (req/min)
    BETA           = 0.5      # multiplicative decrease factor
    MIN_DELAY_MS   = 500.0
    MAX_DELAY_MS   = 30_000.0
    MIN_CONCURRENCY = 1
    MAX_CONCURRENCY = 20

    # Thresholds
    SOFT_BLOCK_CODES  = {429, 503}
    HARD_BLOCK_CODES  = {403, 407}
    ERROR_CODES       = {400, 401, 404, 500, 502, 504}
    PAUSE_DURATION_S  = 30

    def __init__(self, redis_url: str = "redis://localhost:6379/0"):
        self._redis_url  = redis_url
        self._redis: Optional[aioredis.Redis] = None
        self._domains:   dict[str, DomainMetrics]     = {}
        self._semaphores: dict[str, asyncio.Semaphore] = {}
        self._pid:       dict[str, PIDController]     = {}

    async def connect(self):
        self._redis = await aioredis.from_url(self._redis_url, decode_responses=True)
        log.info("rate_controller_connected")

    def _get_domain(self, domain: str) -> DomainMetrics:
        if domain not in self._domains:
            self._domains[domain]    = DomainMetrics(domain=domain)
            self._semaphores[domain] = asyncio.Semaphore(self.MIN_CONCURRENCY)
            self._pid[domain]        = PIDController()
        return self._domains[domain]

    async def record(self, event: TelemetryEvent):
        """Process a telemetry event and update AIMD+PID state."""
        d = self._get_domain(event.domain)
        d.total_requests += 1
        d._window.append(event)

        # Recompute rolling metrics
        window = list(d._window)
        n = len(window)
        errors    = sum(1 for e in window if e.status_code in self.SOFT_BLOCK_CODES
                        | self.HARD_BLOCK_CODES | self.ERROR_CODES)
        captchas  = sum(1 for e in window if e.captcha_detected)
        latencies = sorted(e.latency_ms for e in window)

        d.error_rate    = errors / n
        d.captcha_rate  = captchas / n
        d.p95_latency_ms = latencies[int(n * 0.95)] if n > 5 else event.latency_ms

        # ── AIMD decision ────────────────────────────────────────────────────
        is_success    = (event.status_code == 200 and not event.captcha_detected
                         and not event.waf_detected)
        is_soft_block = event.status_code in self.SOFT_BLOCK_CODES or event.captcha_detected
        is_hard_block = event.status_code in self.HARD_BLOCK_CODES or event.waf_detected

        if is_hard_block:
            await self._hard_block(d)
        elif is_soft_block:
            await self._soft_block(d)
        elif is_success and d.state != DomainState.PAUSED:
            await self._success(d)

        # ── PID overlay ──────────────────────────────────────────────────────
        if d.state == DomainState.CRUISING:
            adjustment = self._pid[event.domain].update(d.error_rate)
            d.delay_ms = max(self.MIN_DELAY_MS,
                             min(self.MAX_DELAY_MS, d.delay_ms * (1 + adjustment)))

        # Persist to Redis for cross-worker sharing
        if self._redis:
            await self._redis.hset(f"omni:domain:{event.domain}", mapping={
                "state":       d.state.value,
                "concurrency": d.concurrency,
                "delay_ms":    d.delay_ms,
                "error_rate":  d.error_rate,
            })

        log.debug("aimd_update",
                  domain=event.domain,
                  state=d.state.value,
                  concurrency=int(d.concurrency),
                  delay_ms=round(d.delay_ms),
                  error_rate=round(d.error_rate, 3))

    async def _success(self, d: DomainMetrics):
        d.state       = DomainState.CRUISING
        d.success_count += 1
        # Additive increase: +1 req/min worth
        d.concurrency = min(self.MAX_CONCURRENCY, d.concurrency + (self.ALPHA / 60))
        d.delay_ms    = max(self.MIN_DELAY_MS, d.delay_ms * 0.97)
        await self._update_semaphore(d)

    async def _soft_block(self, d: DomainMetrics):
        d.state       = DomainState.BACKING
        d.block_count += 1
        # Multiplicative decrease: halve concurrency
        d.concurrency = max(self.MIN_CONCURRENCY, d.concurrency * self.BETA)
        d.delay_ms    = min(self.MAX_DELAY_MS, d.delay_ms * 2.0)
        await self._update_semaphore(d)
        log.warning("soft_block_detected", domain=d.domain, new_delay_ms=d.delay_ms)

    async def _hard_block(self, d: DomainMetrics):
        d.state       = DomainState.PAUSED
        d.concurrency = self.MIN_CONCURRENCY
        d.delay_ms    = min(self.MAX_DELAY_MS, d.delay_ms * 4.0)
        await self._update_semaphore(d)
        log.error("hard_block_detected", domain=d.domain,
                  pausing_for_s=self.PAUSE_DURATION_S)
        # Schedule unpause
        asyncio.create_task(self._unpause_after(d, self.PAUSE_DURATION_S))

    async def _unpause_after(self, d: DomainMetrics, seconds: int):
        await asyncio.sleep(seconds)
        if d.state == DomainState.PAUSED:
            d.state = DomainState.PROBING
            log.info("domain_unpaused", domain=d.domain)

    async def _update_semaphore(self, d: DomainMetrics):
        """Resize the semaphore for a domain."""
        target = max(self.MIN_CONCURRENCY, int(d.concurrency))
        old    = self._semaphores[d.domain]
        # Replace with new semaphore at target level
        self._semaphores[d.domain] = asyncio.Semaphore(target)

    async def get_delay(self, domain: str) -> float:
        """Get current sleep delay in seconds for a domain."""
        d = self._get_domain(domain)
        if d.state == DomainState.PAUSED:
            # Return a long wait during pause
            return self.PAUSE_DURATION_S
        return d.delay_ms / 1000.0

    def get_semaphore(self, domain: str) -> asyncio.Semaphore:
        self._get_domain(domain)
        return self._semaphores[domain]

    def get_metrics(self, domain: str) -> dict:
        d = self._get_domain(domain)
        return {
            "domain":       d.domain,
            "state":        d.state.value,
            "concurrency":  int(d.concurrency),
            "delay_ms":     round(d.delay_ms),
            "error_rate":   round(d.error_rate, 4),
            "captcha_rate": round(d.captcha_rate, 4),
            "p95_latency":  round(d.p95_latency_ms),
            "total_req":    d.total_requests,
            "blocks":       d.block_count,
        }

    def get_all_metrics(self) -> list[dict]:
        return [self.get_metrics(d) for d in self._domains]
