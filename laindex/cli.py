from __future__ import annotations

import asyncio
from datetime import date
from pathlib import Path
from typing import Optional

import typer

from laindex.config import Config, PickupConfig
from laindex.crawler.service import crawl as run_crawl
from laindex.db import connect, migrate, search as search_db
from laindex.reports import generate
from laindex.scoring.door_hardware import classify

app = typer.Typer(no_args_is_help=True, help="Persistent local LocalAuctions Arizona index.")


def context(config_path: Path):
    config = Config.load(config_path); db = connect(config.database); migrate(db, config.database); return config, db


def display(rows):
    for row in rows:
        pickup = row["pickup_start"] or "pickup unknown"
        typer.echo(f'{row["interest_score"]:>3} | ${row["current_bid"] or 0:.2f} bid | ~${row["estimated_all_in_high"] or 0:.2f} all-in | {row["city"] or "?"} | {pickup}')
        typer.echo(f'Lot {row["lot_number"] or "?"} — {row["title"]}\nWhy: {row["match_reason"] or "general match"}\nURL: {row["url"]}\n')


@app.command()
def init(config: Path = Path("config.yaml")):
    """Create config and database without overwriting either."""
    if not config.exists(): config.write_text(Path("config.example.yaml").read_text())
    cfg, db = context(config); db.close(); typer.echo(f"Ready: {cfg.database}")


@app.command()
def crawl(config: Path = Path("config.yaml"), pickup_start: Optional[date] = None, pickup_end: Optional[date] = None, auction_id: Optional[str] = None, auction_url: Optional[str] = None, limit: Optional[int] = None, dry_run: bool = False, verbose: bool = False, headed: bool = False, browser: bool = False):
    """Incrementally crawl public pages. Browser mode captures XHR JSON."""
    cfg, db = context(config)
    if pickup_start or pickup_end: cfg.pickup = PickupConfig(start=pickup_start or cfg.pickup.start, end=pickup_end or cfg.pickup.end)
    if auction_id and not auction_url: auction_url = f"https://localauctions.com/auction/{auction_id}"
    try: typer.echo(asyncio.run(run_crawl(cfg, db, auction_url, limit, dry_run, headed, browser)))
    except Exception as exc: typer.echo(f"Crawl failed safely and was recorded: {exc}", err=True); raise typer.Exit(1)
    finally: db.close()


@app.command("search")
def search_command(query: Optional[str] = typer.Argument(None), config: Path = Path("config.yaml"), category: Optional[str] = None, min_interest: int = 0, max_all_in: float = 100, city: Optional[str] = None, pickup_date: Optional[str] = None, limit: int = 50):
    _, db = context(config); display(search_db(db, query, max_all_in, min_interest, city, category, pickup_date, limit)); db.close()


@app.command()
def hunt(name: str, config: Path = Path("config.yaml")):
    cfg, db = context(config)
    if name == "door-hardware":
        rows = list(search_db(db, "door OR lockset OR deadbolt OR handleset", cfg.limits.max_all_in, 0))
        rows.sort(key=lambda row: classify(f'{row["title"]} {row["description"] or ""}')[0], reverse=True); display(rows)
    else: display(search_db(db, "kiln OR pottery OR ceramic OR pugmill OR compressor", cfg.limits.max_all_in, 0))
    db.close()


@app.command()
def top(config: Path = Path("config.yaml")): _, db=context(config); display(search_db(db, max_all_in=Config.load(config).limits.max_all_in,min_interest=0)); db.close()


@app.command()
def auctions(config: Path = Path("config.yaml")):
    _,db=context(config)
    for row in db.execute("SELECT auction_id,title,city,pickup_start,pickup_end,manual_review,url FROM auctions ORDER BY pickup_start"): typer.echo(" | ".join(str(x) for x in row))
    db.close()


@app.command()
def changes(config: Path = Path("config.yaml")):
    _,db=context(config)
    for row in db.execute("SELECT change_type,entity_type,entity_id,field,old_value,new_value FROM changes ORDER BY id DESC LIMIT 200"): typer.echo(" | ".join(str(x or "") for x in row))
    db.close()


@app.command()
def stats(config: Path = Path("config.yaml")):
    cfg,db=context(config)
    for table in ("auctions","lots","crawl_runs","crawl_errors","changes"): typer.echo(f"{table}: {db.execute(f'SELECT count(*) FROM {table}').fetchone()[0]}")
    db.close()


@app.command()
def report(config: Path = Path("config.yaml"), output: Path = Path("laindex-data/reports")):
    _,db=context(config); typer.echo(generate(db,output)); db.close()


@app.command()
def serve(config: Path = Path("config.yaml"), host: str = "127.0.0.1", port: int = 8765):
    import uvicorn
    from laindex.web import create_app
    uvicorn.run(create_app(config), host=host, port=port)


if __name__ == "__main__": app()
