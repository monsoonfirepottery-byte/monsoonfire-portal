from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from urllib.parse import urlparse

from laindex.config import Config
from laindex.crawler.browser import inspect_page, save_inspection
from laindex.crawler.client import RespectfulClient
from laindex.crawler.parsers import discover_links, embedded_json, lot_candidates
from laindex.db import begin_run, now, refresh_fts, upsert
from laindex.parsing.dates import intersects, parse_pickup_dates
from laindex.parsing.location import qualifies_location
from laindex.parsing.money import estimate_all_in
from laindex.scoring.interests import weighted_score


def _first(item, *keys, default=None):
    for key in keys:
        if item.get(key) is not None: return item[key]
    return default


async def crawl(config: Config, db, auction_url: str | None = None, limit: int | None = None, dry_run: bool = False, headed: bool = False, use_browser: bool = False) -> dict:
    run_id = begin_run(db); db.commit()
    stats = {"discovered": 0, "qualifying": 0, "lots": 0, "errors": 0}
    start_url = auction_url or "https://localauctions.com/auctions"
    client = RespectfulClient(config, db)
    try:
        body, _ = await client.get(start_url)
        html = body.decode(errors="replace")
        responses = []
        if use_browser:
            html, responses = await inspect_page(start_url, Path("laindex-data/browser-profile"), headed)
            save_inspection(Path("laindex-data/last-network.json"), responses)
        urls = [start_url] if auction_url else discover_links(html, start_url)
        if limit: urls = urls[:limit]
        stats["discovered"] = len(urls)
        for url in urls:
            try:
                if url != start_url: html = (await client.get(url))[0].decode(errors="replace")
                payloads = embedded_json(html) + [r["body"] for r in responses if r.get("body")]
                flat = [x for payload in payloads for x in __import__("laindex.crawler.parsers", fromlist=["walk"]).walk(payload)]
                root = next((x for x in flat if x.get("name") or x.get("title")), {})
                text = " ".join(re.sub("<[^>]+>", " ", html).split())
                pickup_match = re.search(r"(?:pickup|loadout).{0,500}", text, re.I)
                pickup = parse_pickup_dates(pickup_match.group() if pickup_match else "", config.pickup.start.year)
                address = root.get("address") if isinstance(root.get("address"), dict) else {}
                city = _first(root, "city", default=address.get("addressLocality")); state = _first(root, "state", default=address.get("addressRegion"))
                longitude = root.get("longitude") or (root.get("geo", {}).get("longitude") if isinstance(root.get("geo"), dict) else None)
                location = qualifies_location(city, state, float(longitude) if longitude else None, config.location)
                pickup_ok = intersects(pickup, config.pickup.start, config.pickup.end)
                auction_id = str(_first(root, "auctionId", "id", default=urlparse(url).path.rstrip("/").split("/")[-1]))
                auction = {"auction_id": auction_id, "title": _first(root,"title","name",default="Unknown auction"), "seller": str(root.get("seller") or "") or None, "location_name": root.get("locationName"), "street_address": address.get("streetAddress"), "city": city, "state": state, "zip": address.get("postalCode"), "latitude": root.get("latitude") or (root.get("geo",{}).get("latitude") if isinstance(root.get("geo"),dict) else None), "longitude": longitude, "url": url, "close_at": _first(root,"endDate","closeDate","closeAt"), "pickup_start": pickup.start.isoformat() if pickup.start else None, "pickup_end": pickup.end.isoformat() if pickup.end else None, "pickup_dates_json": json.dumps([x.isoformat() for x in pickup.dates]), "pickup_text_raw": pickup.raw, "pickup_parse_confidence": pickup.confidence, "buyer_premium_percent": root.get("buyerPremiumPercent"), "tax_percent": root.get("taxPercent"), "mandatory_fees": root.get("mandatoryFees") or 0, "lot_count": _first(root,"lotCount","numberOfLots"), "status": root.get("status"), "geography_qualifies": location.qualifies, "pickup_qualifies": pickup_ok, "manual_review": pickup_ok is None, "last_crawled_at": now()}
                if not dry_run: upsert(db,"auctions","auction_id",auction,run_id)
                if not location.qualifies or pickup_ok is False: continue
                stats["qualifying"] += 1
                candidates = lot_candidates(payloads)
                seen_lots = set()
                for raw in candidates:
                    bid = float(_first(raw,"currentBid","current_bid",default=0) or 0); premium = root.get("buyerPremiumPercent"); tax = root.get("taxPercent")
                    estimate = estimate_all_in(bid, premium, tax, fallback_tax=config.limits.estimated_tax_percent)
                    title = str(_first(raw,"title","name",default="Untitled lot")); desc = str(raw.get("description") or "")
                    score,reasons = weighted_score(f"{title} {desc} {raw.get('category','')}")
                    lot_id = f"{auction_id}-{_first(raw,'lotId','lot_id','id')}"
                    seen_lots.add(lot_id)
                    lot = {"lot_id":lot_id,"auction_id":auction_id,"lot_number":str(_first(raw,"lotNumber","lot_number",default="")),"title":title,"description":desc,"category":raw.get("category"),"current_bid":bid,"next_bid":raw.get("nextBid"),"reference_price":_first(raw,"msrp","retailPrice"),"quantity":raw.get("quantity"),"condition":raw.get("condition"),"url":_first(raw,"url","lotUrl",default=url),"close_at":_first(raw,"closeAt","endDate"),"bid_count":raw.get("bidCount"),"pickup_information":raw.get("pickupInformation"),"dimensions":raw.get("dimensions"),"brand":raw.get("brand"),"model":raw.get("model"),"sku_upc":_first(raw,"sku","upc"),"crawled_at":now(),"estimated_all_in_low":estimate.low,"estimated_all_in_high":estimate.high,"estimate_confidence":estimate.confidence,"over_budget":estimate.high>config.limits.max_all_in,"interest_score":score,"confidence_score":round(estimate.confidence*100),"match_reason":", ".join(reasons),"status":raw.get("status") or "active"}
                    if not dry_run:
                        upsert(db,"lots","lot_id",lot,run_id); refresh_fts(db,lot_id)
                        images = raw.get("images") or raw.get("imageUrls") or []
                        if isinstance(images,str): images=[images]
                        for image in images:
                            image_url = image.get("url") if isinstance(image,dict) else image
                            if image_url: db.execute("INSERT OR IGNORE INTO lot_images(lot_id,url) VALUES(?,?)",(lot_id,image_url))
                    stats["lots"] += 1
                # Removal detection is safe only when the source advertises a complete count.
                reported = _first(root,"lotCount","numberOfLots")
                if not dry_run and reported is not None and int(reported) == len(seen_lots):
                    for old in db.execute("SELECT lot_id FROM lots WHERE auction_id=? AND status='active'",(auction_id,)).fetchall():
                        if old["lot_id"] not in seen_lots:
                            db.execute("UPDATE lots SET status='removed' WHERE lot_id=?",(old["lot_id"],))
                            db.execute("INSERT INTO changes(run_id,entity_type,entity_id,change_type,field,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?,?)",(run_id,"lot",old["lot_id"],"REMOVED","status","active","removed",now()))
            except Exception as exc:
                stats["errors"] += 1
                if not dry_run: db.execute("INSERT INTO crawl_errors(run_id,scope,url,error_type,message,created_at) VALUES(?,?,?,?,?,?)",(run_id,"auction",url,type(exc).__name__,str(exc),now()))
        if not dry_run: db.execute("UPDATE crawl_runs SET finished_at=?,status=?,stats_json=? WHERE id=?",(now(),"complete_with_errors" if stats["errors"] else "complete",json.dumps(stats),run_id)); db.commit()
    except Exception as exc:
        stats["errors"] += 1
        db.execute("INSERT INTO crawl_errors(run_id,scope,url,error_type,message,created_at) VALUES(?,?,?,?,?,?)",(run_id,"discovery",start_url,type(exc).__name__,str(exc),now()))
        db.execute("UPDATE crawl_runs SET finished_at=?,status='failed',stats_json=? WHERE id=?",(now(),json.dumps(stats),run_id)); db.commit()
        raise
    finally:
        await client.close()
    return stats
