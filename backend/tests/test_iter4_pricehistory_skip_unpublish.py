"""Iteration 4: price_history on auto-publish, unpublish w/ short title, skip OOS/expired posts on ingest, cron regression."""
import os
import re
import time
import uuid
from datetime import datetime, timezone, timedelta
from email.utils import format_datetime
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

BASE_URL = dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL'].rstrip('/')
BENV = dotenv_values('/app/backend/.env')
API = BASE_URL + '/api/public'
MDB = MongoClient(BENV.get('MONGO_URL') or 'mongodb://localhost:27017')['dealloot_preview']


@pytest.fixture(scope='module')
def admin():
    pw = re.search(r'Existing preview password: `([^`]+)`', Path('/app/memory/test_credentials.md').read_text()).group(1)
    s = requests.Session()
    r = s.post(API + '/auth/login', json={'password': pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip('admin login failed')
    s.headers['Authorization'] = 'Bearer ' + r.json()['token']
    return s


# Price history: every published priced deal has a price_history row; API returns "Seen in deal channels"
def test_price_history_backfilled_and_api():
    ids = set(MDB.price_history.distinct('deal_id'))
    priced = list(MDB.deals.find({'publication_status': 'published', 'product_key': {'$nin': [None, '']}, 'price': {'$gt': 0}}, {'_id': 0, 'id': 1}))
    missing = [d['id'] for d in priced if d['id'] not in ids]
    print('priced published', len(priced), 'missing history', len(missing))
    assert priced and not missing
    deal_id = priced[0]['id']
    r = requests.get(API + f'/price-history/{deal_id}', timeout=60)
    assert r.status_code == 200, r.text
    stores = r.json().get('stores', [])
    print('stores', [s['store'] for s in stores])
    seen = [s for s in stores if s['store'] == 'Seen in deal channels']
    assert seen and len(seen[0]['points']) >= 1


# Unpublish works with a short title (publish:false bypasses title validation)
def test_unpublish_short_title(admin):
    url = f'https://example.org/TEST_short_{uuid.uuid4().hex[:8]}'
    r = admin.post(API + '/deals', json={'url': url, 'title': 'TEST_ok title fixture', 'price': 49, 'post_now': False}, timeout=60)
    assert r.status_code == 200, r.text
    deal = r.json()['deal']
    try:
        advice = 'TEST_ Compare final price, seller warranty and return conditions before buying. This fixture is not a real offer.'
        r = admin.put(API + f"/deals/{deal['id']}/review", json={'title': deal['title'], 'editorial_note': advice, 'publish': True, 'review_confirmed': True}, timeout=30)
        assert r.status_code == 200, r.text
        r = admin.put(API + f"/deals/{deal['id']}/review", json={'title': 'TEST', 'editorial_note': advice, 'publish': False}, timeout=30)
        print('unpublish short', r.status_code, r.text[:200])
        assert r.status_code == 200
        doc = MDB.deals.find_one({'id': deal['id']}, {'_id': 0})
        assert doc['publication_status'] == 'draft'
        assert not any(d['id'] == deal['id'] for d in requests.get(API + '/deals', params={'limit': 500}, timeout=40).json())
        # publish with short title must still be rejected
        r = admin.put(API + f"/deals/{deal['id']}/review", json={'title': 'TEST', 'editorial_note': advice, 'publish': True, 'review_confirmed': True}, timeout=30)
        assert r.status_code == 400
        # unpublish with title omitted: check whether title is wiped
        r = admin.put(API + f"/deals/{deal['id']}/review", json={'publish': False}, timeout=30)
        doc = MDB.deals.find_one({'id': deal['id']}, {'_id': 0})
        print('unpublish no-title', r.status_code, 'title now:', repr(doc.get('title')), 'note:', repr(doc.get('editorial_note'))[:40])
    finally:
        assert admin.delete(API + f"/deals/{deal['id']}", timeout=30).status_code == 200


# Ingest skips 'out of stock' / 'sold out' / 'coupon has ended' / 'expired' posts (RSS fixture from /app/public, posted 3h ago so no Telegram auto-post)
def test_ingest_skips_ended_posts(admin):
    tag = uuid.uuid4().hex[:8]
    pub = format_datetime(datetime.now(timezone.utc) - timedelta(hours=3))
    phrases = ['is now OUT OF STOCK', 'Sold Out already', 'coupon has ended', 'offer expired', 'deal has ended']
    items = [(f'skip{i}', f'Loot price error TEST_{tag} gadget 90% off {p} https://example.org/TEST_{tag}_skip{i}') for i, p in enumerate(phrases)]
    items.append(('keep', f'Loot price error TEST_{tag} gadget keep 90% off https://example.org/TEST_{tag}_keep'))
    xml = '<?xml version="1.0"?><rss version="2.0"><channel><title>TEST feed</title><link>https://example.org</link><description>t</description>' + ''.join(
        f'<item><title>Loot TEST_{tag} {k}</title><link>https://example.org/TEST_{tag}_{k}</link><guid>TEST_{tag}_{k}</guid><description>{t}</description><pubDate>{pub}</pubDate></item>' for k, t in items) + '</channel></rss>'
    fname = f'TEST_feed_{tag}.xml'
    path = Path('/app/public') / fname
    path.write_text(xml)
    src_id = None
    try:
        time.sleep(1)
        assert requests.get(f'{BASE_URL}/{fname}', timeout=30).status_code == 200
        r = admin.post(API + '/sources', json={'value': f'{BASE_URL}/{fname}', 'kind': 'rss'}, timeout=60)
        print('add source', r.status_code, r.text[:300])
        assert r.status_code == 200, r.text
        body = r.json()
        src_id = (body.get('source') or body).get('id')
        r = admin.post(API + f'/sources/{src_id}/fetch', timeout=120)
        print('fetch', r.status_code, r.text[:300])
        assert r.status_code == 200
        created = list(MDB.deals.find({'source_id': str(src_id)}, {'_id': 0, 'id': 1, 'title': 1, 'url': 1, 'publication_status': 1}))
        print('created', created)
        urls = ' '.join(d.get('url', '') for d in created)
        assert 'skip' not in urls
        assert len(created) == 1 and 'keep' in urls
        assert created[0]['publication_status'] == 'published'
    finally:
        path.unlink(missing_ok=True)
        if src_id:
            for d in MDB.deals.find({'source_id': str(src_id)}, {'_id': 0, 'id': 1}):
                admin.delete(API + f"/deals/{d['id']}", timeout=30)
                MDB.price_history.delete_many({'deal_id': d['id']})
            admin.delete(API + f'/sources/{src_id}', timeout=30)
            MDB.seen.delete_many({'key': {'$regex': '^' + re.escape(str(src_id)) + ':'}})


# Cron tick regression
def test_cron_tick_auth():
    assert requests.post(API + '/cron/tick', timeout=30).status_code == 401
    r = requests.post(API + '/cron/tick', headers={'Authorization': 'Bearer ' + BENV['WEBHOOK_CRON_SECRET']}, timeout=30)
    print('tick', r.status_code, r.text[:200])
    assert r.status_code == 202


def test_auto_publish_still_on(admin):
    assert admin.get(API + '/settings', timeout=30).json()['auto_publish'] is True
