import json
from pathlib import Path
from laindex.crawler.parsers import embedded_json, lot_candidates


def test_fixture_embedded_json_finds_all_lots():
    fixture=Path(__file__).parent/"fixtures/auction.json"
    html=f'<script type="application/json">{fixture.read_text()}</script>'
    payloads=embedded_json(html)
    lots=lot_candidates(payloads)
    assert [lot["lotId"] for lot in lots] == ["184"]
