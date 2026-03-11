"""
UltraScrap - Multi-site test
Run: python3 test_multi.py
"""
import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.core.scraper import UltraScraper

TARGETS = [
    # (label, url)
    ("Wikipedia",   "https://en.wikipedia.org/wiki/Artificial_intelligence"),
    ("Hacker News", "https://news.ycombinator.com"),
    ("PyPI",        "https://pypi.org/project/requests/"),
    ("GitHub",      "https://github.com/trending"),
    ("BBC News",    "https://www.bbc.com/news"),
]

async def main():
    print("=" * 65)
    print("  UltraScrap — Multi-Site Test")
    print("=" * 65)

    scraper = UltraScraper(max_concurrency=2, data_type="auto")
    await scraper.start()

    urls = [url for _, url in TARGETS]
    label_map = {url: label for label, url in TARGETS}

    async for result in scraper.scrape_many(urls):
        label = label_map.get(result.url, result.url)
        print(f"\n{'─'*65}")
        print(f"  [{label}]")
        print(f"  Status : {result.status.value}   HTTP: {result.http_code}   Time: {result.duration_ms}ms")

        if result.error:
            print(f"  Error  : {result.error}")
            continue

        d = result.data
        print(f"  Title  : {d.get('title','N/A')[:80]}")

        texts  = d.get('data',{}).get('text',[])
        tables = d.get('data',{}).get('tables',[])
        links  = d.get('links',[])
        prices = d.get('data',{}).get('prices',[])

        print(f"  Data   : {len(texts)} text blocks | {len(tables)} tables | {len(links)} links | {len(prices)} prices")

        for block in texts[:2]:
            preview = block['text'][:100].replace('\n',' ')
            print(f"  [{block['tag']:>3}] {preview}…")

    await scraper.stop()
    print(f"\n{'='*65}")
    print("  Done!")
    print(f"{'='*65}")

asyncio.run(main())