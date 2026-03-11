"""
UltraScrap - Simple Test
Run from project root: python3 test_scraper.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.core.scraper import UltraScraper

async def main():
    print("=" * 60)
    print("  UltraScrap — Test Run")
    print("=" * 60)

    urls = [
        "https://en.wikipedia.org/wiki/Python_(programming_language)",
        "https://en.wikipedia.org/wiki/Web_scraping",
        "https://en.wikipedia.org/wiki/Artificial_intelligence",
    ]

    print(f"\nTarget URLs: {len(urls)}")
    for u in urls:
        print(f"  → {u}")

    print("\nStarting scraper engine...")
    scraper = UltraScraper(max_concurrency=2, data_type="auto")
    await scraper.start()
    print("Engine started ✓\n")

    success = 0
    failed  = 0

    async for result in scraper.scrape_many(urls):
        print(f"{'='*60}")
        print(f"URL     : {result.url}")
        print(f"Status  : {result.status.value}")
        print(f"HTTP    : {result.http_code}")
        print(f"Time    : {result.duration_ms}ms")

        if result.error:
            print(f"ERROR   : {result.error}")
            failed += 1
            continue

        success += 1
        data = result.data

        print(f"Title   : {data.get('title', 'N/A')}")

        text_blocks = data.get('data', {}).get('text', [])
        print(f"Blocks  : {len(text_blocks)} text blocks")
        for block in text_blocks[:3]:
            preview = block['text'][:120].replace('\n', ' ')
            print(f"  [{block['tag']:>3}] {preview}...")

        tables = data.get('data', {}).get('tables', [])
        if tables:
            print(f"Tables  : {len(tables)} found, first has {len(tables[0])} rows")

        prices = data.get('data', {}).get('prices', [])
        if prices:
            print(f"Prices  : {[p['values'][0] for p in prices[:4]]}")

        links = data.get('links', [])
        print(f"Links   : {len(links)} extracted")

        attrs = data.get('data', {}).get('attributes', {})
        if attrs:
            print(f"KV Pairs: {list(attrs.items())[:3]}")

    await scraper.stop()

    print(f"\n{'='*60}")
    print(f"  RESULTS: {success} success  |  {failed} failed")
    print(f"  Rate status: {scraper.rate_status()}")
    print(f"{'='*60}")

if __name__ == "__main__":
    asyncio.run(main())