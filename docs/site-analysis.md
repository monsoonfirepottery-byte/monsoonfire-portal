# LocalAuctions delivery analysis

## Inspection performed (2026-09-08 UTC)

The initial proof-of-concept attempted direct, read-only requests to the root site and
`/robots.txt` using the explicit `MonsoonFire-LAIndex/0.1` user agent. The execution
environment's outbound CONNECT proxy returned HTTP 403 before a connection reached
LocalAuctions. Consequently, this run could not responsibly establish the site's robots
policy, inspect a live auction, identify its production JSON endpoints, or claim a full
baseline. This is an environment limitation, not evidence that LocalAuctions blocked the
crawler.

The application therefore **fails closed** when it cannot retrieve robots.txt. It does not
guess endpoints, bypass controls, or fabricate live data. `crawl_errors` records the exact
failure. The checked-in JSON fixture is synthetic and is used only for deterministic parser
tests.

## Implemented inspection path

1. Cached HTTP requests honor robots.txt, use a clear configurable user agent, wait between
   requests, conditionally revalidate cached content, and retry transient failures with
   exponential backoff.
2. `crawl --browser` launches a persistent Playwright Chromium profile, waits for network
   idle, and saves public XHR/fetch JSON metadata to `laindex-data/last-network.json`.
3. Embedded JSON-LD, application JSON, and Next.js state are inspected recursively for lot
   collections. Public auction links are discovered from rendered anchors.
4. The profile and network captures are ignored by git. A user may initialize a legitimate
   session with `crawl --browser --headed --auction-url URL`; CAPTCHA or authentication must
   be completed manually and is never bypassed.

## Required live proof follow-up

Run from a network permitted to reach LocalAuctions:

```bash
python -m laindex crawl --browser --headed --auction-url 'PUBLIC_AUCTION_URL' --limit 1 --verbose
python -m laindex stats
python -m laindex report
```

Review `last-network.json` without committing cookies or tokens. Once an observed endpoint
and its pagination contract are documented, add a typed direct-JSON adapter and a fixture
captured with personal data removed. Verify the site's current terms and robots policy
before a catalog-wide crawl. Do not report that every lot was captured until the API's
reported count and all unique persisted lot IDs agree.
