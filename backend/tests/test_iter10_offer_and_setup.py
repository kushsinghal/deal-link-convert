"""Iteration 10: offer category, OFFER_STORES non-conversion, admin subtabs,
cron auth, vote endpoint and public listing hygiene (preview URL only)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://try-it-now-80--6otlj0ca.preview.emergentagent.com").rstrip("/")
ADMIN_PW = "RadheKrishna@#12"
OFFER_STORES = ["Paytm", "Swiggy", "Zomato", "Woohoo", "Gyftr"]


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/public/auth/login", json={"password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


# --- auth ---

def test_login_wrong_password_rejected():
    r = requests.post(f"{BASE_URL}/api/public/auth/login", json={"password": "wrong"}, timeout=15)
    assert r.status_code == 401
    assert "wrong" in r.text.lower() or "password" in r.text.lower()


# --- public listings hygiene ---

def test_public_deals_excludes_drafts_and_hides_source():
    r = requests.get(f"{BASE_URL}/api/public/deals?limit=20", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    for d in data:
        assert d.get("publication_status") in (None, "published")
        # source fields should not be exposed on public listing
        for k in ("source", "source_id", "source_post_url"):
            assert k not in d or d[k] is None, f"public listing leaked {k}: {d.get(k)}"


def test_offer_category_filter_returns_only_offers():
    r = requests.get(f"{BASE_URL}/api/public/deals?category=offer&limit=50", timeout=15)
    assert r.status_code == 200
    data = r.json()
    for d in data:
        assert "offer" in (d.get("categories") or []), f"non-offer leaked: {d.get('categories')}"


def test_default_listing_excludes_offer_category():
    r = requests.get(f"{BASE_URL}/api/public/deals?limit=50", timeout=15)
    assert r.status_code == 200
    for d in r.json():
        cats = d.get("categories") or []
        assert "offer" not in cats, f"offer deal leaked into default listing: {d['id']}"


# --- settings/configuration flags ---

def test_bot_tweets_default_off(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/public/settings", timeout=15)
    assert r.status_code == 200
    s = r.json()
    assert s.get("bot_tweets_enabled") is False or s.get("bot_tweets_enabled") in (None, False)
    assert s.get("converter_order") == ["extrape", "earnkaro", "sankmo"]
    # ExtraPe is backend-managed in preview
    assert s.get("extrape_managed") is True


def test_sources_count(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/public/sources", timeout=15)
    assert r.status_code == 200
    srcs = r.json()
    assert isinstance(srcs, list)
    assert len(srcs) == 38, f"expected 38 sources, got {len(srcs)}"


# --- engine / converter behaviour ---

@pytest.mark.parametrize("url", [
    "https://www.zomato.com/pizza-offer",
    "https://www.swiggy.com/restaurants",
    "https://paytm.com/offers",
    "https://www.woohoo.in/gift-cards",
    "https://gyftr.com/amazon-voucher",
])
def test_offer_store_not_converted(admin_client, url):
    r = admin_client.post(f"{BASE_URL}/api/public/convert", json={"url": url}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("store") in OFFER_STORES
    assert d.get("changed") is False
    # affiliate url should equal cleaned (no conversion)
    assert d.get("converted") == d.get("cleaned")


def test_amazon_actionable_not_supported(admin_client):
    r = admin_client.post(f"{BASE_URL}/api/public/convert",
                          json={"url": "https://www.amazon.in/dp/B0D4J1M4R9"}, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d.get("store") == "Amazon"
    assert d.get("changed") is False
    assert d.get("error")  # actionable message
    assert "amazon" in d["error"].lower()


def test_myntra_converts_via_extrape(admin_client):
    r = admin_client.post(f"{BASE_URL}/api/public/convert",
                          json={"url": "https://www.myntra.com/men-tshirts"}, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d.get("changed") is True
    assert "myntr.in/" in d.get("converted", "")


# --- cron auth ---

def test_cron_tick_rejects_missing_bearer():
    r = requests.post(f"{BASE_URL}/api/public/cron/tick", json={}, timeout=15)
    assert r.status_code == 401


def test_cron_tick_rejects_wrong_bearer():
    r = requests.post(f"{BASE_URL}/api/public/cron/tick", json={},
                      headers={"Authorization": "Bearer definitely-wrong"}, timeout=15)
    assert r.status_code == 401


# --- vote endpoint ---

def _test_deal_id():
    r = requests.get(f"{BASE_URL}/api/public/deals?limit=1", timeout=15)
    data = r.json()
    if not data:
        pytest.skip("no published deals in preview")
    return data[0]["id"]


def test_vote_rejects_invalid_payload():
    did = _test_deal_id()
    r = requests.post(f"{BASE_URL}/api/public/deals/{did}/vote",
                      json={"vote": "bad", "voter": "abcdef0123456789-TEST"}, timeout=15)
    assert r.status_code == 400
    assert "up" in r.text and "down" in r.text


def test_vote_rejects_short_voter():
    did = _test_deal_id()
    r = requests.post(f"{BASE_URL}/api/public/deals/{did}/vote",
                      json={"vote": "up", "voter": "short"}, timeout=15)
    assert r.status_code == 400


def test_vote_accepts_valid_and_resets():
    did = _test_deal_id()
    voter = "abcdef0123456789-ITER10"
    r = requests.post(f"{BASE_URL}/api/public/deals/{did}/vote",
                      json={"vote": "up", "voter": voter}, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("mine") == "up"
    # reset to none to not pollute counters
    r2 = requests.post(f"{BASE_URL}/api/public/deals/{did}/vote",
                       json={"vote": "none", "voter": voter}, timeout=15)
    assert r2.status_code == 200
    assert r2.json().get("mine") == "none"
