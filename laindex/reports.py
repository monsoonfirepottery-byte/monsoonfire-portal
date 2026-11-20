from __future__ import annotations

import csv
from pathlib import Path


def _csv(path: Path, rows, columns):
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns); writer.writeheader()
        for row in rows: writer.writerow({column: row[column] for column in columns})


def generate(db, output: Path = Path("laindex-data/reports")) -> Path:
    output.mkdir(parents=True, exist_ok=True)
    metrics = {
        "Arizona auctions discovered": db.execute("SELECT count(*) FROM auctions WHERE state IN ('AZ','Arizona')").fetchone()[0],
        "Qualifying by geography": db.execute("SELECT count(*) FROM auctions WHERE geography_qualifies=1").fetchone()[0],
        "Qualifying by pickup date": db.execute("SELECT count(*) FROM auctions WHERE pickup_qualifies=1").fetchone()[0],
        "Total lots indexed": db.execute("SELECT count(*) FROM lots").fetchone()[0],
        "Lots estimated under $100 all-in": db.execute("SELECT count(*) FROM lots WHERE estimated_all_in_high<=100").fetchone()[0],
        "Pottery/studio hits": db.execute("SELECT count(*) FROM lots_fts WHERE lots_fts MATCH 'kiln OR pottery OR ceramic OR pugmill'").fetchone()[0],
        "Electronics/test-equipment hits": db.execute("SELECT count(*) FROM lots_fts WHERE lots_fts MATCH 'oscilloscope OR multimeter OR server OR electronics'").fetchone()[0],
        "Door-hardware hits": db.execute("SELECT count(*) FROM lots_fts WHERE lots_fts MATCH 'door OR lockset OR deadbolt OR handleset'").fetchone()[0],
        "Crawl failures": db.execute("SELECT count(*) FROM crawl_errors").fetchone()[0],
        "Requiring manual review": db.execute("SELECT count(*) FROM auctions WHERE manual_review=1").fetchone()[0],
    }
    summary = output / "baseline-summary.md"
    summary.write_text("# LocalAuctions baseline summary\n\n" + "\n".join(f"- **{k}:** {v}" for k,v in metrics.items()) + "\n")
    auction_cols = ["auction_id","title","city","pickup_start","pickup_end","url"]
    _csv(output/"qualifying-auctions.csv", db.execute("SELECT * FROM auctions WHERE geography_qualifies=1 AND pickup_qualifies=1"), auction_cols)
    lot_cols = ["interest_score","current_bid","estimated_all_in_high","title","match_reason","url"]
    _csv(output/"top-finds.csv", db.execute("SELECT * FROM lots WHERE over_budget=0 ORDER BY interest_score DESC LIMIT 100"), lot_cols)
    _csv(output/"door-hardware-hits.csv", db.execute("SELECT l.* FROM lots l JOIN lots_fts f ON f.lot_id=l.lot_id WHERE lots_fts MATCH 'door OR lockset OR deadbolt OR handleset'"), lot_cols)
    error_cols = ["scope","source_id","url","error_type","message","created_at"]
    _csv(output/"crawl-errors.csv", db.execute("SELECT * FROM crawl_errors"), error_cols)
    return summary
