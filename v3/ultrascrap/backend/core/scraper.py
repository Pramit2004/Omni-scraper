"""
UltraScrap — Core Scraper Engine
Adaptive, general-purpose, intelligent web scraper.
No LLM dependency — pure algorithmic intelligence.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import random
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncGenerator
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    async_playwright,
)

# ── Fingerprint Profiles ──────────────────────────────────────────────────────

FINGERPRINT_PROFILES = [
    {
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "viewport": {"width": 1920, "height": 1080},
        "locale": "en-US",
        "timezone": "America/New_York",
        "platform": "Win32",
        "color_scheme": "light",
    },
    {
        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "viewport": {"width": 1440, "height": 900},
        "locale": "en-GB",
        "timezone": "Europe/London",
        "platform": "MacIntel",
        "color_scheme": "dark",
    },
    {
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
        "viewport": {"width": 1366, "height": 768},
        "locale": "en-US",
        "timezone": "America/Chicago",
        "platform": "Win32",
        "color_scheme": "light",
    },
    {
        "user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "viewport": {"width": 1280, "height": 800},
        "locale": "en-US",
        "timezone": "America/Los_Angeles",
        "platform": "Linux x86_64",
        "color_scheme": "dark",
    },
]


# ── Rate Controller (AIMD + PID) ──────────────────────────────────────────────

@dataclass
class RateController:
    """
    Adaptive AIMD (Additive Increase, Multiplicative Decrease) rate controller
    with PID smoothing to stay just below a site's blocking threshold.
    """
    target_error_rate: float = 0.02   # aim for <2% errors
    concurrency: float = 2.0
    min_concurrency: float = 1.0
    max_concurrency: float = 20.0
    increase_step: float = 0.5
    decrease_factor: float = 0.5
    delay_min: float = 0.8
    delay_max: float = 3.0

    # PID state
    _integral: float = 0.0
    _prev_error: float = 0.0
    _kp: float = 0.3
    _ki: float = 0.05
    _kd: float = 0.1

    # telemetry window
    _recent_codes: list[int] = field(default_factory=list)
    _window_size: int = 30

    def record(self, status_code: int) -> None:
        self._recent_codes.append(status_code)
        if len(self._recent_codes) > self._window_size:
            self._recent_codes.pop(0)
        self._adapt()

    def _adapt(self) -> None:
        if len(self._recent_codes) < 5:
            return
        errors = sum(1 for c in self._recent_codes if c in (429, 403, 503, 0))
        error_rate = errors / len(self._recent_codes)

        # PID calculation
        err = error_rate - self.target_error_rate
        self._integral += err
        derivative = err - self._prev_error
        self._prev_error = err

        adjustment = self._kp * err + self._ki * self._integral + self._kd * derivative

        if error_rate > self.target_error_rate * 2:
            # Pain detected — multiplicative decrease
            self.concurrency = max(self.min_concurrency, self.concurrency * self.decrease_factor)
            self.delay_min = min(self.delay_min * 1.5, 8.0)
            self.delay_max = min(self.delay_max * 1.5, 15.0)
        elif error_rate < self.target_error_rate * 0.5:
            # All good — additive increase
            self.concurrency = min(self.max_concurrency, self.concurrency + self.increase_step - adjustment)
            self.delay_min = max(0.3, self.delay_min * 0.95)
            self.delay_max = max(0.8, self.delay_max * 0.95)

    @property
    def current_delay(self) -> float:
        return random.uniform(self.delay_min, self.delay_max)

    @property
    def int_concurrency(self) -> int:
        return max(1, int(self.concurrency))

    def status_dict(self) -> dict:
        errors = sum(1 for c in self._recent_codes if c in (429, 403, 503, 0))
        rate = errors / max(1, len(self._recent_codes))
        return {
            "concurrency": self.int_concurrency,
            "delay_range": [round(self.delay_min, 2), round(self.delay_max, 2)],
            "error_rate": round(rate * 100, 1),
            "samples": len(self._recent_codes),
        }


# ── Behavioral Simulator ──────────────────────────────────────────────────────

class BehavioralSimulator:
    """Pure-math human behavior simulation. No LLM required."""

    @staticmethod
    async def human_scroll(page: Page) -> None:
        """Realistic scroll with variable speed, pauses, small upscrolls."""
        total_height = await page.evaluate("document.body.scrollHeight")
        viewport_h = page.viewport_size["height"] if page.viewport_size else 768
        position = 0
        while position < total_height - viewport_h:
            step = random.randint(80, 350)
            # Occasionally scroll back up slightly (human reading behaviour)
            if random.random() < 0.15:
                step = -random.randint(30, 120)
            position = max(0, position + step)
            await page.evaluate(f"window.scrollTo({{top: {position}, behavior: 'smooth'}})")
            await asyncio.sleep(random.uniform(0.05, 0.25))
            if random.random() < 0.1:  # random pause while reading
                await asyncio.sleep(random.uniform(0.5, 2.0))

    @staticmethod
    async def human_mouse_move(page: Page, target_x: int, target_y: int) -> None:
        """Bézier-curve mouse movement from current position to target."""
        try:
            curr = await page.evaluate("({x: window.mouseX || 0, y: window.mouseY || 0})")
            sx, sy = curr.get("x", 0), curr.get("y", 0)
            # Control points for cubic Bézier
            cx1 = sx + random.randint(-200, 200)
            cy1 = sy + random.randint(-100, 100)
            cx2 = target_x + random.randint(-100, 100)
            cy2 = target_y + random.randint(-100, 100)
            steps = random.randint(20, 50)
            for i in range(steps):
                t = i / steps
                x = int((1-t)**3*sx + 3*(1-t)**2*t*cx1 + 3*(1-t)*t**2*cx2 + t**3*target_x)
                y = int((1-t)**3*sy + 3*(1-t)**2*t*cy1 + 3*(1-t)*t**2*cy2 + t**3*target_y)
                await page.mouse.move(x, y)
                await asyncio.sleep(random.uniform(0.005, 0.02))
        except Exception:
            await page.mouse.move(target_x, target_y)

    @staticmethod
    async def human_type(page: Page, selector: str, text: str) -> None:
        """Type with variable speed, occasional typos & corrections."""
        await page.click(selector)
        await asyncio.sleep(random.uniform(0.2, 0.6))
        for char in text:
            # Rare typo simulation
            if random.random() < 0.03:
                wrong = random.choice("qwertyuiopasdfghjklzxcvbnm")
                await page.keyboard.type(wrong, delay=random.randint(50, 150))
                await asyncio.sleep(random.uniform(0.1, 0.3))
                await page.keyboard.press("Backspace")
            await page.keyboard.type(char, delay=random.randint(40, 180))


# ── Universal Content Extractor ───────────────────────────────────────────────

class UniversalExtractor:
    """
    General-purpose content extractor.
    Understands semantic HTML without hardcoding site-specific selectors.
    """

    # Priority selector map — tries structured data first, then semantic HTML
    CONTENT_STRATEGIES = [
        # Structured data (best quality)
        {"type": "json_ld", "selector": 'script[type="application/ld+json"]'},
        # Semantic article content
        {"type": "semantic", "selector": "article, main, [role='main']"},
        # Tables (for data-heavy pages like Wikipedia)
        {"type": "table", "selector": "table.wikitable, table.infobox, table.sortable, table"},
        # Lists
        {"type": "list", "selector": "ul, ol"},
        # Generic content fallback
        {"type": "body", "selector": "body"},
    ]

    NOISE_SELECTORS = [
        "nav", "header", "footer", "aside", ".ad", ".advertisement",
        ".cookie", ".popup", ".modal", ".overlay", ".sidebar",
        '[class*="banner"]', '[class*="cookie"]', '[id*="cookie"]',
        "script", "style", "noscript", "iframe",
    ]

    @classmethod
    async def extract(cls, page: Page, url: str, data_type: str = "auto") -> dict[str, Any]:
        """Extract content intelligently based on page structure."""
        html = await page.content()
        soup = BeautifulSoup(html, "lxml")

        # Remove noise
        for selector in cls.NOISE_SELECTORS:
            for el in soup.select(selector):
                el.decompose()

        result = {
            "url": url,
            "title": cls._extract_title(soup),
            "meta": cls._extract_meta(soup),
            "data": {},
            "links": [],
            "images": [],
        }

        # Try JSON-LD structured data first
        json_ld = cls._extract_json_ld(soup)
        if json_ld:
            result["data"]["structured"] = json_ld

        # Extract based on requested type
        if data_type in ("auto", "text"):
            result["data"]["text"] = cls._extract_text_blocks(soup)
        if data_type in ("auto", "table"):
            tables = cls._extract_tables(soup)
            if tables:
                result["data"]["tables"] = tables
        if data_type in ("auto", "links"):
            result["links"] = cls._extract_links(soup, url)
        if data_type in ("auto", "images"):
            result["images"] = cls._extract_images(soup, url)

        # Product/price extraction heuristic
        prices = cls._extract_prices(soup)
        if prices:
            result["data"]["prices"] = prices

        # Key-value pairs (definitions, specs, infoboxes)
        kvs = cls._extract_key_value(soup)
        if kvs:
            result["data"]["attributes"] = kvs

        return result

    @staticmethod
    def _extract_title(soup: BeautifulSoup) -> str:
        og = soup.find("meta", property="og:title")
        if og and og.get("content"):
            return og["content"]
        title = soup.find("title")
        return title.get_text(strip=True) if title else ""

    @staticmethod
    def _extract_meta(soup: BeautifulSoup) -> dict:
        meta = {}
        for tag in soup.find_all("meta"):
            name = tag.get("name") or tag.get("property", "")
            content = tag.get("content", "")
            if name and content:
                meta[name] = content
        return meta

    @staticmethod
    def _extract_json_ld(soup: BeautifulSoup) -> list:
        results = []
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "{}")
                results.append(data)
            except Exception:
                pass
        return results

    @staticmethod
    def _extract_text_blocks(soup: BeautifulSoup) -> list[dict]:
        blocks = []
        for tag in ["h1", "h2", "h3", "h4", "p", "li", "blockquote", "td", "th"]:
            for el in soup.find_all(tag)[:200]:
                text = el.get_text(" ", strip=True)
                if len(text) > 20:
                    blocks.append({"tag": tag, "text": text})
        return blocks

    @staticmethod
    def _extract_tables(soup: BeautifulSoup) -> list[list[list[str]]]:
        tables = []
        for table in soup.find_all("table")[:10]:
            rows = []
            for tr in table.find_all("tr"):
                cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
                if cells:
                    rows.append(cells)
            if rows:
                tables.append(rows)
        return tables

    @staticmethod
    def _extract_links(soup: BeautifulSoup, base_url: str) -> list[dict]:
        links = []
        for a in soup.find_all("a", href=True)[:500]:
            href = a["href"].strip()
            if href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue
            full = urljoin(base_url, href)
            text = a.get_text(strip=True)
            if full and text:
                links.append({"url": full, "text": text[:200]})
        return links

    @staticmethod
    def _extract_images(soup: BeautifulSoup, base_url: str) -> list[dict]:
        imgs = []
        for img in soup.find_all("img")[:100]:
            src = img.get("src") or img.get("data-src") or img.get("data-lazy-src", "")
            if src:
                imgs.append({
                    "url": urljoin(base_url, src),
                    "alt": img.get("alt", ""),
                    "width": img.get("width"),
                    "height": img.get("height"),
                })
        return imgs

    @staticmethod
    def _extract_prices(soup: BeautifulSoup) -> list[dict]:
        price_pattern = re.compile(r'[\$\€\£\₹\¥]?\s*\d{1,6}(?:[.,]\d{2,3})?(?:\s*[\$\€\£\₹])?')
        results = []
        for el in soup.select('[class*="price"],[class*="cost"],[class*="amount"],[itemprop="price"]')[:50]:
            text = el.get_text(strip=True)
            matches = price_pattern.findall(text)
            if matches:
                results.append({"element": el.name, "raw": text, "values": matches})
        return results

    @staticmethod
    def _extract_key_value(soup: BeautifulSoup) -> dict:
        kv = {}
        # Definition lists
        for dl in soup.find_all("dl"):
            dts = dl.find_all("dt")
            dds = dl.find_all("dd")
            for dt, dd in zip(dts, dds):
                k = dt.get_text(strip=True)
                v = dd.get_text(strip=True)
                if k and v:
                    kv[k] = v
        # Infobox-style th/td pairs
        for table in soup.select("table.infobox, table.wikitable"):
            for tr in table.find_all("tr"):
                cells = tr.find_all(["th", "td"])
                if len(cells) == 2:
                    k = cells[0].get_text(strip=True)
                    v = cells[1].get_text(strip=True)
                    if k and v and len(k) < 80:
                        kv[k] = v
        return kv


# ── Session Manager ───────────────────────────────────────────────────────────

class SessionManager:
    """Manages browser contexts with persistent identity per session."""

    def __init__(self, playwright: Playwright, proxy_list: list[str] | None = None):
        self._pw = playwright
        self._proxy_list = proxy_list or []
        self._browsers: dict[str, Browser] = {}
        self._contexts: dict[str, BrowserContext] = {}

    async def get_context(self, session_id: str) -> BrowserContext:
        if session_id in self._contexts:
            return self._contexts[session_id]

        profile = random.choice(FINGERPRINT_PROFILES)
        proxy_cfg = None
        if self._proxy_list:
            p = random.choice(self._proxy_list)
            proxy_cfg = {"server": p}

        browser = await self._pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--disable-dev-shm-usage",
                f"--window-size={profile['viewport']['width']},{profile['viewport']['height']}",
            ],
        )

        ctx = await browser.new_context(
            user_agent=profile["user_agent"],
            viewport=profile["viewport"],
            locale=profile["locale"],
            timezone_id=profile["timezone"],
            color_scheme=profile["color_scheme"],
            proxy=proxy_cfg,
            extra_http_headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": f"{profile['locale']},en;q=0.5",
                "Accept-Encoding": "gzip, deflate, br",
                "DNT": "1",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
            },
        )

        # Stealth scripts
        await ctx.add_init_script("""
            // Remove webdriver flag
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            // Fake plugins
            Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
            // Fake languages
            Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
            // Override chrome property
            window.chrome = {runtime: {}};
            // Permissions API
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) =>
                parameters.name === 'notifications'
                    ? Promise.resolve({state: Notification.permission})
                    : originalQuery(parameters);
        """)

        self._browsers[session_id] = browser
        self._contexts[session_id] = ctx
        return ctx

    async def close_session(self, session_id: str) -> None:
        if session_id in self._contexts:
            await self._contexts[session_id].close()
            del self._contexts[session_id]
        if session_id in self._browsers:
            await self._browsers[session_id].close()
            del self._browsers[session_id]

    async def close_all(self) -> None:
        for sid in list(self._contexts.keys()):
            await self.close_session(sid)


# ── Main Scraper Engine ───────────────────────────────────────────────────────

class ScrapeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
    RATE_LIMITED = "rate_limited"


@dataclass
class ScrapeResult:
    url: str
    status: ScrapeStatus
    data: dict = field(default_factory=dict)
    error: str | None = None
    http_code: int = 0
    duration_ms: int = 0
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "status": self.status.value,
            "data": self.data,
            "error": self.error,
            "http_code": self.http_code,
            "duration_ms": self.duration_ms,
            "timestamp": self.timestamp,
        }


class UltraScraper:
    """
    The core scraping engine.
    Adaptive, general-purpose, stealth-capable.
    """

    def __init__(
        self,
        proxy_list: list[str] | None = None,
        max_concurrency: int = 5,
        data_type: str = "auto",
    ):
        self._proxy_list = proxy_list or []
        self._max_concurrency = max_concurrency
        self._data_type = data_type
        self._rate_controllers: dict[str, RateController] = {}
        self._behavior = BehavioralSimulator()
        self._pw: Playwright | None = None
        self._session_mgr: SessionManager | None = None
        self._semaphore: asyncio.Semaphore | None = None
        self._results: list[ScrapeResult] = []
        self._is_running = False

    def _get_rate_controller(self, domain: str) -> RateController:
        if domain not in self._rate_controllers:
            self._rate_controllers[domain] = RateController()
        return self._rate_controllers[domain]

    async def start(self) -> None:
        self._pw = await async_playwright().start()
        self._session_mgr = SessionManager(self._pw, self._proxy_list)
        self._semaphore = asyncio.Semaphore(self._max_concurrency)
        self._is_running = True

    async def stop(self) -> None:
        self._is_running = False
        if self._session_mgr:
            await self._session_mgr.close_all()
        if self._pw:
            await self._pw.stop()

    async def scrape_url(
        self,
        url: str,
        session_id: str | None = None,
        depth: int = 0,
    ) -> ScrapeResult:
        domain = urlparse(url).netloc
        rc = self._get_rate_controller(domain)
        sid = session_id or hashlib.md5(url.encode()).hexdigest()[:8]

        async with self._semaphore:
            await asyncio.sleep(rc.current_delay)
            t0 = time.monotonic()

            try:
                ctx = await self._session_mgr.get_context(sid)
                page = await ctx.new_page()

                try:
                    resp = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    http_code = resp.status if resp else 0
                    rc.record(http_code)

                    if http_code in (429, 503):
                        await page.close()
                        return ScrapeResult(url=url, status=ScrapeStatus.RATE_LIMITED, http_code=http_code)

                    if http_code == 403:
                        await page.close()
                        return ScrapeResult(url=url, status=ScrapeStatus.ERROR, http_code=403, error="Access denied")

                    # Human behaviour simulation
                    await asyncio.sleep(random.uniform(0.5, 1.5))
                    await self._behavior.human_scroll(page)

                    # Wait for dynamic content
                    try:
                        await page.wait_for_load_state("networkidle", timeout=10000)
                    except Exception:
                        pass

                    data = await UniversalExtractor.extract(page, url, self._data_type)
                    duration = int((time.monotonic() - t0) * 1000)

                    await page.close()
                    return ScrapeResult(
                        url=url,
                        status=ScrapeStatus.DONE,
                        data=data,
                        http_code=http_code,
                        duration_ms=duration,
                    )

                except Exception as e:
                    rc.record(0)
                    await page.close()
                    raise e

            except Exception as e:
                duration = int((time.monotonic() - t0) * 1000)
                return ScrapeResult(
                    url=url,
                    status=ScrapeStatus.ERROR,
                    error=str(e)[:300],
                    duration_ms=duration,
                )

    async def scrape_many(
        self,
        urls: list[str],
        on_result=None,
    ) -> AsyncGenerator[ScrapeResult, None]:
        """Scrape multiple URLs with adaptive concurrency."""
        tasks = []
        for url in urls:
            task = asyncio.create_task(self.scrape_url(url))
            tasks.append((url, task))

        for url, task in tasks:
            result = await task
            self._results.append(result)
            if on_result:
                await on_result(result)
            yield result

    def rate_status(self) -> dict[str, dict]:
        return {domain: rc.status_dict() for domain, rc in self._rate_controllers.items()}
