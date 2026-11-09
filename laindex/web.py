from pathlib import Path
from html import escape
from fastapi import FastAPI, Form
from fastapi.responses import HTMLResponse, RedirectResponse

from laindex.config import Config
from laindex.db import connect, migrate, search

CSS = "body{font:16px system-ui;max-width:1200px;margin:auto;padding:2rem;background:#f3eee5;color:#24211d}nav a{margin-right:1rem}form{display:flex;gap:.5rem;flex-wrap:wrap;margin:2rem 0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem}.card{background:white;padding:1rem;border-radius:12px;box-shadow:0 2px 12px #0001}.score{font-size:1.4rem;font-weight:700}a{color:#8b3e22}"


def create_app(config_path: Path | str = "config.yaml") -> FastAPI:
    cfg = Config.load(config_path); app = FastAPI(title="LAIndex")
    def db(): connection=connect(cfg.database); migrate(connection,cfg.database); return connection
    @app.get("/",response_class=HTMLResponse)
    def dashboard(q: str="", hunt: str="", city: str="", max_all_in: float=100, min_interest: int=0):
        connection=db(); query=q or ("door OR lockset OR deadbolt OR handleset" if hunt=="door" else "kiln OR pottery OR ceramic OR pugmill" if hunt=="pottery" else None)
        rows=list(search(connection,query,max_all_in,min_interest,city or None)); connection.close()
        cards="".join(f'<article class="card"><div class="score">{r["interest_score"]}/100</div><h2>{escape(r["title"])}</h2><p>${r["current_bid"] or 0:.2f} bid · ~${r["estimated_all_in_high"] or 0:.2f} all-in</p><p>{escape(r["city"] or "Unknown city")} · {escape(r["pickup_start"] or "Pickup review needed")}</p><p>{escape(r["match_reason"] or "General match")}</p><a href="{escape(r["url"],quote=True)}" target="_blank" rel="noopener">Open lot</a><form method="post" action="/feedback/{escape(r["lot_id"],quote=True)}"><button name="action" value="favorite">Favorite</button><button name="action" value="ignore">Ignore</button><button name="action" value="interesting">Mark interesting</button><button name="action" value="too_expensive">Too expensive</button></form></article>' for r in rows)
        return f'<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>LAIndex</title><style>{CSS}</style></head><body><h1>Arizona Auction Index</h1><nav><a href="/">Top Finds</a><a href="/?hunt=pottery">Pottery / Studio</a><a href="/?hunt=door">Door Hardware</a><a href="/changes">Changes</a></nav><form><input name="q" value="{q}" placeholder="Search lots"><input name="city" value="{city}" placeholder="City"><input type="number" name="max_all_in" value="{max_all_in}"><input type="number" name="min_interest" value="{min_interest}"><button>Search</button></form><main class="grid">{cards or "<p>No indexed matches yet. Run a crawl.</p>"}</main></body></html>'
    @app.get("/changes",response_class=HTMLResponse)
    def changes_page():
        connection=db(); rows=connection.execute("SELECT * FROM changes ORDER BY id DESC LIMIT 200").fetchall(); connection.close()
        return f'<html><head><style>{CSS}</style></head><body><a href="/">← Dashboard</a><h1>Changes Since Crawls</h1>' + "".join(f'<div class="card"><b>{r["change_type"]}</b> {r["entity_type"]} {r["entity_id"]}: {r["old_value"] or ""} → {r["new_value"] or ""}</div>' for r in rows) + '</body></html>'
    @app.post("/feedback/{lot_id}")
    def feedback(lot_id: str, action: str=Form(...)):
        connection=db(); connection.execute("UPDATE lots SET feedback=?,favorite=? WHERE lot_id=?",(action,action=="favorite",lot_id)); connection.commit(); connection.close(); return RedirectResponse("/",303)
    return app
