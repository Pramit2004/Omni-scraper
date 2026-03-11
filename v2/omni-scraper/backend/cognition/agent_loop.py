"""
OMNI-SCRAPER v5 — Universal Intelligent Agent
Works on ANY public website. No hardcoding.
"""

from __future__ import annotations
import asyncio, hashlib, json, os, re, time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin
import trafilatura
from playwright.async_api import Page
import structlog

from backend.core.llm_router import LLMRouter
from backend.behavior.human_simulation import HumanScroll
from backend.control.aimd_controller import AdaptiveRateController, TelemetryEvent

log = structlog.get_logger()

ANALYST_PROMPT = """You are a universal web scraping planner. Analyze the HTML and user goal, return ONLY this JSON:
{
  "site_type": "ecommerce|wiki|news|forum|table|blog|directory|other",
  "item_selector": "<CSS selector matching each repeating data record>",
  "fields": {"field_name": "<CSS selector relative to item, or empty string>"},
  "pagination_selector": "<CSS selector for next-page link, or null>",
  "base_url": "<base URL for resolving relative links>"
}

CRITICAL RULES:
1. item_selector must match REPEATING content elements, not wrappers or nav
2. Wikipedia main page → ".mw-body-content p" (article paragraphs)
3. Wikipedia article → ".mw-parser-output > p"
4. Books/products → "article.product_pod" or ".product-item"
5. News → "article, .story, .news-item"
6. Tables → "table.wikitable tr, table tr:not(:first-child)"
7. Language link lists → "li.interlanguage-link" only if goal is specifically about languages
8. fields: CSS selectors relative to item_selector. Use "" if no obvious sub-selector.
9. Think about what the USER WANTS from their goal description."""

NAVIGATOR_PROMPT = """Decide the next scraping action. Return ONLY JSON:
{"action": "next_page|scroll|done", "url": "absolute URL or null", "reason": "one sentence"}"""

_NAV_NOISE = {
    "log in","sign in","sign up","register","create account","donate",
    "cookie policy","privacy policy","terms of service","subscribe",
    "newsletter","advertisement","menu","search","home","contact",
    "about","help","faq","sitemap","rss","feed",
}

CANDIDATE_SELECTORS = [
    # E-commerce (most specific first)
    "article.product_pod", ".product_pod", ".product-item", ".product",
    "[class*='product']",
    # News / blog articles
    "article", ".story", ".post", ".entry", ".news-item",
    # Tables (Wikipedia, data sites)
    "table.wikitable tr", "table.infobox tr", "table tr:not(:first-child)",
    # Wikipedia article content
    ".mw-parser-output > p", ".mw-body-content p", ".mw-parser-output p",
    # Generic repeating with classes
    ".item", "[class*='item']", ".card", "[class*='card']",
    ".result", "[class*='result']", ".listing", "li[class]",
    # Bare elements (last resort)
    "p", "li", "tr",
]


@dataclass
class ScrapeStrategy:
    site_type:           str  = "other"
    item_selector:       str  = "p, li, article"
    fields:              dict = field(default_factory=dict)
    pagination_selector: str  = ""
    base_url:            str  = ""


@dataclass
class AgentState:
    goal:           str  = ""
    task_id:        str  = ""
    domain:         str  = ""
    target_records: int  = 1000
    current_url:    str  = ""
    page_text:      str  = ""
    strategy:       Any  = None
    extracted_data: list = field(default_factory=list)
    seen_hashes:    set  = field(default_factory=set)
    visited_urls:   set  = field(default_factory=set)
    chunk_index:    int  = 0
    pages_visited:  int  = 0
    step_count:     int  = 0
    max_steps:      int  = 500
    status:         str  = "running"
    events:         list = field(default_factory=list)


