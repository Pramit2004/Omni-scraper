"""
UltraScrap — FastAPI Backend
WebSocket-powered real-time scraping API.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

# Add backend dir to path
sys.path.insert(0, str(Path(__file__).parent))

from core.discovery import URLDiscovery
from core.jobs import JobManager
from core.scraper import UltraScraper

# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="UltraScrap API",
    description="Industry-grade adaptive web scraping platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

job_manager = JobManager()
ws_clients: dict[str, list[WebSocket]] = {}


# ── Request Models ────────────────────────────────────────────────────────────

class ScrapeRequest(BaseModel):
    target: str                        # URL or natural language
    data_type: str = "auto"            # auto | text | table | links | images
    max_items: int = 50
    concurrency: int = 3
    proxy_list: list[str] = []


class JobIdRequest(BaseModel):
    job_id: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def broadcast(job_id: str, event: dict) -> None:
    clients = ws_clients.get(job_id, [])
    dead = []
    for ws in clients:
        try:
            await ws.send_text(json.dumps(event))
        except Exception:
            dead.append(ws)
    for d in dead:
        clients.remove(d)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": time.time()}


@app.post("/api/discover")
async def discover_urls(req: ScrapeRequest):
    """Resolve target to a list of URLs before scraping."""
    urls = await URLDiscovery.resolve(req.target, limit=req.max_items)
    return {
        "target": req.target,
        "urls": urls,
        "count": len(urls),
    }


@app.post("/api/jobs/create")
async def create_job(req: ScrapeRequest):
    """Create a scraping job and return the job ID."""
    urls = await URLDiscovery.resolve(req.target, limit=req.max_items)
    if not urls:
        return {"error": "Could not resolve any URLs from target"}

    job = job_manager.create_job(
        urls=urls,
        data_type=req.data_type,
        max_items=req.max_items,
        concurrency=min(req.concurrency, 15),
        proxy_list=req.proxy_list,
    )
    return {"job_id": job.id, "urls": urls, "count": len(urls)}


@app.post("/api/jobs/{job_id}/start")
async def start_job(job_id: str):
    """Start a queued job."""
    job = job_manager.get_job(job_id)
    if not job:
        return {"error": "Job not found"}

    # Subscribe the broadcast function
    async def on_event(event: dict):
        await broadcast(job_id, event)

    job.subscribe(on_event)
    task = job_manager.start_job(job_id)
    if not task:
        return {"error": "Could not start job"}
    return {"status": "started", "job_id": job_id}


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    ok = job_manager.cancel_job(job_id)
    return {"cancelled": ok}


@app.get("/api/jobs")
async def list_jobs():
    return {"jobs": job_manager.list_jobs()}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    job = job_manager.get_job(job_id)
    if not job:
        return {"error": "Not found"}
    return job.to_dict()


@app.get("/api/jobs/{job_id}/results")
async def get_results(job_id: str, limit: int = 50, offset: int = 0):
    return job_manager.get_results(job_id, limit=limit, offset=offset)


@app.post("/api/quick-scrape")
async def quick_scrape(req: ScrapeRequest):
    """Synchronous single-URL scrape for preview."""
    urls = await URLDiscovery.resolve(req.target, limit=1)
    if not urls:
        return {"error": "Could not resolve URL"}

    scraper = UltraScraper(data_type=req.data_type)
    await scraper.start()
    try:
        result = await scraper.scrape_url(urls[0])
        return result.to_dict()
    finally:
        await scraper.stop()


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/{job_id}")
async def websocket_endpoint(websocket: WebSocket, job_id: str):
    await websocket.accept()
    ws_clients.setdefault(job_id, []).append(websocket)

    # Send current job state immediately
    job = job_manager.get_job(job_id)
    if job:
        await websocket.send_text(json.dumps({"event": "state", "job": job.to_dict()}))

    try:
        while True:
            # Keep connection alive
            await asyncio.sleep(1)
            await websocket.send_text(json.dumps({"event": "ping"}))
    except WebSocketDisconnect:
        if job_id in ws_clients and websocket in ws_clients[job_id]:
            ws_clients[job_id].remove(websocket)


# ── Static frontend ───────────────────────────────────────────────────────────

frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")


# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("APP_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, log_level="info")
