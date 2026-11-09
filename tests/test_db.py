from laindex.db import begin_run, connect, migrate, now, refresh_fts, search, upsert


def test_upsert_diff_dedup_and_fts(tmp_path):
    db=connect(tmp_path/"index.db"); migrate(db,tmp_path/"index.db"); run=begin_run(db)
    auction={"auction_id":"a1","title":"Tools","city":"Glendale","state":"AZ","url":"https://example.test/a1","pickup_start":"2026-09-10","pickup_end":"2026-09-10","last_crawled_at":now()}
    upsert(db,"auctions","auction_id",auction,run)
    lot={"lot_id":"a1-1","auction_id":"a1","title":"Fluke multimeter","description":"test gear","current_bid":10,"url":"https://example.test/l1","crawled_at":now(),"estimated_all_in_high":13,"over_budget":0,"interest_score":80}
    upsert(db,"lots","lot_id",lot,run); refresh_fts(db,"a1-1")
    lot["current_bid"]=12; upsert(db,"lots","lot_id",lot,run); db.commit()
    assert db.execute("select count(*) from lots").fetchone()[0] == 1
    assert db.execute("select count(*) from changes where change_type='PRICE'").fetchone()[0] == 1
    assert list(search(db,"Fluke"))[0]["lot_id"] == "a1-1"
