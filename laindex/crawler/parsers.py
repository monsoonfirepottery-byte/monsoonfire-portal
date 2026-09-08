from __future__ import annotations

import json
import re
from typing import Any, Iterator
from urllib.parse import urljoin

from bs4 import BeautifulSoup


def embedded_json(html: str) -> list[Any]:
    soup = BeautifulSoup(html, "html.parser")
    values = []
    for script in soup.select('script[type="application/ld+json"], script[type="application/json"], script#__NEXT_DATA__'):
        try:
            values.append(json.loads(script.string or script.get_text()))
        except (json.JSONDecodeError, TypeError):
            continue
    return values


def walk(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def discover_links(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    links = []
    for anchor in soup.select("a[href]"):
        href = urljoin(base_url, anchor["href"])
        if re.search(r"auction|event", href, re.I) and href not in links:
            links.append(href)
    return links


def lot_candidates(payloads: list[Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for payload in payloads:
        for item in walk(payload):
            identifier = item.get("lotId") or item.get("lot_id") or (item.get("id") if any(k in item for k in ("currentBid", "lotNumber", "bidCount")) else None)
            title = item.get("title") or item.get("name")
            if identifier is not None and title and str(identifier) not in seen:
                seen.add(str(identifier)); result.append(item)
    return result
