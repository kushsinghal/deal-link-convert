"""Deal fetching: cron tick auth, auto_publish setting, published public deals, manual drafts, unpublish."""
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

BASE_URL = dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL'].rstrip('/')
BENV = dotenv_values('/app/backend/.env')
API = BASE_URL + '/api/public'


@pytest.fixture(scope='module')
def admin():
    pw = re.search(r'Existing preview password: `([^`]+)`', Path('/app/memory/test_credentials.md').read_text()).group(1)
    s = requests.Session()
    r = s.post(API + '/auth/login', json={'password': pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip('admin login failed')
    s.headers['Authorization'] = 'Bearer ' + r.json()['token']
    return s


@pytest.fixture(scope='module')
def created():
    ids = []
    yield ids


# Public deals feed
def test_public_deals_published():
    r = requests.get(API + '/deals', params={'limit': 500}, timeout=40)
    assert r.status_code == 200
    deals = r.json()
    print('public deals:', len(deals))
    assert len(deals) >= 50
    assert all('_id' not in d for d in deals)
    assert all(d.get('publication_status', 'published') == 'published' for d in deals)
    stats = requests.get(API + '/stats', timeout=30).json()
    print('stats', stats)
    assert stats['total'] >= 50


# Cron tick auth + async ack
def test_cron_tick_unauthorized():
    r = requests.post(API + '/cron/tick', timeout=30)
    assert r.status_code == 401
    r = requests.post(API + '/cron/tick', headers={'Authorization': 'Bearer TEST_wrong'}, timeout=30)
    assert r.status_code == 401


def test_cron_tick_authorized_fast_ack():
    before = requests.get(API + '/stats', timeout=30).json()['total']
    t = time.time()
    r = requests.post(API + '/cron/tick', headers={'Authorization': 'Bearer ' + BENV['WEBHOOK_CRON_SECRET']}, timeout=30)
    elapsed = time.time() - t
    print('tick', r.status_code, r.text[:300], f'{elapsed:.2f}s')
    assert r.status_code == 202
    assert r.json().get('queued') is True
    assert elapsed < 10
    # second tick while running should still ack quickly
    r2 = requests.post(API + '/cron/tick', headers={'Authorization': 'Bearer ' + BENV['WEBHOOK_CRON_SECRET']}, timeout=30)
    print('tick2', r2.status_code, r2.text[:300])
    assert r2.status_code == 202
    time.sleep(60)
    after = requests.get(API + '/stats', timeout=30).json()['total']
    print('before/after', before, after)
    assert after >= before - 5  # 24h window may age-out a few


# auto_publish setting persistence
def test_auto_publish_setting_toggle(admin):
    s = admin.get(API + '/settings', timeout=30).json()
    assert s['auto_publish'] is True
    r = admin.put(API + '/settings', json={'auto_publish': False}, timeout=30)
    assert r.status_code == 200, r.text
    try:
        assert admin.get(API + '/settings', timeout=30).json()['auto_publish'] is False
    finally:
        r = admin.put(API + '/settings', json={'auto_publish': True}, timeout=30)
        assert r.status_code == 200
    assert admin.get(API + '/settings', timeout=30).json()['auto_publish'] is True


# Manual deals stay drafts; then publish/unpublish via review
def test_manual_deal_is_draft_and_unpublish(admin, created):
    url = f'https://example.org/TEST_manual_{uuid.uuid4().hex[:8]}'
    r = admin.post(API + '/deals', json={'url': url, 'title': 'TEST_manual draft deal fixture', 'price': 99, 'post_now': False}, timeout=60)
    assert r.status_code == 200, r.text
    deal = r.json()['deal']
    created.append(deal['id'])
    try:
        assert deal['publication_status'] == 'draft'
        assert not any(d['id'] == deal['id'] for d in requests.get(API + '/deals', params={'limit': 500}, timeout=40).json())
        advice = 'TEST_ Compare final price, seller warranty and return conditions before buying. This fixture is not a real offer.'
        r = admin.put(API + f"/deals/{deal['id']}/review", json={'title': deal['title'], 'editorial_note': advice, 'publish': True, 'review_confirmed': True}, timeout=30)
        assert r.status_code == 200, r.text
        assert any(d['id'] == deal['id'] for d in requests.get(API + '/deals', params={'limit': 500}, timeout=40).json())
        r = admin.put(API + f"/deals/{deal['id']}/review", json={'title': deal['title'], 'editorial_note': advice, 'publish': False}, timeout=30)
        assert r.status_code == 200
        assert not any(d['id'] == deal['id'] for d in requests.get(API + '/deals', params={'limit': 500}, timeout=40).json())
    finally:
        assert admin.delete(API + f"/deals/{deal['id']}", timeout=30).status_code == 200


# Sources list with errors
def test_sources_list(admin):
    src = admin.get(API + '/sources', timeout=30).json()
    print('sources', len(src))
    for s in src:
        err = s.get('last_error') or s.get('error') or ''
        if err:
            print(' ERR', s.get('name'), '|', str(err)[:120])
    assert len(src) >= 35
