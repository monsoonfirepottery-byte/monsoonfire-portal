# LAIndex

LAIndex is a local-first Python/SQLite index for publicly visible LocalAuctions Arizona
auctions. It keeps over-budget records while hiding them by default, stores crawl diffs,
uses FTS5, and includes interest and dedicated black round door-hardware ranking. It is a
separate tool and does not alter the Portal application.

> Live endpoint discovery was blocked by this build environment's outbound proxy. See
> [the honest site analysis](docs/site-analysis.md). The crawler must be validated against
> one public auction before a broad crawl.

## Install and initialize

Python 3.12 or newer is required.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test,browser]'
playwright install chromium
python -m laindex init
```

Edit `config.yaml`, especially the contact portion of the user agent, pickup window, tax
fallback, city lists, and longitude. Runtime databases, thumbnails, browser profiles, HTTP
cache, and session state live under ignored `laindex-data/`. Never commit that directory.

## Crawl and search

```bash
python -m laindex crawl --auction-url 'https://localauctions.com/…' --browser --limit 1
python -m laindex crawl --pickup-start 2026-09-10 --pickup-end 2026-09-12
python -m laindex search kiln
python -m laindex search 'door handle' --city Glendale --max-all-in 100
python -m laindex search --category pottery --min-interest 70
python -m laindex search --pickup-date 2026-09-10
python -m laindex hunt door-hardware
python -m laindex hunt pottery
python -m laindex top
python -m laindex auctions
python -m laindex changes
python -m laindex stats
python -m laindex report
python -m laindex serve
```

The local UI is then available at `http://127.0.0.1:8765`. HTTP mode refuses to crawl if
robots.txt cannot be verified. Browser mode is headless unless `--headed` is supplied and
uses `laindex-data/browser-profile`. It captures public JSON traffic only; it does not defeat
login, CAPTCHA, rate limits, or other access controls.

## Data behavior and caveats

- Database migrations are incremental through SQLite `user_version`; an existing database
  is copied to a versioned backup before a future migration. The baseline is never deleted.
- Auction and lot IDs are primary keys, so re-crawls update rather than duplicate. Changes
  to bids, closes, pickups, and statuses are appended to `changes`.
- Unknown pickup dates remain available for manual review rather than being silently
  rejected. Default results omit over-budget lots and use the **high** all-in estimate.
- Tax uncertainty yields low/high estimates and reduced confidence. Auction terms must be
  checked before bidding.
- Thumbnail URLs and an embedding column are schema-ready; image download/CLIP inference is
  deliberately optional and not yet part of the MVP.
- Current generic embedded-JSON parsing needs validation against live payloads. Dynamic API
  pagination cannot be claimed complete until the blocked inspection is performed.
