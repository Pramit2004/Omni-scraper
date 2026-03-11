"""
╔══════════════════════════════════════════════════════════╗
║  OMNI-SCRAPER v2 — FastAPI Backend                      ║
║  Live progress · Chunk saves · Sample preview           ║
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
load_dotenv(override=True)

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import structlog

from backend.core.llm_router import LLMRouter, LLMProvider
from backend.control.aimd_controller import AdaptiveRateController
from backend.cognition.agent_loop import OmniAgent, load_all_chunks

log = structlog.get_logger()

app = FastAPI(title="Omni-Scraper API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"], allow_credentials=False)

rate_ctrl   = AdaptiveRateController(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
active_jobs: dict[str, dict] = {}
ws_clients:  dict[str, list[WebSocket]] = {}


@app.on_event("startup")
async def startup():
    try:
        await rate_ctrl.connect()
    except Exception:
        log.warning("redis_unavailable")


@app.get("/")
async def root():
    return {"status": "ok", "service": "omni-scraper", "version": "2.0.0"}

@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Models ────────────────────────────────────────────────────────────────────

class ScrapeRequest(BaseModel):
    url:            str
    goal:           str
    llm_provider:   str  = "claude"
    export_format:  str  = "json"
    target_records: int  = 1000
    max_steps:      int  = 200
    headless:       bool = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/providers")
async def list_providers():
    return LLMRouter.list_providers()


@app.post("/api/scrape")
async def start_scrape(req: ScrapeRequest):
    job_id = str(uuid.uuid4())[:8]
    job = {
        "job_id":         job_id,
        "status":         "queued",
        "url":            req.url,
        "goal":           req.goal,
        "provider":       req.llm_provider,
        "target_records": req.target_records,
        "created_at":     datetime.utcnow().isoformat(),
        "steps":          0,
        "records":        0,
        "pages":          0,
        "progress_pct":   0.0,
        "sample_data":    [],
        "events":         [],
        "data":           [],
        "export_format":  req.export_format,
        "error":          None,
        "workers":        1,
    }
    active_jobs[job_id] = job
    ws_clients[job_id]  = []
    asyncio.create_task(_run_scrape_job(job_id, req))
    return {k: v for k, v in job.items() if k not in ("data", "events")}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    job = active_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {k: v for k, v in job.items() if k not in ("data", "events")}


@app.get("/api/jobs/{job_id}/export")
async def export_data(job_id: str, fmt: str = "json"):
    job = active_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    # Load from chunks if available (crash-safe)
    try:
        data = await load_all_chunks(job_id)
    except Exception:
        data = job.get("data", [])

    fmt = fmt or job.get("export_format", "json")

    if fmt == "json":
        content = json.dumps(data, indent=2, ensure_ascii=False)
        media, ext = "application/json", "json"
    elif fmt == "csv":
        buf  = io.StringIO()
        keys = list(data[0].keys()) if data else []
        w    = csv.DictWriter(buf, fieldnames=keys, extrasaction="ignore")
        w.writeheader(); w.writerows(data)
        content, media, ext = buf.getvalue(), "text/csv", "csv"
    elif fmt == "tsv":
        buf  = io.StringIO()
        keys = list(data[0].keys()) if data else []
        w    = csv.DictWriter(buf, fieldnames=keys, extrasaction="ignore", delimiter="\t")
        w.writeheader(); w.writerows(data)
        content, media, ext = buf.getvalue(), "text/tab-separated-values", "tsv"
    else:
        raise HTTPException(400, f"Unknown format: {fmt}")

    fname = "omni_" + job_id + "_" + datetime.utcnow().strftime('%Y%m%d_%H%M%S') + "." + ext
    return StreamingResponse(iter([content]), media_type=media,
        headers={"Content-Disposition": f"attachment; filename={fname}"})


@app.get("/api/metrics")
async def get_metrics():
    return {
        "domains":     rate_ctrl.get_all_metrics(),
        "active_jobs": len([j for j in active_jobs.values() if j["status"] == "running"]),
        "total_jobs":  len(active_jobs),
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/{job_id}")
async def ws_endpoint(websocket: WebSocket, job_id: str):
    await websocket.accept()
    ws_clients.setdefault(job_id, []).append(websocket)

    job = active_jobs.get(job_id)
    if job:
        for ev in job.get("events", [])[-50:]:
            try:
                await websocket.send_json(ev)
            except Exception:
                break
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_clients.get(job_id, []).remove(websocket)


async def _broadcast(job_id: str, event: dict):
    dead = []
    for ws in ws_clients.get(job_id, []):
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ws_clients.get(job_id, []).remove(ws)


# ── Core task ─────────────────────────────────────────────────────────────────

async def _run_scrape_job(job_id: str, req: ScrapeRequest):
    from playwright.async_api import async_playwright
    job = active_jobs[job_id]
    job["status"] = "running"

    async def emit(event: dict):
        event["job_id"]    = job_id
        event["timestamp"] = datetime.utcnow().isoformat()
        job["events"].append(event)

        # Update job state from event
        if event.get("type") == "act":
            job["steps"] += 1
        if event.get("type") == "extract":
            job["records"]      = event.get("total", job["records"])
            job["progress_pct"] = event.get("progress_pct", 0)
            job["pages"]        = event.get("pages", job["pages"])
            # Keep rolling 10 samples
            samples = event.get("sample", [])
            if samples:
                job["sample_data"] = (job["sample_data"] + samples)[-10:]
        if event.get("type") == "scale_info":
            job["workers"] = event.get("workers", 1)
        if event.get("type") == "job_complete":
            job["status"]   = "done"
            job["records"]  = event.get("records", job["records"])
        if event.get("type") == "job_error":
            job["status"] = "error"
            job["error"]  = event.get("error")

        await _broadcast(job_id, event)

    await emit({"type": "job_start", "url": req.url, "goal": req.goal,
                "provider": req.llm_provider, "target": req.target_records})

    try:
        llm   = LLMRouter(provider=LLMProvider(req.llm_provider))
        agent = OmniAgent(llm=llm, rate_ctrl=rate_ctrl)

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=req.headless)
            ctx     = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                locale="en-US", timezone_id="America/New_York",
            )
            page = await ctx.new_page()
            await page.add_init_script(
                "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
                "window.chrome={runtime:{}};"
            )
            await page.goto(req.url, wait_until="domcontentloaded", timeout=30000)
            await emit({"type": "navigate", "status": "ok", "url": req.url})

            from urllib.parse import urlparse
            domain = urlparse(req.url).netloc

            final_state = await agent.run(
                page=page, goal=req.goal, task_id=job_id,
                domain=domain, target_records=req.target_records,
                on_event=emit,
            )

            job["data"]    = final_state.extracted_data
            job["records"] = len(final_state.extracted_data)
            await browser.close()

        await emit({
            "type": "job_complete", "status": final_state.status,
            "records": job["records"], "steps": job["steps"],
            "pages": job["pages"],
        })

    except Exception as e:
        log.exception("job_failed", job_id=job_id)
        await emit({"type": "job_error", "error": str(e)[:300]})