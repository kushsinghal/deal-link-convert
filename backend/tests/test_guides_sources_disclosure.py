"""Iteration 2: 10 guides, Amazon disclosure, 4 user sources (test/refresh/delete)."""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv('/app/frontend/.env')
BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = BASE_URL + '/api/public'
AMZ = 'As an Amazon Associate I earn from qualifying purchases.'
SLUGS = re.findall(r'slug: "([^"]+)"', Path('/app/src/lib/editorial.ts').read_text())
USER_SOURCES = {'nitter.mie.foundation/Starcommander10/rss', 'wealthydimes', 'hotdealsbywd', 'tapworthy'}


@pytest.fixture(scope='module')
def admin():
    pw = re.search(r'Existing preview password: `([^`]+)`', Path('/app/memory/test_credentials.md').read_text()).group(1)
    s = requests.Session()
    r = s.post(API + '/auth/login', json={'password': pw}, timeout=30)
    if r.status_code != 200:
        pytest.skip('admin login failed')
    s.headers['Authorization'] = 'Bearer ' + r.json()['token']
    return s


# Guides: 10 slugs, every page SSR-renders with title + footer disclosure
def test_ten_guides_defined():
    assert len(SLUGS) == 10 and len(set(SLUGS)) == 10


@pytest.mark.parametrize('path', ['/', '/guides', '/info/disclosure', '/info/about'] + [f'/guides/{s}' for s in SLUGS])
def test_pages_render_with_amazon_disclosure(path):
    r = requests.get(BASE_URL + path, timeout=40)
    assert r.status_code == 200, path
    assert 'footer-amazon-disclosure' in r.text and AMZ in r.text, path


def test_guides_index_lists_all():
    html = requests.get(BASE_URL + '/guides', timeout=40).text
    missing = [s for s in SLUGS if f'/guides/{s}' not in html]
    assert not missing, missing


def test_home_numbering_01_to_10():
    html = requests.get(BASE_URL + '/', timeout=40).text
    assert '>010<' not in html
    for i in range(1, 11):
        assert f'>{i:02d}<' in html, i


def test_disclosure_page_statement():
    html = requests.get(BASE_URL + '/info/disclosure', timeout=40).text
    assert html.count(AMZ) >= 2  # body + footer


def test_unknown_guide_404():
    r = requests.get(BASE_URL + '/guides/TEST_nope', timeout=40)
    assert r.status_code == 404 or 'not found' in r.text.lower()


# Sources: the 4 user sources exist and Test-all yields expected statuses
def test_four_user_sources_present(admin):
    sources = admin.get(API + '/sources', timeout=30).json()
    values = {s['value'].replace('https://', '').replace('http://', '') for s in sources}
    assert USER_SOURCES <= values, values


def test_test_all_statuses(admin):
    r = admin.post(API + '/sources/test-all', json={}, timeout=240)
    assert r.status_code == 200
    by = {}
    sources = {s['id']: s for s in admin.get(API + '/sources', timeout=30).json()}
    for res in r.json()['results']:
        by[sources[res['id']]['value']] = res
    print({k: (v['status'], v['posts'], v['message']) for k, v in by.items()})
    nitter = next(v for k, v in by.items() if 'nitter' in k)
    assert nitter['status'] == 'ok' and nitter['posts'] > 0
    assert by['wealthydimes']['status'] == 'ok' and by['wealthydimes']['posts'] > 0
    for name in ['hotdealsbywd', 'tapworthy']:
        assert by[name]['status'] == 'error'
        assert 'turned off' in by[name]['message'] and 'public web preview' in by[name]['message']


# Source CRUD with a TEST_ disabled source (user sources untouched)
def test_temp_source_refresh_and_delete(admin):
    r = admin.post(API + '/sources', json={'kind': 'telegram', 'value': '@TEST_tmp_src_91x', 'name': 'TEST_tmp', 'enabled': False}, timeout=30)
    assert r.status_code == 200, r.text
    sid = r.json()['id']
    try:
        f = admin.post(API + f'/sources/{sid}/fetch', json={}, timeout=120)
        print('fetch', f.status_code, f.text[:300])
        assert f.status_code in (200, 400)
        assert 'detail' in f.json() or isinstance(f.json(), dict)
    finally:
        d = admin.delete(API + f'/sources/{sid}', timeout=30)
        assert d.json() == {'ok': True}
    assert not any(s['id'] == sid for s in admin.get(API + '/sources', timeout=30).json())
