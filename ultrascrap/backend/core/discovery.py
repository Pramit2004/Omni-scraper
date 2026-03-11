"""
UltraScrap — URL Discovery
Converts natural language targets into URL lists.
Pure heuristic logic, no LLM required.
"""

from __future__ import annotations

import re
from urllib.parse import quote_plus, urlparse, urljoin
import httpx
from bs4 import BeautifulSoup


class URLDiscovery:
    """
    Given a natural language target or a seed URL,
    discovers the list of URLs to scrape.
    """

    WIKIPEDIA_PATTERNS = [
        r"wikipedia\.org",
        r"^wiki[:/]",
        r"wikipedia",
    ]

    @classmethod
    async def resolve(cls, target: str, limit: int = 50) -> list[str]:
        """
        Resolve a target (URL or natural language) to a list of URLs.
        """
        target = target.strip()

        # Already a URL?
        if re.match(r"^https?://", target):
            return await cls._crawl_seed(target, limit)

        # Wikipedia shorthand?
        if any(re.search(p, target, re.I) for p in cls.WIKIPEDIA_PATTERNS):
            query = re.sub(r"wikipedia[:/]?\s*", "", target, flags=re.I).strip()
            return await cls._wikipedia_urls(query, limit)

        # Looks like a domain?
        if re.match(r"^[\w\-]+\.(com|org|net|io|co|gov|edu)", target):
            return await cls._crawl_seed(f"https://{target}", limit)

        # Natural language → attempt web discovery
        return await cls._natural_language_resolve(target, limit)

    @classmethod
    async def _crawl_seed(cls, url: str, limit: int) -> list[str]:
        """Crawl a seed URL and collect internal links."""
        urls = [url]
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                r = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; UltraScrap/1.0)"})
                soup = BeautifulSoup(r.text, "lxml")
                base = urlparse(url)
                for a in soup.find_all("a", href=True):
                    href = a["href"].strip()
                    if href.startswith("#") or href.startswith("javascript:"):
                        continue
                    full = urljoin(url, href)
                    parsed = urlparse(full)
                    if parsed.netloc == base.netloc and full not in urls:
                        urls.append(full)
                    if len(urls) >= limit:
                        break
        except Exception:
            pass
        return urls[:limit]

    @classmethod
    async def _wikipedia_urls(cls, query: str, limit: int) -> list[str]:
        """Search Wikipedia and return article URLs."""
        urls = []
        try:
            search_url = f"https://en.wikipedia.org/w/api.php?action=opensearch&search={quote_plus(query)}&limit={min(limit, 50)}&format=json"
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(search_url)
                data = r.json()
                if len(data) >= 4:
                    urls = list(data[3])
        except Exception:
            # Fallback to direct article URL
            slug = query.replace(" ", "_")
            urls = [f"https://en.wikipedia.org/wiki/{slug}"]
        return urls[:limit]

    @classmethod
    async def _natural_language_resolve(cls, target: str, limit: int) -> list[str]:
        """
        Heuristically convert natural language to URLs.
        e.g. "top python packages on pypi" → pypi.org search
        """
        t = target.lower()

        # Common platform patterns
        if "github" in t:
            q = re.sub(r"github\s*:?\s*", "", t).strip()
            return [f"https://github.com/search?q={quote_plus(q)}&type=repositories"]

        if "pypi" in t or "python package" in t:
            q = re.sub(r"(pypi|python package[s]?)\s*:?\s*", "", t).strip()
            return [f"https://pypi.org/search/?q={quote_plus(q)}"]

        if "npm" in t or "node package" in t:
            q = re.sub(r"(npm|node package[s]?)\s*:?\s*", "", t).strip()
            return [f"https://www.npmjs.com/search?q={quote_plus(q)}"]

        if "reddit" in t:
            q = re.sub(r"reddit\s*:?\s*", "", t).strip()
            return [f"https://www.reddit.com/search/?q={quote_plus(q)}"]

        if "hacker news" in t or "hackernews" in t or "hn" in t:
            q = re.sub(r"(hacker\s*news|hn)\s*:?\s*", "", t).strip()
            return [f"https://hn.algolia.com/api/v1/search?query={quote_plus(q)}&hitsPerPage={limit}"]

        # Default: treat as Wikipedia search
        return await cls._wikipedia_urls(target, limit)
