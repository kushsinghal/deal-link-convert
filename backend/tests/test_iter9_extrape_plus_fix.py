# Iteration 9: ExtraPe '+' in query fix (Myntra/Ajio short links), regression Flipkart + bulk
import os, re, json, pytest, requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api/public"
MYNTRA_PLUS = "https://www.myntra.com/men-tshirts?f=Brand%3ALee+Cooper&sort=new"
AJIO_PLUS = "https://www.ajio.com/men-jeans/c/830216013?query=%3Arelevance%3Abrand%3ALee+Cooper%3Agenderfilter%3AMen"
FLIPKART = "https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4"
MYNTRA_PLAIN = "https://www.myntra.com/men-tshirts?sort=new"
SHORT_RE = re.compile(r"^https?://(myntr\.in|ajiio\.co|fkrt\.co|[\w.-]+)/[A-Za-z0-9_-]+$")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    r = sess.post(f"{API}/auth/login", json={"password": "RadheKrishna@#12"}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"login failed {r.status_code}")
    sess.headers["Authorization"] = f"Bearer {r.json()['token']}"
    return sess


def convert(s, url):
    r = s.post(f"{API}/convert", json={"url": url}, timeout=60)
    print("CONVERT", url, r.status_code, r.text[:500])
    assert r.status_code == 200, r.text
    d = r.json()
    out = d if isinstance(d, str) else (d.get("converted") or d.get("url") or d.get("affiliate_url") or d.get("link"))
    assert isinstance(out, str), d
    return out, d


def target(url):
    r = requests.get(url, allow_redirects=False, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
    loc = r.headers.get("location", "")
    print("REDIRECT", url, r.status_code, loc[:400])
    return r.status_code, loc


def check_short(out, host):
    assert host in out, out
    rest = out.split("://", 1)[1]
    assert not re.search(r"[+:|]", rest), out
    assert SHORT_RE.match(out), out


def test_myntra_plus(s):
    out, _ = convert(s, MYNTRA_PLUS)
    check_short(out, "myntr.in")
    code, loc = target(out)
    assert code in (301, 302, 303, 307, 308)
    assert "Lee%20Cooper" in loc and "sort=new" in loc, loc


def test_ajio_plus(s):
    out, _ = convert(s, AJIO_PLUS)
    check_short(out, "ajiio.co")
    code, loc = target(out)
    assert code in (301, 302, 303, 307, 308)
    # ajiio.co redirects via ajiotrk.vibconnect.in tracker; the real target is its (encoded) `url` param
    import urllib.parse as up
    qs = up.parse_qs(up.urlparse(loc).query)
    tgt = qs["url"][0] if "url" in qs else loc
    print("AJIO TARGET", tgt)
    assert tgt.startswith("https://www.ajio.com/men-jeans/c/830216013"), tgt
    assert "Lee%20Cooper" in tgt and "genderfilter" in tgt, tgt


def test_flipkart_regression(s):
    out, _ = convert(s, FLIPKART)
    assert "fkrt.co" in out, out


def test_myntra_plain_regression(s):
    out, _ = convert(s, MYNTRA_PLAIN)
    check_short(out, "myntr.in")
    code, loc = target(out)
    assert code in (301, 302, 303, 307, 308)
    assert "sort=new" in loc and "men-tshirts" in loc, loc


def test_bulk(s):
    text = f"Lee Cooper tees {MYNTRA_PLUS}\nJeans {AJIO_PLUS}\niPhone {FLIPKART}\nTees {MYNTRA_PLAIN}"
    r = s.post(f"{API}/convert/bulk", json={"text": text, "base": BASE_URL}, timeout=180)
    print("BULK", r.status_code, r.text[:3000])
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 4
    for it in items:
        print("ITEM", it.get("original"), "->", it.get("converted"), it.get("changed"), it.get("error"), it.get("save_error"))
        assert it.get("changed"), it
        conv = it["converted"]
        assert not re.search(r"[+:|]", conv.split("://", 1)[1]), conv
        assert any(h in conv for h in ("myntr.in", "ajiio.co", "fkrt.co")), conv
