"""
╔══════════════════════════════════════════════════════════╗
║  OMNI-SCRAPER — FastAPI Backend                         ║
║  REST + WebSocket for real-time UI streaming            ║
╚══════════════════════════════════════════════════════════╝
"""

from __future__ import annotations
import asyncio
import json
import uuid
import os
import csv
import io
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv

# Load .env BEFORE anything reads os.getenv()
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import structlog

from backend.core.llm_router import LLMRouter, LLMProvider, MODEL_REGISTRY
from backend.control.aimd_controller import AdaptiveRateController
from backend.cognition.agent_loop import OmniAgent

log = structlog.get_logger()

app = FastAPI(title="Omni-Scraper API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # covers *.app.github.dev + localhost
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

# ── Global singletons ─────────────────────────────────────────────────────────
rate_ctrl  = AdaptiveRateController(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
active_jobs: dict[str, dict] = {}
ws_clients:  dict[str, list[WebSocket]] = {}


@app.on_event("startup")
async def startup():
    try:
        await rate_ctrl.connect()
    except Exception:
        log.warning("redis_not_available_running_without")


# ── Health routes ────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "ok", "service": "omni-scraper", "version": "1.0.0"}

@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Models ────────────────────────────────────────────────────────────────────

class ScrapeRequest(BaseModel):
    url:          str
    goal:         str
    llm_provider: str          = "claude"
    export_format: str         = "json"     # json | csv | tsv
    max_steps:    int          = 25
    headless:     bool         = True


class ScrapeJob(BaseModel):
    job_id:      str
    status:      str
    url:         str
    goal:        str
    provider:    str
    created_at:  str
    steps:       int           = 0
    records:     int           = 0
    error:       Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/providers")
async def list_providers():
    """List all available LLM providers with capability metadata."""
    return LLMRouter.list_providers()


@app.post("/api/scrape", response_model=ScrapeJob)
async def start_scrape(req: ScrapeRequest):
    """Start a scrape job. Returns job_id for WebSocket tracking."""
    job_id = str(uuid.uuid4())[:8]

    job = {
        "job_id":     job_id,
        "status":     "queued",
        "url":        req.url,
        "goal":       req.goal,
        "provider":   req.llm_provider,
        "created_at": datetime.utcnow().isoformat(),
        "steps":      0,
        "records":    0,
        "events":     [],
        "data":       [],
        "export_format": req.export_format,
        "error":      None,
    }
    active_jobs[job_id] = job
    ws_clients[job_id]  = []

    # Launch async task
    asyncio.create_task(_run_scrape_job(job_id, req))

    return ScrapeJob(**{k: v for k, v in job.items() if k in ScrapeJob.model_fields})


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    job = active_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {k: v for k, v in job.items() if k != "data"}


@app.get("/api/jobs")
async def list_jobs():
    return [
        {k: v for k, v in job.items() if k != "data"}
        for job in active_jobs.values()
    ]


@app.get("/api/jobs/{job_id}/export")
async def export_data(job_id: str, fmt: str = "json"):
    job = active_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    data = job.get("data", [])
    fmt  = fmt or job.get("export_format", "json")

    if fmt == "json":
        content = json.dumps(data, indent=2, ensure_ascii=False)
        media   = "application/json"
        ext     = "json"

    elif fmt == "csv":
        if not data:
            content = ""
        else:
            buf = io.StringIO()
            keys = list(data[0].keys()) if data else []
            writer = csv.DictWriter(buf, fieldnames=keys, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(data)
            content = buf.getvalue()
        media = "text/csv"
        ext   = "csv"

    elif fmt == "tsv":
        if not data:
            content = ""
        else:
            buf = io.StringIO()
            keys = list(data[0].keys()) if data else []
            writer = csv.DictWriter(buf, fieldnames=keys, extrasaction="ignore", delimiter="\t")
            writer.writeheader()
            writer.writerows(data)
            content = buf.getvalue()
        media = "text/tab-separated-values"
        ext   = "tsv"

    else:
        raise HTTPException(400, f"Unsupported format: {fmt}")

    filename = f"omni_scraper_{job_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.{ext}"
    return StreamingResponse(
        iter([content]),
        media_type=media,
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/api/metrics")
async def get_metrics():
    return {
        "domains": rate_ctrl.get_all_metrics(),
        "active_jobs": len([j for j in active_jobs.values() if j["status"] == "running"]),
        "total_jobs": len(active_jobs),
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    await websocket.accept()

    if job_id not in ws_clients:
        ws_clients[job_id] = []
    ws_clients[job_id].append(websocket)

    # Send existing events immediately (for reconnects)
    job = active_jobs.get(job_id)
    if job:
        for event in job.get("events", []):
            try:
                await websocket.send_json(event)
            except Exception:
                break

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if job_id in ws_clients and websocket in ws_clients[job_id]:
            ws_clients[job_id].remove(websocket)


async def _broadcast(job_id: str, event: dict):
    """Send event to all connected WebSocket clients for this job."""
    clients = ws_clients.get(job_id, [])
    dead = []
    for ws in clients:
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.remove(ws)


# ── Core scrape task ──────────────────────────────────────────────────────────

async def _run_scrape_job(job_id: str, req: ScrapeRequest):
    from playwright.async_api import async_playwright
    job = active_jobs[job_id]
    job["status"] = "running"

    async def emit(event: dict):
        """Stream event to UI."""
        event["job_id"]    = job_id
        event["timestamp"] = datetime.utcnow().isoformat()
        job["events"].append(event)
        await _broadcast(job_id, event)

        # Update job counters
        if event.get("type") == "act":
            job["steps"] += 1
        if event.get("type") == "extract":
            job["records"] = event.get("records", job["records"])

    await emit({"type": "job_start", "url": req.url, "goal": req.goal, "provider": req.llm_provider})

    try:
        llm   = LLMRouter(provider=LLMProvider(req.llm_provider))
        agent = OmniAgent(llm=llm, rate_ctrl=rate_ctrl)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=req.headless)
            context = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                locale="en-US",
                timezone_id="America/New_York",
            )
            page = await context.new_page()

            # Stealth basics
            await page.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                window.chrome = {runtime: {}};
            """)

            await page.goto(req.url, wait_until="domcontentloaded", timeout=30000)
            await emit({"type": "navigate", "status": "ok", "url": req.url})

            from urllib.parse import urlparse
            domain = urlparse(req.url).netloc

            final_state = await agent.run(
                page=page,
                goal=req.goal,
                task_id=job_id,
                domain=domain,
                on_event=emit,
            )

            job["data"]    = final_state.extracted_data
            job["status"]  = final_state.status
            job["records"] = len(final_state.extracted_data)

            await browser.close()

        await emit({
            "type":    "job_complete",
            "status":  job["status"],
            "records": job["records"],
            "steps":   job["steps"],
        })

    except Exception as e:
        job["status"] = "error"
        job["error"]  = str(e)
        log.exception("scrape_job_failed", job_id=job_id)
        await emit({"type": "job_error", "error": str(e)})