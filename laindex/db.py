from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1


def connect(path: Path | str) -> sqlite3.Connection:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    return db


def migrate(db: sqlite3.Connection, path: Path | str | None = None) -> None:
    version = db.execute("PRAGMA user_version").fetchone()[0]
    if version and version < SCHEMA_VERSION and path:
        backup = Path(path).with_suffix(f".v{version}.bak")
        shutil.copy2(path, backup)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS crawl_runs(id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, stats_json TEXT DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS auctions(
      auction_id TEXT PRIMARY KEY, title TEXT NOT NULL, seller TEXT, location_name TEXT, street_address TEXT, city TEXT, state TEXT, zip TEXT,
      latitude REAL, longitude REAL, url TEXT NOT NULL, close_at TEXT, pickup_start TEXT, pickup_end TEXT, pickup_dates_json TEXT DEFAULT '[]',
      pickup_text_raw TEXT, pickup_parse_confidence REAL DEFAULT 0, buyer_premium_percent REAL, tax_percent REAL, mandatory_fees REAL DEFAULT 0,
      lot_count INTEGER, status TEXT, geography_qualifies INTEGER, pickup_qualifies INTEGER, manual_review INTEGER DEFAULT 0, last_crawled_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pickup_windows(id INTEGER PRIMARY KEY, auction_id TEXT NOT NULL REFERENCES auctions(auction_id), start_at TEXT, end_at TEXT, raw_text TEXT, confidence REAL);
    CREATE TABLE IF NOT EXISTS lots(
      lot_id TEXT PRIMARY KEY, auction_id TEXT NOT NULL REFERENCES auctions(auction_id), lot_number TEXT, title TEXT NOT NULL, description TEXT,
      category TEXT, current_bid REAL, next_bid REAL, reference_price REAL, quantity REAL, condition TEXT, url TEXT NOT NULL, close_at TEXT,
      bid_count INTEGER, pickup_information TEXT, dimensions TEXT, brand TEXT, model TEXT, sku_upc TEXT, crawled_at TEXT NOT NULL,
      estimated_all_in_low REAL, estimated_all_in_high REAL, estimate_confidence REAL, over_budget INTEGER DEFAULT 0,
      interest_score INTEGER DEFAULT 0, deal_score INTEGER DEFAULT 0, rarity_score INTEGER DEFAULT 0, utility_score INTEGER DEFAULT 0,
      confidence_score INTEGER DEFAULT 0, match_reason TEXT, status TEXT DEFAULT 'active', favorite INTEGER DEFAULT 0, feedback TEXT
    );
    CREATE TABLE IF NOT EXISTS lot_images(id INTEGER PRIMARY KEY, lot_id TEXT NOT NULL REFERENCES lots(lot_id), url TEXT NOT NULL, thumbnail_path TEXT, embedding BLOB, UNIQUE(lot_id,url));
    CREATE TABLE IF NOT EXISTS crawl_errors(id INTEGER PRIMARY KEY, run_id INTEGER REFERENCES crawl_runs(id), scope TEXT, source_id TEXT, url TEXT, error_type TEXT, message TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tags(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS lot_tags(lot_id TEXT REFERENCES lots(lot_id), tag_id INTEGER REFERENCES tags(id), PRIMARY KEY(lot_id,tag_id));
    CREATE TABLE IF NOT EXISTS saved_hunts(name TEXT PRIMARY KEY, config_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS changes(id INTEGER PRIMARY KEY, run_id INTEGER REFERENCES crawl_runs(id), entity_type TEXT, entity_id TEXT, change_type TEXT, field TEXT, old_value TEXT, new_value TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS http_cache(url TEXT PRIMARY KEY, body BLOB, content_type TEXT, fetched_at TEXT NOT NULL, etag TEXT, last_modified TEXT);
    CREATE INDEX IF NOT EXISTS idx_auctions_city ON auctions(city);
    CREATE INDEX IF NOT EXISTS idx_auctions_pickup ON auctions(pickup_start,pickup_end);
    CREATE INDEX IF NOT EXISTS idx_lots_auction ON lots(auction_id);
    CREATE INDEX IF NOT EXISTS idx_lots_price ON lots(current_bid,estimated_all_in_high);
    CREATE INDEX IF NOT EXISTS idx_lots_score ON lots(interest_score DESC);
    CREATE INDEX IF NOT EXISTS idx_lots_close ON lots(close_at);
    CREATE VIRTUAL TABLE IF NOT EXISTS lots_fts USING fts5(lot_id UNINDEXED,title,description,brand,model,category,tags);
    PRAGMA user_version=1;
    """)
    db.commit()


def begin_run(db: sqlite3.Connection) -> int:
    return db.execute("INSERT INTO crawl_runs(started_at,status) VALUES(?,?)", (now(), "running")).lastrowid


def now() -> str:
    return datetime.now(UTC).isoformat()


def upsert(db: sqlite3.Connection, table: str, key: str, record: dict[str, Any], run_id: int) -> None:
    old = db.execute(f"SELECT * FROM {table} WHERE {key}=?", (record[key],)).fetchone()
    columns = list(record)
    updates = ",".join(f"{c}=excluded.{c}" for c in columns if c != key)
    db.execute(f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)}) ON CONFLICT({key}) DO UPDATE SET {updates}", tuple(record[c] for c in columns))
    entity = key.removesuffix("_id")
    if old is None:
        db.execute("INSERT INTO changes(run_id,entity_type,entity_id,change_type,created_at) VALUES(?,?,?,?,?)", (run_id, entity, record[key], "NEW", now()))
    else:
        tracked = ("current_bid", "close_at", "pickup_start", "pickup_end", "status")
        for field in tracked:
            if field in record and str(old[field]) != str(record[field]):
                label = "PRICE" if field == "current_bid" else "PICKUP CHANGED" if field.startswith("pickup") else "UPDATED"
                db.execute("INSERT INTO changes(run_id,entity_type,entity_id,change_type,field,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?,?)", (run_id, entity, record[key], label, field, old[field], record[field], now()))


def refresh_fts(db: sqlite3.Connection, lot_id: str) -> None:
    db.execute("DELETE FROM lots_fts WHERE lot_id=?", (lot_id,))
    db.execute("""INSERT INTO lots_fts(lot_id,title,description,brand,model,category,tags)
      SELECT l.lot_id,l.title,coalesce(l.description,''),coalesce(l.brand,''),coalesce(l.model,''),coalesce(l.category,''),
      coalesce(group_concat(t.name,' '),'') FROM lots l LEFT JOIN lot_tags lt ON lt.lot_id=l.lot_id LEFT JOIN tags t ON t.id=lt.tag_id WHERE l.lot_id=? GROUP BY l.lot_id""", (lot_id,))


def search(db: sqlite3.Connection, query: str | None = None, max_all_in: float = 100, min_interest: int = 0, city: str | None = None, category: str | None = None, pickup_date: str | None = None, limit: int = 50) -> Iterable[sqlite3.Row]:
    joins = "JOIN auctions a ON a.auction_id=l.auction_id"
    where = ["l.status='active'", "l.over_budget=0", "coalesce(l.estimated_all_in_high,999999)<=?", "l.interest_score>=?"]
    args: list[Any] = [max_all_in, min_interest]
    if query:
        joins += " JOIN lots_fts f ON f.lot_id=l.lot_id"
        where.append("lots_fts MATCH ?")
        args.append(query)
    if city: where.append("a.city=?"); args.append(city)
    if category: where.append("l.category=?"); args.append(category)
    if pickup_date: where.append("a.pickup_start<=? AND a.pickup_end>=?"); args.extend([pickup_date,pickup_date])
    args.append(limit)
    return db.execute(f"SELECT l.*,a.title auction_title,a.city,a.pickup_start FROM lots l {joins} WHERE {' AND '.join(where)} ORDER BY l.interest_score DESC,l.deal_score DESC LIMIT ?", args)
