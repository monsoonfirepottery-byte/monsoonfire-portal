from __future__ import annotations

import json
from pathlib import Path


async def inspect_page(url: str, profile: Path, headed: bool = False) -> tuple[str, list[dict]]:
    """Capture public JSON responses; never attempts challenge or access-control bypass."""
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise RuntimeError("Install browser support: pip install -e '.[browser]' && playwright install chromium") from exc
    profile.mkdir(parents=True, exist_ok=True)
    captured: list[dict] = []
    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(profile, headless=not headed)
        page = context.pages[0]

        async def response_received(response):
            content_type = response.headers.get("content-type", "")
            if "json" in content_type and response.request.resource_type in {"xhr", "fetch"}:
                try:
                    captured.append({"url": response.url, "method": response.request.method, "status": response.status, "body": await response.json()})
                except Exception:
                    pass

        page.on("response", response_received)
        await page.goto(url, wait_until="networkidle", timeout=90_000)
        html = await page.content()
        await context.close()
    return html, captured


def save_inspection(path: Path, responses: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(responses, indent=2))
