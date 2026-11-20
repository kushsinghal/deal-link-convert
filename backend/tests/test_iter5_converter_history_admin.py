# Iteration 5: converter-logs auth/rendering data, price history label, cron tick, public deal fields
import os, uuid, datetime
import pytest, requests
from pymongo import MongoClient

def _env(path, key):
    for line in open(path):
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _env("/app/frontend/.env", "REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api/public"
CRON = _env("/app/backend/.env", "WEBHOOK_CRON_SECRET")
PASSWORD = "preview123"  # from /app/memory/test_credentials.md


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"password": PASSWORD}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code} {r.text[:200]}")
    d = r.json()
    return d.get("token") or d.get("access_token")


@pytest.fixture(scope="module")
def mdb():
    c = MongoClient(_env("/app/backend/.env", "MONGO_URL"))
    yield c[_env("/app/backend/.env", "DB_NAME")]
    c.close()


# Converter logs: admin-only
def test_converter_logs_requires_admin():
    r = requests.get(f"{API}/converter-logs", timeout=30)
    assert r.status_code == 401


def test_converter_logs_with_admin_and_test_doc(token, mdb):
    lid = "TEST_" + uuid.uuid4().hex
    now = datetime.datetime.utcnow().isoformat() + "Z"
    mdb.converter_logs.insert_one({"id": lid, "store": "Amazon", "original": "https://amzn.to/TEST", "cleaned": "https://www.amazon.in/dp/B0TEST",
                                   "converted": "https://extrape.com/TEST", "status": "converted", "message_at": now, "received_at": "2099-01-01T00:00:00Z",
                                   "replied_at": now, "total_ms": 1234})
    try:
        r = requests.get(f"{API}/converter-logs", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert data[0]["id"] == lid
        assert "_id" not in data[0]
        assert data[0]["total_ms"] == 1234
    finally:
        mdb.converter_logs.delete_one({"id": lid})


def test_converter_logs_bad_limit(token):
    r = requests.get(f"{API}/converter-logs?limit=abc", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    print("limit=abc ->", r.status_code, r.text[:200])
    assert r.status_code == 200


# Price history label
def test_price_history_seen_on_dealloot(mdb):
    deals = [d for d in requests.get(f"{API}/deals?limit=50", timeout=30).json() if d.get("price")]
    if not deals:
        pytest.skip("no priced deals")
    r = requests.get(f"{API}/price-history/{deals[0]['id']}", timeout=30)
    if r.status_code == 404:
        pytest.skip("deal not published")
    assert r.status_code == 200
    names = [s["store"] for s in r.json()["stores"]]
    print(names)
    assert not any("channel" in n.lower() for n in names)
    assert "Seen on DealLoot" in names


# Cron tick
def test_cron_tick_auth():
    assert requests.post(f"{API}/cron/tick", timeout=30).status_code == 401
    r = requests.post(f"{API}/cron/tick", headers={"Authorization": f"Bearer {CRON}"}, timeout=60)
    assert r.status_code == 202


# Social links not stored as public deals
def test_public_deals_no_social_links():
    r = requests.get(f"{API}/deals?limit=500", timeout=60)
    assert r.status_code == 200
    import re
    bad = [d["clean_url"] for d in r.json() if re.search(r"^https?://([^/]*\.)?(whatsapp\.com|wa\.me|nitter\.|x\.com|twitter\.com|instagram\.com|youtube\.com|youtu\.be|t\.me)", d.get("clean_url") or "")]
    print("social deals:", bad)
    assert not bad
