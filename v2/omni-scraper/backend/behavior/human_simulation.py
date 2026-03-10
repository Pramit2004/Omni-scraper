"""
╔══════════════════════════════════════════════════════════╗
║  OMNI-SCRAPER — Human Behavior Simulation Engine        ║
║  Bézier mouse · Biometric typing · Scroll dynamics      ║
╚══════════════════════════════════════════════════════════╝
"""

from __future__ import annotations
import asyncio
import random
import math
import time
from typing import Tuple

import numpy as np
from playwright.async_api import Page, Mouse
import structlog

log = structlog.get_logger()

Point = Tuple[float, float]


# ── Bézier curve utilities ───────────────────────────────────────────────────

def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t

def _bezier_point(p0: Point, p1: Point, p2: Point, p3: Point, t: float) -> Point:
    """Cubic Bézier interpolation."""
    mt = 1 - t
    x = mt**3 * p0[0] + 3*mt**2*t*p1[0] + 3*mt*t**2*p2[0] + t**3*p3[0]
    y = mt**3 * p0[1] + 3*mt**2*t*p1[1] + 3*mt*t**2*p2[1] + t**3*p3[1]
    return (x, y)

def _generate_bezier_path(
    start:   Point,
    end:     Point,
    steps:   int   = 40,
    jitter:  float = 0.35,
) -> list[Point]:
    """
    Generate a curved mouse path between start and end.
    Control points are randomized to create natural curves.
    """
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    dist = math.hypot(dx, dy)

    # Control points offset perpendicular to the movement direction
    perp_x = -dy / dist if dist > 0 else 0
    perp_y =  dx / dist if dist > 0 else 0

    jitter_strength = dist * jitter
    cp1 = (
        start[0] + dx * 0.3 + perp_x * random.gauss(0, jitter_strength * 0.5),
        start[1] + dy * 0.3 + perp_y * random.gauss(0, jitter_strength * 0.5),
    )
    cp2 = (
        start[0] + dx * 0.7 + perp_x * random.gauss(0, jitter_strength * 0.5),
        start[1] + dy * 0.7 + perp_y * random.gauss(0, jitter_strength * 0.5),
    )

    path = []
    for i in range(steps + 1):
        t = i / steps
        # Ease in/out using sine curve
        t_eased = (1 - math.cos(t * math.pi)) / 2
        pt = _bezier_point(start, cp1, cp2, end, t_eased)
        path.append(pt)

    return path


class HumanMouse:
    """Simulates human-like mouse movement using Bézier curves."""

    def __init__(self, page: Page):
        self.page   = page
        self._pos_x = 0.0
        self._pos_y = 0.0

    async def move_to(self, x: float, y: float, speed: str = "normal"):
        """Move mouse from current position to (x, y) along a curved path."""
        start = (self._pos_x, self._pos_y)
        end   = (x + random.gauss(0, 2), y + random.gauss(0, 2))

        dist = math.hypot(end[0] - start[0], end[1] - start[1])
        steps = max(10, int(dist / 10))

        # Speed profiles
        base_delay_ms = {"slow": 80, "normal": 45, "fast": 18}[speed]

        path = _generate_bezier_path(start, end, steps=steps, jitter=0.3)

        for i, (px, py) in enumerate(path):
            await self.page.mouse.move(px, py)
            # Velocity follows bell curve — fastest in middle
            progress = i / len(path)
            bell = math.sin(progress * math.pi)
            delay = base_delay_ms / (0.3 + bell * 0.7)
            delay *= random.uniform(0.8, 1.2)  # human variance
            await asyncio.sleep(delay / 1000)

        self._pos_x, self._pos_y = end

    async def click(self, x: float, y: float, button: str = "left"):
        """Move to element and click with human-like timing."""
        await self.move_to(x, y)
        # Pre-click pause (human "aims")
        await asyncio.sleep(random.uniform(0.05, 0.15))
        await self.page.mouse.down(button=button)
        # Click hold duration varies (20-120ms)
        await asyncio.sleep(random.uniform(0.02, 0.12))
        await self.page.mouse.up(button=button)
        # Post-click micro-pause
        await asyncio.sleep(random.uniform(0.03, 0.08))

    async def double_click(self, x: float, y: float):
        await self.click(x, y)
        await asyncio.sleep(random.uniform(0.08, 0.20))
        await self.click(x, y)

    async def idle_wiggle(self):
        """Random micro-movement during wait periods."""
        for _ in range(random.randint(1, 4)):
            dx = random.gauss(0, 30)
            dy = random.gauss(0, 20)
            await self.move_to(
                max(0, self._pos_x + dx),
                max(0, self._pos_y + dy),
                speed="slow",
            )
            await asyncio.sleep(random.uniform(0.3, 1.2))


