"""
UltraScrap — Job Manager
In-memory job queue with real-time progress tracking.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

from core.scraper import ScrapeResult, ScrapeStatus, UltraScraper


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    CANCELLED = "cancelled"
    ERROR = "error"


@dataclass
class ScrapingJob:
    id: str
    urls: list[str]
    data_type: str
    max_items: int
    concurrency: int
    status: JobStatus = JobStatus.QUEUED
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    results: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    total: int = 0
    completed: int = 0
    failed: int = 0
    rate_status: dict = field(default_factory=dict)
    proxy_list: list[str] = field(default_factory=list)
    _scraper: UltraScraper | None = field(default=None, repr=False)
    _task: asyncio.Task | None = field(default=None, repr=False)
    _subscribers: list[Callable] = field(default_factory=list, repr=False)

    def subscribe(self, callback: Callable) -> None:
        self._subscribers.append(callback)

    async def _notify(self, event: dict) -> None:
        for cb in self._subscribers:
            try:
                await cb(event)
            except Exception:
                pass

    def to_dict(self) -> dict:
        elapsed = 0.0
        if self.started_at:
            end = self.finished_at or time.time()
            elapsed = round(end - self.started_at, 1)

        return {
            "id": self.id,
            "status": self.status.value,
            "urls": self.urls,
            "data_type": self.data_type,
            "total": self.total,
            "completed": self.completed,
            "failed": self.failed,
            "progress_pct": round((self.completed + self.failed) / max(1, self.total) * 100, 1),
            "created_at": self.created_at,
            "started_at": self.started_at,
            "elapsed_sec": elapsed,
            "results_count": len(self.results),
            "rate_status": self.rate_status,
            "sample_results": self.results[:3],
        }

    async def run(self) -> None:
        self.status = JobStatus.RUNNING
        self.started_at = time.time()
        self.total = min(len(self.urls), self.max_items)
        urls_to_process = self.urls[:self.max_items]

        await self._notify({"event": "start", "job": self.to_dict()})

        self._scraper = UltraScraper(
            proxy_list=self.proxy_list,
            max_concurrency=self.concurrency,
            data_type=self.data_type,
        )
        await self._scraper.start()

        try:
            async for result in self._scraper.scrape_many(urls_to_process):
                if self.status == JobStatus.CANCELLED:
                    break
                if result.status == ScrapeStatus.DONE:
                    self.completed += 1
                    self.results.append(result.to_dict())
                else:
                    self.failed += 1
                    self.errors.append({"url": result.url, "error": result.error, "code": result.http_code})

                self.rate_status = self._scraper.rate_status()

                await self._notify({
                    "event": "progress",
                    "job_id": self.id,
                    "completed": self.completed,
                    "failed": self.failed,
                    "total": self.total,
                    "progress_pct": round((self.completed + self.failed) / self.total * 100, 1),
                    "latest_url": result.url,
                    "latest_status": result.status.value,
                    "rate_status": self.rate_status,
                    "sample": result.to_dict() if result.status == ScrapeStatus.DONE else None,
                })

        finally:
            await self._scraper.stop()
            self.finished_at = time.time()
            if self.status != JobStatus.CANCELLED:
                self.status = JobStatus.DONE
            await self._notify({"event": "done", "job": self.to_dict()})


class JobManager:
    """Central registry for all scraping jobs."""

    def __init__(self):
        self._jobs: dict[str, ScrapingJob] = {}

    def create_job(
        self,
        urls: list[str],
        data_type: str = "auto",
        max_items: int = 100,
        concurrency: int = 3,
        proxy_list: list[str] | None = None,
    ) -> ScrapingJob:
        job_id = str(uuid.uuid4())
        job = ScrapingJob(
            id=job_id,
            urls=urls,
            data_type=data_type,
            max_items=max_items,
            concurrency=concurrency,
            proxy_list=proxy_list or [],
        )
        self._jobs[job_id] = job
        return job

    def get_job(self, job_id: str) -> ScrapingJob | None:
        return self._jobs.get(job_id)

    def list_jobs(self) -> list[dict]:
        return [j.to_dict() for j in reversed(list(self._jobs.values()))]

    def start_job(self, job_id: str) -> asyncio.Task | None:
        job = self._jobs.get(job_id)
        if not job or job.status not in (JobStatus.QUEUED,):
            return None
        task = asyncio.create_task(job.run())
        job._task = task
        return task

    def cancel_job(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if not job:
            return False
        job.status = JobStatus.CANCELLED
        if job._task:
            job._task.cancel()
        return True

    def get_results(self, job_id: str, limit: int = 100, offset: int = 0) -> dict[str, Any]:
        job = self._jobs.get(job_id)
        if not job:
            return {}
        return {
            "job_id": job_id,
            "total_results": len(job.results),
            "results": job.results[offset : offset + limit],
            "errors": job.errors[:20],
        }
