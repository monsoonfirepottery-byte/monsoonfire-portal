from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

from laindex.config import Config


class RespectfulClient:
    def __init__(self, config: Config, db):
        self.config, self.db = config, db
        self.client = httpx.AsyncClient(headers={"User-Agent": config.user_agent}, follow_redirects=True, timeout=30)
        self._last_request = 0.0
        self._robots: dict[str, RobotFileParser] = {}

    async def close(self):
        await self.client.aclose()

    async def _allowed(self, url: str) -> bool:
        parsed = urlparse(url); origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self._robots:
            robots_url = urljoin(origin, "/robots.txt")
            response = await self.client.get(robots_url)
            if response.status_code >= 400:
                raise RuntimeError(f"Cannot verify robots policy: {robots_url} returned HTTP {response.status_code}")
            robot = RobotFileParser(); robot.set_url(robots_url); robot.parse(response.text.splitlines()); self._robots[origin] = robot
        return self._robots[origin].can_fetch(self.config.user_agent, url)

    async def get(self, url: str, force: bool = False) -> tuple[bytes, str]:
        cached = self.db.execute("SELECT * FROM http_cache WHERE url=?", (url,)).fetchone()
        if cached and not force and datetime.fromisoformat(cached["fetched_at"]) > datetime.now(UTC) - timedelta(hours=self.config.cache_ttl_hours):
            return cached["body"], cached["content_type"] or ""
        if not await self._allowed(url):
            raise RuntimeError(f"robots.txt disallows {url}")
        await asyncio.sleep(self.config.request_delay_seconds)
        headers = {}
        if cached and cached["etag"]: headers["If-None-Match"] = cached["etag"]
        if cached and cached["last_modified"]: headers["If-Modified-Since"] = cached["last_modified"]
        last_error = None
        for attempt in range(4):
            try:
                response = await self.client.get(url, headers=headers)
                if response.status_code == 304 and cached: return cached["body"], cached["content_type"] or ""
                if response.status_code in {429, 500, 502, 503, 504}:
                    retry = response.headers.get("retry-after")
                    await asyncio.sleep(float(retry) if retry and retry.isdigit() else 2 ** attempt)
                    continue
                response.raise_for_status()
                self.db.execute("INSERT INTO http_cache(url,body,content_type,fetched_at,etag,last_modified) VALUES(?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET body=excluded.body,content_type=excluded.content_type,fetched_at=excluded.fetched_at,etag=excluded.etag,last_modified=excluded.last_modified", (url,response.content,response.headers.get("content-type"),datetime.now(UTC).isoformat(),response.headers.get("etag"),response.headers.get("last-modified")))
                self.db.commit(); return response.content, response.headers.get("content-type", "")
            except httpx.HTTPError as exc:
                last_error = exc; await asyncio.sleep(2 ** attempt)
        raise RuntimeError(f"Fetch failed after retries: {last_error}")