async def save_chunk(task_id: str, idx: int, data: list):
    os.makedirs(f"data/{task_id}", exist_ok=True)
    with open(f"data/{task_id}/chunk_{idx:04d}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


async def load_all_chunks(task_id: str) -> list:
    import glob
    out = []
    for p in sorted(glob.glob(f"data/{task_id}/chunk_*.json")):
        with open(p) as f:
            out.extend(json.load(f))
    return out


async def snapshot_page(page: Page) -> tuple[str, str]:
    try:
        html = await page.evaluate("""() => {
            const c = document.documentElement.cloneNode(true);
            c.querySelectorAll("script,style,noscript,iframe,svg,img").forEach(e=>e.remove());
            const raw = c.outerHTML;
            if (raw.length <= 12000) return raw;
            const cut = raw.lastIndexOf('>', 12000);
            return cut > 9000 ? raw.slice(0,cut+1) : raw.slice(0,12000);
        }""")
    except Exception:
        html = (await page.content())[:12000]
    try:
        text = await page.evaluate("""() => {
            const c = document.body.cloneNode(true);
            c.querySelectorAll("script,style,noscript,iframe").forEach(e=>e.remove());
            return (c.innerText||c.textContent||"").slice(0,5000);
        }""")
    except Exception:
        text = (trafilatura.extract(await page.content()) or "")[:5000]
    return html, text


async def auto_detect_selector(page: Page, url: str) -> str:
    """
    Domain-aware selector detection.
    For Wikipedia: prioritize article content selectors.
    For e-commerce: prioritize product card selectors.
    """
    # Domain-specific priority overrides
    domain_priorities = []
    url_lower = url.lower()
    if "wikipedia" in url_lower or "wikimedia" in url_lower:
        domain_priorities = [
            ".mw-parser-output > p",
            ".mw-body-content p",
            ".mw-parser-output p",
            "table.wikitable tr",
        ]
    elif any(x in url_lower for x in ["shop","store","product","book","amazon","ebay"]):
        domain_priorities = [
            "article.product_pod",".product_pod",".product-item",
            ".product","[class*='product']",
        ]
    elif any(x in url_lower for x in ["news","blog","article","post","medium"]):
        domain_priorities = ["article",".story",".post",".entry",".news-item"]

    # Try domain-specific first, then general list
    candidates = domain_priorities + CANDIDATE_SELECTORS
    seen = set()
    for sel in candidates:
        if sel in seen:
            continue
        seen.add(sel)
        try:
            els = await page.query_selector_all(sel)
            if len(els) >= 2:
                log.info("auto_sel", sel=sel, count=len(els))
                return sel
        except Exception:
            continue
    return "p"


async def analyze_site(llm: LLMRouter, html: str, goal: str,
                       url: str, page: Page) -> ScrapeStrategy:
    prompt = f"Goal: {goal}\nURL: {url}\n\nPage HTML:\n{html[:9000]}"
    strategy = None

    for attempt in range(2):
        try:
            result = await asyncio.wait_for(
                llm.json_complete(
                    messages=[{"role": "user", "content": prompt}],
                    system=ANALYST_PROMPT,
                    max_tokens=600,
                ),
                timeout=60.0
            )
            item_sel = (result.get("item_selector") or "").strip()
            if not item_sel:
                continue
            try:
                count = len(await page.query_selector_all(item_sel))
            except Exception:
                count = 0

            log.info("llm_sel", sel=item_sel, count=count, attempt=attempt)

            if count >= 2:
                strategy = ScrapeStrategy(
                    site_type          = result.get("site_type","other"),
                    item_selector      = item_sel,
                    fields             = result.get("fields",{}) or {},
                    pagination_selector= result.get("pagination_selector","") or "",
                    base_url           = result.get("base_url","") or url,
                )
                break
            else:
                prompt = (
                    f"Goal: {goal}\nURL: {url}\n\n"
                    f"RETRY: '{item_sel}' matched only {count} elements. "
                    f"Find the REPEATING element selector.\n\nHTML:\n{html[:9000]}"
                )
        except Exception as e:
            log.warning("llm_analyze_err", attempt=attempt, err=str(e)[:100])

    if not strategy:
        auto_sel = await auto_detect_selector(page, url)
        strategy = ScrapeStrategy(item_selector=auto_sel, base_url=url)

    # Infer site_type
    sel_l = strategy.item_selector.lower()
    if strategy.site_type == "other":
        if any(x in sel_l for x in ["product","book","shop","price"]):
            strategy.site_type = "ecommerce"
        elif any(x in sel_l for x in ["article","post","entry","story","news"]):
            strategy.site_type = "blog"
        elif "tr" in sel_l or "table" in sel_l:
            strategy.site_type = "table"
        elif "wikipedia" in url or "wiki" in url:
            strategy.site_type = "wiki"

    return strategy


async def extract_elements_raw(page: Page, strategy: ScrapeStrategy,
                                limit: int = 300) -> list[dict]:
    selector = strategy.item_selector or "p, li, article"
    raw_items = []
    try:
        elements = await page.query_selector_all(selector)
        log.info("dom_els", sel=selector, count=len(elements))
        for el in elements[:limit]:
            try:
                text = (await el.inner_text()).strip()
                if len(text) < 2:
                    continue
                if text.lower() in _NAV_NOISE:
                    continue

                links = []
                for a in await el.query_selector_all("a[href]"):
                    href = await a.get_attribute("href")
                    if href and not href.startswith(("#","javascript:","mailto:")):
                        links.append(urljoin(strategy.base_url, href))

                field_values = {}
                for fname, fsel in (strategy.fields or {}).items():
                    if not fsel:
                        continue
                    try:
                        sub = await el.query_selector(str(fsel))
                        if sub:
                            val = (await sub.inner_text()).strip()
                            if val:
                                field_values[fname] = val
                    except Exception:
                        pass

                raw_items.append({
                    "text":   text,
                    "links":  links[:5],
                    "fields": field_values,
                    "url":    page.url,
                })
            except Exception:
                continue
    except Exception as e:
        log.warning("dom_err", sel=selector, err=str(e)[:80])
    return raw_items


def build_records(raw_items: list[dict], strategy: ScrapeStrategy) -> list[dict]:
    """Universal builder — ALWAYS produces records if raw_items non-empty."""
    records = []
    for item in raw_items:
        text   = item.get("text","")
        links  = item.get("links",[])
        fields = item.get("fields",{})
        url    = item.get("url","")

        rec = dict(fields)
        rec["source_url"] = url
        if links:
            rec["url"] = links[0]

        lines = [l.strip() for l in text.split("\n")
                 if l.strip() and len(l.strip()) >= 2]

        if not rec.get("title") and lines:
            rec["title"] = lines[0][:300]

        # Always store full content for text-heavy sites
        clean = re.sub(r"\s+", " ", text).strip()
        if clean and not rec.get("content") and len(clean) > 10:
            rec["content"] = clean[:1000]

        # Price
        if not rec.get("price"):
            m = re.search(r"[£$€¥₹]\s*[\d,]+\.?\d*|[\d,]+\.?\d*\s*(?:USD|EUR|GBP)", text)
            if m:
                rec["price"] = m.group(0).strip()

        # Rating
        if not rec.get("rating"):
            m = re.search(r"\b(One|Two|Three|Four|Five)\b", text, re.I)
            if m:
                rec["rating"] = {"one":"1","two":"2","three":"3",
                                  "four":"4","five":"5"}.get(m.group(1).lower(),"")
            else:
                m = re.search(r"(\d\.?\d*)\s*(?:out of \d|/\s*\d|stars?)", text, re.I)
                if m:
                    rec["rating"] = m.group(1)

        # Availability
        if not rec.get("availability"):
            m = re.search(r"\b(In stock|Out of stock|Available|Unavailable|Sold out)\b",
                          text, re.I)
            if m:
                rec["availability"] = m.group(1)

        # Date
        if not rec.get("date"):
            m = re.search(
                r"\b\d{4}-\d{2}-\d{2}\b"
                r"|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b"
                r"|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|"
                r"September|October|November|December)\s+\d{4}\b",
                text, re.I
            )
            if m:
                rec["date"] = m.group(0)

        # Author
        if not rec.get("author"):
            m = re.search(r"(?:by|author[:\s]+)\s*([A-Z][a-zA-Z\-]+ [A-Z][a-zA-Z\-]+)", text)
            if m:
                rec["author"] = m.group(1)

        # Extra links
        if len(links) > 1 and not rec.get("links"):
            rec["links"] = links[:5]

        # Noise filter
        title_l = rec.get("title","").lower().strip()
        if title_l in _NAV_NOISE:
            continue

        # Must have SOMETHING useful beyond source_url
        useful = {k for k in rec
                  if k not in ("source_url","url","links")
                  and rec[k] not in (None,"",[])}
        if not useful:
            continue

        records.append(rec)
    return records


def deduplicate(records: list[dict], seen: set) -> list[dict]:
    out = []
    for r in records:
        key = {k: v for k, v in r.items() if k not in ("source_url","url","links")}
        h = hashlib.md5(json.dumps(key, sort_keys=True, default=str).encode()).hexdigest()
        if h not in seen:
            seen.add(h)
            out.append(r)
    return out


_NEXT_SELS = [
    "a[rel=next]","a[rel='next']","li.next a",".next a",".next-page a",
    ".pagination a.next",".pager-next a","a.next","[aria-label='Next page']",
]

async def get_next_page_url(page: Page, strategy: ScrapeStrategy,
                             current_url: str, visited: set) -> str | None:
    """
    Find next page. Handles:
    - Standard pagination (Next button)
    - Wikipedia (no Next button — follow article links)
    - Numbered pages (?page=2, /page/2/, catalogue/page-2.html)
    """
    candidates = []

    # 1. Strategy-defined pagination selector
    if strategy.pagination_selector:
        try:
            el = await page.query_selector(strategy.pagination_selector)
            if el:
                href = await el.get_attribute("href")
                if href:
                    candidates.append(urljoin(current_url, href))
        except Exception:
            pass

    # 2. Standard next-page selectors
    for sel in _NEXT_SELS:
        try:
            el = await page.query_selector(sel)
            if el:
                href = await el.get_attribute("href")
                if href:
                    candidates.append(urljoin(current_url, href))
                    break
        except Exception:
            continue

    # 3. Text "Next" link scan
    try:
        for a in await page.query_selector_all("a"):
            t = (await a.inner_text()).strip()
            if t in ("Next","next","Next →","Next »","›","»",">","Older posts","Load more"):
                href = await a.get_attribute("href")
                if href and not href.startswith("#"):
                    candidates.append(urljoin(current_url, href))
                    break
    except Exception:
        pass

    # 4. URL increment fallback (page=N → page=N+1)
    if not candidates:
        import re as _re
        from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
        parsed = urlparse(current_url)
        qs = parse_qs(parsed.query, keep_blank_values=True)
        if "page" in qs:
            try:
                next_page = int(qs["page"][0]) + 1
                qs["page"] = [str(next_page)]
                new_query = urlencode(qs, doseq=True)
                next_url = urlunparse(parsed._replace(query=new_query))
                candidates.append(next_url)
            except Exception:
                pass

        # /page/N/ pattern
        pat_page = r'/page/(\d+)'
        m = _re.search(pat_page, parsed.path)
        if m:
            next_n = int(m.group(1)) + 1
            new_path = _re.sub(r'/page/\d+', f'/page/{next_n}', parsed.path)
            candidates.append(urlunparse(parsed._replace(path=new_path)))

        # catalogue/page-N.html pattern (books.toscrape)
        pat_html = r'page-(\d+)\.html'
        m = _re.search(pat_html, parsed.path)
        if m:
            next_n = int(m.group(1)) + 1
            new_path = _re.sub(r'page-\d+\.html', f'page-{next_n}.html', parsed.path)
            candidates.append(urlunparse(parsed._replace(path=new_path)))

    for url in candidates:
        if url and url != current_url and url not in visited:
            return url
    return None


async def decide_navigation(llm: LLMRouter, state: AgentState) -> dict:
    context = (
        f"Goal: {state.goal}\nURL: {state.current_url}\n"
        f"Records: {len(state.extracted_data)}/{state.target_records}\n"
        f"Pages: {state.pages_visited}\nVisited: {list(state.visited_urls)[-5:]}\n"
        f"Page text:\n{state.page_text[:800]}"
    )
    try:
        return await asyncio.wait_for(
            llm.json_complete(
                messages=[{"role":"user","content":context}],
                system=NAVIGATOR_PROMPT,
            ),
            timeout=30.0
        )
    except Exception:
        return {"action":"done","url":None,"reason":"timeout"}


CHUNK_SIZE = 50


class OmniAgent:
    def __init__(self, llm: LLMRouter, rate_ctrl: AdaptiveRateController):
        self.llm       = llm
        self.rate_ctrl = rate_ctrl

    async def run(self, page: Page, goal: str, task_id: str = "",
                  domain: str = "", target_records: int = 1000,
                  on_event: Any = None) -> AgentState:

        scroll = HumanScroll(page)
        state  = AgentState(
            goal=goal, task_id=task_id, domain=domain,
            target_records=target_records, current_url=page.url,
        )

        async def emit(ev: dict):
            ev["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            state.events.append(ev)
            if on_event:
                await on_event(ev)

        await emit({"type":"scale_info","target":target_records,"workers":1})
        await emit({"type":"perceive","url":page.url,"ms":0})

        html, text = await snapshot_page(page)
        state.page_text   = text
        state.current_url = page.url
        state.visited_urls.add(page.url)

        t0       = time.monotonic()
        strategy = await analyze_site(self.llm, html, goal, page.url, page)
        state.strategy = strategy

        await emit({
            "type":      "reason",
            "action":    "analyze",
            "target":    strategy.item_selector,
            "reasoning": (
                f"✓ {strategy.site_type.upper()} | "
                f"selector: {strategy.item_selector} | "
                f"fields: {list(strategy.fields.keys()) or 'auto'} | "
                f"paginate: {strategy.pagination_selector or 'heuristic'}"
            ),
            "ms": round((time.monotonic()-t0)*1000),
        })

        while state.status == "running" and state.step_count < state.max_steps:
            state.step_count += 1
            remaining = state.target_records - len(state.extracted_data)
            if remaining <= 0:
                state.status = "done"
                break

            t0 = time.monotonic()
            raw_items = await extract_elements_raw(
                page, strategy, limit=min(300, remaining * 3)
            )
            ms = round((time.monotonic()-t0)*1000)

            if raw_items:
                new_records = build_records(raw_items, strategy)
                new_records = deduplicate(new_records, state.seen_hashes)
                new_records = new_records[:remaining]

                if new_records:
                    state.extracted_data.extend(new_records)
                    total = len(state.extracted_data)

                    boundary = total // CHUNK_SIZE
                    if boundary > state.chunk_index:
                        await save_chunk(
                            task_id, state.chunk_index,
                            state.extracted_data[
                                state.chunk_index*CHUNK_SIZE : boundary*CHUNK_SIZE
                            ]
                        )
                        state.chunk_index = boundary

                    pct = min(100, round(total/target_records*100, 1))
                    await emit({
                        "type":"extract","new_records":len(new_records),
                        "total":total,"target":target_records,
                        "progress_pct":pct,"pages":state.pages_visited,
                        "sample":new_records[:5],"ms":ms,
                    })
                    if total >= target_records:
                        state.status = "done"
                        break
                else:
                    await emit({
                        "type":"act","action":"extract",
                        "target":strategy.item_selector,"success":False,
                        "error":f"All {len(raw_items)} elements filtered. Sample: '{raw_items[0]['text'][:80]}'",
                        "ms":ms,
                    })
            else:
                await emit({
                    "type":"act","action":"extract",
                    "target":strategy.item_selector,"success":False,
                    "error":f"Selector '{strategy.item_selector}' found 0 elements","ms":ms,
                })

            next_url = await get_next_page_url(
                page, strategy, state.current_url, state.visited_urls
            )
            if not next_url:
                nav = await decide_navigation(self.llm, state)
                action = nav.get("action","done")
                if action == "scroll":
                    await scroll.scroll_to_bottom(reading_speed="fast")
                    await asyncio.sleep(0.8)
                    _, state.page_text = await snapshot_page(page)
                    state.current_url = page.url
                    continue
                elif action in ("next_page","navigate") and nav.get("url"):
                    next_url = nav["url"]
                else:
                    state.status = "done"
                    break

            if next_url and next_url not in state.visited_urls:
                try:
                    await page.goto(next_url, wait_until="domcontentloaded", timeout=25000)
                    await asyncio.sleep(0.3)
                    state.visited_urls.add(next_url)
                    state.pages_visited += 1
                    state.current_url = page.url
                    _, state.page_text = await snapshot_page(page)
                    await emit({"type":"act","action":"navigate",
                                "target":next_url,"success":True,"ms":0})
                except Exception as ex:
                    await emit({"type":"act","action":"navigate","target":next_url,
                                "success":False,"error":str(ex)[:100],"ms":0})
                    state.status = "done"
                    break
            else:
                state.status = "done"
                break

            metrics = self.rate_ctrl.get_metrics(domain)
            await asyncio.sleep(0.2 if metrics.get("error_rate",0) < 0.02 else 1.0)
            await self.rate_ctrl.record(TelemetryEvent(
                timestamp=time.time(), url=state.current_url,
                domain=domain, proxy_id="default",
                status_code=200, latency_ms=200,
            ))

        tail = state.chunk_index * CHUNK_SIZE
        if tail < len(state.extracted_data):
            await save_chunk(task_id, state.chunk_index, state.extracted_data[tail:])

        return state