class HumanKeyboard:
    """
    Biometric typing simulator.
    Models: WPM distribution, per-key timing, typo injection, correction patterns.
    """

    # Character timing profiles (ms) from typing research
    FAST_PAIRS  = {"th", "he", "in", "er", "an", "re", "on", "en", "at", "es"}
    SHIFT_DELAY = (60, 120)

    def __init__(self, page: Page, wpm: float = 65, typo_rate: float = 0.015):
        self.page       = page
        self.wpm        = wpm
        self.typo_rate  = typo_rate
        # Base delay from WPM: chars per second = wpm * 5 / 60
        self._base_ms   = 60_000 / (wpm * 5)

    def _char_delay(self, char: str, prev: str = "") -> float:
        """Inter-keystroke interval for a character pair."""
        base = np.random.lognormal(
            mean=math.log(self._base_ms),
            sigma=0.35,
        )
        # Speed up common digraphs
        pair = (prev + char).lower()
        if pair in self.FAST_PAIRS:
            base *= 0.75
        # Slow down after punctuation or space
        if prev in ".,!?;: ":
            base *= random.uniform(1.2, 1.8)
        return base

    async def type_text(self, text: str, realistic: bool = True):
        """
        Type text with human-like timing, typos, and corrections.
        """
        i = 0
        prev_char = ""

        while i < len(text):
            char = text[i]

            # Inject typo
            if realistic and random.random() < self.typo_rate and char.isalpha():
                typo_char = self._nearby_key(char)
                await self.page.keyboard.type(typo_char)
                await asyncio.sleep(self._char_delay(typo_char, prev_char) / 1000)

                # Correction: notice after 0-3 more chars
                notice_delay = random.randint(0, 3)
                extra_typed = []
                for j in range(notice_delay):
                    if i + j + 1 < len(text):
                        next_char = text[i + j + 1]
                        await asyncio.sleep(self._char_delay(next_char, typo_char) / 1000)
                        await self.page.keyboard.type(next_char)
                        extra_typed.append(next_char)

                # Backspace to fix
                await asyncio.sleep(random.uniform(0.08, 0.25))
                for _ in range(len(extra_typed) + 1):
                    await self.page.keyboard.press("Backspace")
                    await asyncio.sleep(random.uniform(0.05, 0.10))

            else:
                delay = self._char_delay(char, prev_char) / 1000

                # Caps requires shift
                if char.isupper():
                    await self.page.keyboard.down("Shift")
                    await asyncio.sleep(random.uniform(*self.SHIFT_DELAY) / 1000)
                    await self.page.keyboard.type(char.lower())
                    await self.page.keyboard.up("Shift")
                else:
                    await self.page.keyboard.type(char)

                await asyncio.sleep(delay)
                prev_char = char
                i += 1

            # Random thinking pauses mid-sentence
            if realistic and char in " " and random.random() < 0.03:
                await asyncio.sleep(random.uniform(0.4, 2.0))

    def _nearby_key(self, char: str) -> str:
        """Return an adjacent keyboard key (QWERTY layout)."""
        layout = {
            'q':'wa', 'w':'qase', 'e':'wsdr', 'r':'edft', 't':'rfgy',
            'y':'tghu', 'u':'yhji', 'i':'ujko', 'o':'iklp', 'p':'ol',
            'a':'qwsz', 's':'aedxzw', 'd':'srfxce', 'f':'dtgvc', 'g':'fthy',
            'h':'gyujn', 'j':'huikm', 'k':'jiol', 'l':'kop',
            'z':'asx', 'x':'zsdc', 'c':'xdfv', 'v':'cfgb', 'b':'vghn',
            'n':'bhjm', 'm':'njk',
        }
        neighbors = layout.get(char.lower(), char)
        return random.choice(neighbors) if neighbors else char


class HumanScroll:
    """
    Momentum-based scroll engine with reading pauses.
    """

    def __init__(self, page: Page):
        self.page = page

    async def scroll_to_bottom(self, reading_speed: str = "normal"):
        """Scroll to the bottom of the page like a human reading."""
        viewport_height = await self.page.evaluate("window.innerHeight")
        total_height    = await self.page.evaluate("document.body.scrollHeight")
        current_y = 0

        read_pause_ms = {"slow": 3000, "normal": 1500, "fast": 600}[reading_speed]

        while current_y < total_height - viewport_height:
            # Scroll chunk: 40-90% of viewport
            chunk = int(viewport_height * random.uniform(0.4, 0.9))
            steps = random.randint(8, 20)

            # Momentum: accelerate then decelerate
            for step in range(steps):
                t = step / steps
                velocity = math.sin(t * math.pi)  # bell curve
                pixel_step = int((chunk / steps) * (0.3 + velocity * 0.7))
                await self.page.mouse.wheel(0, pixel_step)
                await asyncio.sleep(random.uniform(0.01, 0.04))

            current_y = await self.page.evaluate("window.scrollY")
            total_height = await self.page.evaluate("document.body.scrollHeight")

            # Reading pause
            pause = random.gauss(read_pause_ms, read_pause_ms * 0.3) / 1000
            await asyncio.sleep(max(0.3, pause))

            # Occasional scroll-back (re-reading)
            if random.random() < 0.08:
                back = int(viewport_height * random.uniform(0.1, 0.3))
                await self.page.mouse.wheel(0, -back)
                await asyncio.sleep(random.uniform(0.5, 1.5))

    async def scroll_to_element(self, selector: str):
        """Scroll an element into view naturally."""
        elem = await self.page.query_selector(selector)
        if elem:
            box = await elem.bounding_box()
            if box:
                target_y = box['y'] - 200  # land 200px above element
                current_y = await self.page.evaluate("window.scrollY")
                diff = target_y - current_y
                steps = max(10, abs(diff) // 30)
                for i in range(steps):
                    t = i / steps
                    ease = (1 - math.cos(t * math.pi)) / 2
                    chunk = int(diff / steps * (0.5 + ease))
                    await self.page.mouse.wheel(0, chunk)
                    await asyncio.sleep(random.uniform(0.02, 0.05))
