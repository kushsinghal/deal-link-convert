"""Iteration 10: deal votes, per-store affiliate chains, store support data, source fail streak."""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv('/app/frontend/.env')
load_dotenv('/app/backend/.env')
BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api/public"
DEAL = 'test-vote-deal-0001'
DESIDIME_SRC = '192d818a-af2a-4c13-a73b-4b46aa03fae2'
assert os.environ['DB_NAME'] == 'dealloot_preview'
db = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
PASSWORD = 'RadheKrishna@#12'


@pytest.fixture(scope='module')
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={'password': PASSWORD}, timeout=20)
    if r.status_code != 200:
        pytest.skip('admin login failed')
    s.headers['Authorization'] = f"Bearer {r.json()['token']}"
    yield s
    # always reset chains
    s.put(f"{API}/settings", json={'affiliate_chains': {}}, timeout=20)


def vote(v, voter):
    return requests.post(f"{API}/deals/{DEAL}/vote", json={'vote': v, 'voter': voter}, timeout=20)


# ---- Votes ----
class TestVotes:
    def test_vote_cycle(self):
        voter = 'TESTvoter' + uuid.uuid4().hex[:16]
        base = db.deals.find_one({'id': DEAL})
        u0, d0 = base.get('votes_up', 0), base.get('votes_down', 0)
        r = vote('up', voter); assert r.status_code == 200, r.text
        j = r.json(); assert j == {'votes_up': u0 + 1, 'votes_down': d0, 'mine': 'up'}
        r = vote('up', voter); assert r.json()['votes_up'] == u0 + 1  # idempotent
        r = vote('down', voter); j = r.json()
        assert (j['votes_up'], j['votes_down'], j['mine']) == (u0, d0 + 1, 'down')
        r = vote('none', voter); j = r.json()
        assert (j['votes_up'], j['votes_down'], j['mine']) == (u0, d0, 'none')
        doc = db.deals.find_one({'id': DEAL})
        assert doc['vote_score'] == base.get('vote_score', 0)

    def test_invalid_vote(self):
        assert vote('maybe', 'TESTvoter' + uuid.uuid4().hex[:16]).status_code == 400

    def test_invalid_voter(self):
        assert vote('up', 'short').status_code == 400
        assert vote('up', 'x' * 65).status_code == 400

    def test_unknown_deal(self):
        r = requests.post(f"{API}/deals/nope-deal-xyz/vote", json={'vote': 'up', 'voter': 'TESTvoter' + uuid.uuid4().hex[:16]}, timeout=20)
        assert r.status_code == 404

    def test_public_list_has_counts_and_top_sort(self):
        r = requests.get(f"{API}/deals", params={'sort': 'top'}, timeout=20)
        assert r.status_code == 200
        rows = r.json()
        d = next(x for x in rows if x['id'] == DEAL)
        assert 'votes_up' in d and 'votes_down' in d
        scores = [x.get('vote_score') or 0 for x in rows]
        assert scores == sorted(scores, reverse=True)


# ---- Affiliate chains ----
class TestChains:
    def test_save_chain_persists(self, admin):
        r = admin.put(f"{API}/settings", json={'affiliate_chains': {'Flipkart': ['earnkaro', 'extrape']}}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()['affiliate_chains'] == {'Flipkart': ['earnkaro', 'extrape']}
        g = admin.get(f"{API}/settings", timeout=20).json()
        assert g['affiliate_chains']['Flipkart'] == ['earnkaro', 'extrape']

    @pytest.mark.parametrize('bad', [['extrape', 'extrape'], ['foo'], ['original', 'extrape'], ['extrape', 'earnkaro', 'sankmo', 'extrape']])
    def test_invalid_chain(self, admin, bad):
        r = admin.put(f"{API}/settings", json={'affiliate_chains': {'Flipkart': bad}}, timeout=20)
        assert r.status_code == 400, (bad, r.text)

    def test_chain_must_be_object(self, admin):
        assert admin.put(f"{API}/settings", json={'affiliate_chains': ['x']}, timeout=20).status_code == 400

    def test_store_support_not_writable(self, admin):
        admin.put(f"{API}/settings", json={'store_support': {'running': True}}, timeout=20)
        assert admin.get(f"{API}/settings", timeout=20).json().get('store_support', {}).get('running') is not True

    def test_flipkart_falls_back_to_extrape(self, admin):  # 1 ExtraPe call
        admin.put(f"{API}/settings", json={'affiliate_chains': {'Flipkart': ['earnkaro', 'extrape']}}, timeout=20)
        r = admin.post(f"{API}/convert", json={'url': 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4'}, timeout=60)
        assert r.status_code == 200, r.text
        print('flipkart convert', r.json())
        assert 'fkrt.co' in str(r.json())

    def test_myntra_clean_link(self, admin):
        admin.put(f"{API}/settings", json={'affiliate_chains': {'Myntra': ['original']}}, timeout=20)
        r = admin.post(f"{API}/convert", json={'url': 'https://www.myntra.com/men-tshirts?sort=new'}, timeout=60)
        assert r.status_code == 200, r.text
        print('myntra convert', r.json())
        j = r.json()
        assert 'myntr.in' not in str(j)
        assert 'myntra.com/men-tshirts' in str(j)

    def test_chain_only_unconfigured_errors(self, admin):
        admin.put(f"{API}/settings", json={'affiliate_chains': {'Myntra': ['earnkaro']}}, timeout=20)
        r = admin.post(f"{API}/convert", json={'url': 'https://www.myntra.com/men-tshirts'}, timeout=60)
        print('myntra earnkaro-only', r.status_code, r.text[:300])
        assert 'myntr.in' not in r.text

    def test_reset(self, admin):
        r = admin.put(f"{API}/settings", json={'affiliate_chains': {}}, timeout=20)
        assert r.json()['affiliate_chains'] == {}


# ---- Support check / source health ----
class TestHealth:
    def test_support_check_requires_admin(self):
        assert requests.post(f"{API}/affiliate/support-check", timeout=20).status_code == 401

    def test_fail_streak_increments(self, admin):
        before = db.sources.find_one({'id': DESIDIME_SRC}).get('fail_streak', 0)
        for i in range(2):
            r = admin.post(f"{API}/sources/{DESIDIME_SRC}/fetch", timeout=90)
            assert r.status_code == 200, r.text
            print('fetch', r.json())
            assert r.json().get('error')
        after = db.sources.find_one({'id': DESIDIME_SRC}).get('fail_streak', 0)
        assert after == before + 2, (before, after)
