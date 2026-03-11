# UltraScrap — Architecture & Documentation

> Industry-grade adaptive web scraping platform. Pure-code intelligence — no LLM in the core loop.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                      │
│  Target Input → Job Config → Live Dashboard → Data Preview   │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP + WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                    FASTAPI BACKEND                           │
│  /api/jobs  /api/discover  /ws/{job_id}                     │
└──────┬──────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────┐
│                      JOB MANAGER                             │
│  Creates, tracks, and streams scraping jobs                  │
└──────┬──────────────────────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────┐
│                    ULTRASCRAP CORE ENGINE                     │
│                                                              │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │  URL Discovery  │  │  Session Manager │                  │
│  │  ─────────────  │  │  ──────────────  │                  │
│  │  URL → resolved │  │  Per-identity    │                  │
│  │  URLs list      │  │  browser context │                  │
│  └────────┬────────┘  └────────┬─────────┘                  │
│           │                    │                             │
│  ┌────────▼────────────────────▼─────────┐                  │
│  │           PLAYWRIGHT BROWSER          │                  │
│  │  Stealth profiles, init scripts       │                  │
│  │  Real Chrome fingerprint              │                  │
│  └───────────────────┬───────────────────┘                  │
│                      │                                       │
│  ┌───────────────────▼───────────────────┐                  │
│  │       BEHAVIORAL SIMULATOR            │                  │
│  │  Bézier mouse, human scroll,          │                  │
│  │  variable typing, random pauses       │                  │
│  └───────────────────┬───────────────────┘                  │
│                      │                                       │
│  ┌───────────────────▼───────────────────┐                  │
│  │      UNIVERSAL CONTENT EXTRACTOR      │                  │
│  │  JSON-LD → Semantic HTML → Tables     │                  │
│  │  Prices, Links, Images, KV pairs      │                  │
│  └───────────────────┬───────────────────┘                  │
│                      │                                       │
│  ┌───────────────────▼───────────────────┐                  │
│  │        AIMD + PID RATE CONTROLLER     │                  │
│  │  Per-domain concurrency adjustment    │                  │
│  │  Additive increase, multiplicative    │                  │
│  │  decrease on error signals            │                  │
│  └───────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. Rate Controller (AIMD + PID)
The most important component. Inspired by TCP congestion control:

- **Additive Increase**: On success, concurrency += 0.5 per cycle
- **Multiplicative Decrease**: On 429/403/503, concurrency ×= 0.5
- **PID Smoothing**: Proportional-Integral-Derivative loop targets exactly 2% error rate
- **Per-domain**: Each website has its own rate controller instance

### 2. Behavioral Simulator
Pure math — no AI:
- Mouse paths: Cubic Bézier curves with variable velocity
- Scroll: Acceleration/deceleration, random upscrolls (reading simulation)
- Typing: Random inter-key delays, rare typo + backspace correction

### 3. Session Manager
- Per-session browser contexts with full fingerprint isolation
- Stealth init scripts: removes `navigator.webdriver`, fakes plugins/languages
- Cookie and localStorage persistence across requests in same session
- Multiple fingerprint profiles (Windows Chrome, Mac Chrome, Firefox Linux)

### 4. Universal Content Extractor
Priority-ordered extraction strategy:
1. **JSON-LD** structured data (highest quality)
2. **Semantic HTML** — `<article>`, `<main>`, headings, paragraphs
3. **Tables** — auto-detected, especially Wikipedia-style
4. **Prices** — regex heuristics across `[class*="price"]` elements
5. **Key-Value pairs** — definition lists, infobox th/td pairs
6. **Links & Images** — with base URL resolution

### 5. URL Discovery
Converts natural language to URL lists:
- `wikipedia python` → Wikipedia API search → article URLs
- `github.com/…` → crawls seed and collects internal links
- `pypi django` → PyPI search URL
- `npm react` → NPM search URL
- Direct URLs → seed crawl

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | Python 3.11 + FastAPI | Async-native, Playwright integration |
| Browser Automation | Playwright | Multi-browser, CDP access, stealth |
| Frontend | React 18 + Vite | Fast HMR, lightweight |
| Real-time | WebSocket (FastAPI native) | Push job events to UI |
| HTML Parsing | BeautifulSoup4 + lxml | Fast, robust |
| HTTP Client | httpx | Async, HTTP/2 support |
| Styling | Custom CSS + Google Fonts | No framework bloat |

---

## Project Scope

UltraScrap is designed for:
- Public websites that allow scraping (check robots.txt)
- Research, archival, and educational use
- Sites you own or have permission to scrape
- Data that is publicly accessible

---

## Configuration (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_PORT` | `8000` | Backend port |
| `DEFAULT_CONCURRENCY` | `3` | Starting concurrency |
| `MAX_CONCURRENCY` | `20` | Hard ceiling |
| `REQUEST_DELAY_MIN` | `1.0` | Min delay between requests (s) |
| `REQUEST_DELAY_MAX` | `3.5` | Max delay between requests (s) |
| `AIMD_DECREASE_FACTOR` | `0.5` | Rate cut on error (50%) |
| `TARGET_ERROR_RATE` | `0.02` | PID target (2%) |
| `PROXY_LIST` | _(blank)_ | Comma-separated proxy URLs |

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/discover` | POST | Resolve target to URL list |
| `/api/jobs/create` | POST | Create a scraping job |
| `/api/jobs/{id}/start` | POST | Start a queued job |
| `/api/jobs/{id}/cancel` | POST | Cancel running job |
| `/api/jobs/{id}` | GET | Get job status |
| `/api/jobs/{id}/results` | GET | Get scraped data |
| `/api/jobs` | GET | List all jobs |
| `/api/quick-scrape` | POST | Synchronous single URL scrape |
| `/ws/{job_id}` | WS | Real-time job events |

---

## WebSocket Events

```json
{ "event": "start",    "job": { ... } }
{ "event": "progress", "completed": 5, "failed": 0, "total": 20, "progress_pct": 25.0, "rate_status": { ... } }
{ "event": "done",     "job": { ... } }
{ "event": "ping" }
```
