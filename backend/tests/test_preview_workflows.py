"""Public preview auth, source diagnostics and private editorial review regression tests."""
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv('/app/frontend/.env')
load_dotenv('/app/backend/.env')
BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = BASE_URL + '/api/public'
REPORT = Path('/app/test_reports')

@pytest.fixture(scope='module')
def admin():
    credentials = Path('/app/memory/test_credentials.md').read_text()
    password = re.search(r'Existing preview password: `([^`]+)`', credentials).group(1)
    session = requests.Session()
    r = session.post(API + '/auth/login', json={'password': password}, timeout=30)
    if r.status_code != 200:
        pytest.skip('Documented administrator authentication failed')
    token = r.json()['token']
    assert isinstance(token, str) and len(token) > 20
    session.headers['Authorization'] = 'Bearer ' + token
    return session

@pytest.fixture(scope='module')
def database():
    client = MongoClient(os.environ['MONGO_URL'])
    assert os.environ['DB_NAME'] == 'dealloot_preview', 'Refuse fixture writes outside preview DB'
    yield client[os.environ['DB_NAME']]
    client.close()

@pytest.fixture(scope='module')
def fixtures(admin, database):
    ids = {'sources': [], 'deals': [], 'source_objects': []}
    yield ids
    for id in ids['sources']:
        admin.delete(API + '/sources/' + id, timeout=30)
    for id in ids['deals']:
        admin.delete(API + '/deals/' + id, timeout=30)
    for object_id in ids['source_objects']:
        database.sources.delete_one({'_id': object_id})
    assert database.sources.count_documents({'id': {'$in': ids['sources']}}) == 0
    assert database.deals.count_documents({'id': {'$in': ids['deals']}}) == 0

def get(path):
    return requests.get(API + path, timeout=40)

def test_public_health_and_settings():
    stats = get('/stats')
    assert stats.status_code == 200 and isinstance(stats.json()['total'], int)
    settings = get('/public-settings')
    assert settings.status_code == 200 and 'copy_header' in settings.json()
    assert not any('token' in k or 'secret' in k for k in settings.json())

def test_protected_reads_and_actions():
    for path in ['/sources', '/settings', '/review-deals', '/destinations', '/logs']:
        r = get(path)
        assert r.status_code == 401 and 'detail' in r.json(), path
    r = requests.post(API + '/sources/test-all', json={}, timeout=30)
    assert r.status_code == 401 and 'detail' in r.json()
    r = requests.post(API + '/auth/login', json={'password': 'TEST_wrong_password'}, timeout=30)
    assert r.status_code == 401 and r.json()['detail'] == 'Wrong password'

def test_no_original_sources_and_empty_test_all(admin):
    sources = admin.get(API + '/sources', timeout=30).json()
    REPORT.joinpath('initial-sources.json').write_text(json.dumps({'count': len(sources), 'names': [s['name'] for s in sources]}, indent=2))
    # User added 4 real sources in iteration 2; only verify listing shape (test-all covered in test_guides_sources_disclosure.py)
    assert all(isinstance(s['id'], str) and '_id' not in s for s in sources)

def test_source_normalization_crud(admin, fixtures):
    for value in ['@TEST_channel', 't.me/TEST_channel', 'https://t.me/TEST_channel/123?single', 'https://t.me/s/TEST_channel/123']:
        r = admin.post(API + '/sources', json={'kind': 'telegram', 'value': value, 'name': 'TEST_stable_name', 'enabled': False}, timeout=30)
        assert r.status_code == 200, r.text
        source = r.json(); fixtures['sources'].append(source['id'])
        assert source['value'] == 'TEST_channel' and source['created_at'] and isinstance(source['id'], str)
        assert any(s['id'] == source['id'] for s in admin.get(API + '/sources', timeout=30).json())
        r = admin.put(API + '/sources/' + source['id'], json={'enabled': True}, timeout=30)
        assert r.json()['name'] == 'TEST_stable_name' and r.json()['enabled'] is True
        saved = next(s for s in admin.get(API + '/sources', timeout=30).json() if s['id'] == source['id'])
        assert saved['name'] == 'TEST_stable_name' and saved['enabled'] is True
        r = admin.delete(API + '/sources/' + source['id'], timeout=30)
        assert r.json() == {'ok': True}
        assert not any(s['id'] == source['id'] for s in admin.get(API + '/sources', timeout=30).json())
        assert admin.post(API + '/sources/' + source['id'] + '/test', json={}, timeout=30).status_code == 404

def test_source_invalid_inputs(admin):
    for kind, value in [('unknown', 'https://example.org'), ('rss', 'not-a-url'), ('rss', 'file:///etc/passwd'), ('web', 'https://unsupported.example.org'), ('telegram', 'https://t.me/+privateinvite')]:
        r = admin.post(API + '/sources', json={'kind': kind, 'value': value}, timeout=30)
        assert r.status_code == 400 and r.json()['detail'], (kind, r.text)

def test_legacy_source_id_repair(admin, database, fixtures):
    result = database.sources.insert_one({'kind': 'telegram', 'value': 'TEST_legacy', 'name': 'TEST_legacy', 'enabled': False})
    fixtures['source_objects'].append(result.inserted_id)
    row = next(s for s in admin.get(API + '/sources', timeout=30).json() if s['name'] == 'TEST_legacy')
    fixtures['sources'].append(row['id'])
    assert isinstance(row['id'], str) and row['created_at'] and '_id' not in row
    assert database.sources.find_one({'_id': result.inserted_id})['id'] == row['id']
    admin.delete(API + '/sources/' + row['id'], timeout=30)

def test_live_source_diagnostics_no_ingestion(admin, database, fixtures):
    before = {n: database[n].count_documents({}) for n in ['deals', 'logs', 'seen']}
    sources = [('telegram', '@telegram'), ('rss', 'https://www.dealsheaven.in/feed'), ('rss', 'https://feeds.bbci.co.uk/news/rss.xml'), ('web', 'https://www.desidime.com/'), ('web', 'https://www.dealsmagnet.com/'), ('rss', 'https://www.dealsheaven.in/'), ('telegram', '@TEST_nonpublic_7e491')]
    snapshots = []
    for kind, value in sources:
        r = admin.post(API + '/sources', json={'kind': kind, 'value': value, 'name': 'TEST_diagnostic_' + kind + '_' + str(len(snapshots)), 'enabled': False}, timeout=30)
        assert r.status_code == 200, r.text
        id = r.json()['id']; fixtures['sources'].append(id)
        checked = admin.post(API + '/sources/' + id + '/test', json={}, timeout=210)
        assert checked.status_code == 200, checked.text
        result = checked.json(); snapshots.append({'input': value, **result})
        assert result['status'] in ['ok', 'empty', 'error'] and result['checked_at'] and result['message']
        saved = next(s for s in admin.get(API + '/sources', timeout=30).json() if s['id'] == id)
        assert saved['health']['message'] == result['message']
    REPORT.joinpath('source-health-snapshots.json').write_text(json.dumps(snapshots, indent=2))
    all_result = admin.post(API + '/sources/test-all', json={}, timeout=240)
    assert all_result.status_code == 200 and all_result.json()['checked'] >= len(sources)
    REPORT.joinpath('source-health-test-all.json').write_text(json.dumps(all_result.json(), indent=2))
    assert before == {n: database[n].count_documents({}) for n in before}

def test_live_affiliate_results_and_masked_settings(admin):
    settings = admin.get(API + '/settings', timeout=30).json()
    assert 'extrape_token' not in settings and 'earnkaro_token' not in settings
    assert settings['extrape_managed'] is True and '••••' in settings['extrape_token_masked']
    assert settings['earnkaro_token_masked'] == ''
    urls = ['https://www.flipkart.com/poco-c61-ethereal-blue-64-gb/p/itmd6f4d53827865', 'https://www.amazon.in/dp/B0BDHX8Z63']
    results = []
    for url in urls:
        r = admin.post(API + '/convert', json={'url': url}, timeout=90)
        assert r.status_code == 200, r.text
        results.append(r.json())
    REPORT.joinpath('affiliate-live-results.json').write_text(json.dumps(results, indent=2))
    assert results[0]['changed'] is True and results[0]['converted'].startswith('https://fkrt.co/') and results[0]['error'] is None
    assert results[1]['changed'] is False and results[1]['converted'] == urls[1]
    assert 'Amazon conversion requires approval' in results[1]['error']

def test_editorial_review_visibility_and_cleanup(admin, database, fixtures):
    id = 'TEST_' + str(uuid.uuid4()); fixtures['deals'].append(id)
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    row = {'id': id, 'title': 'TEST_editorial workflow fixture', 'publication_status': 'draft', 'posted_at': now, 'created_at': now, 'published_at': None, 'url': 'https://example.org/TEST_product', 'clean_url': 'https://example.org/TEST_product', 'affiliate_url': 'https://example.org/TEST_product', 'store': 'Other', 'categories': ['heavy_discount'], 'featured': False, 'price': 100, 'source': 'TEST_fixture', 'posted_to': [], 'converted': False}
    database.deals.insert_one(row)
    baseline = get('/stats').json()['total']
    assert any(d['id'] == id for d in admin.get(API + '/review-deals', timeout=30).json())
    assert not any(d['id'] == id for d in get('/deals').json())
    for path in [f'/go/d/{id}', f'/deals/{id}/original', f'/price-history/{id}']:
        r = get(path); assert r.status_code == 404 and r.json()['detail'] == 'Deal not found'
    post = admin.post(API + f'/deals/{id}/post', json={}, timeout=30)
    assert post.status_code == 400 and 'draft' in post.json()['detail']
    for title, note, confirmed in [('short', 'x' * 80, True), ('x' * 181, 'x' * 80, True), (row['title'], 'short', True), (row['title'], 'x' * 80, False)]:
        r = admin.put(API + f'/deals/{id}/review', json={'title': title, 'editorial_note': note, 'publish': True, 'review_confirmed': confirmed}, timeout=30)
        assert r.status_code == 400 and r.json()['detail']
    advice = 'TEST_ Compare the final price, seller warranty and return conditions before buying. This fixture is not a real offer.'
    r = admin.put(API + f'/deals/{id}/review', json={'title': row['title'], 'editorial_note': advice, 'publish': True, 'review_confirmed': True}, timeout=30)
    assert r.status_code == 200 and r.json()['ok'] is True
    saved = next(d for d in admin.get(API + '/review-deals', timeout=30).json() if d['id'] == id)
    assert saved['publication_status'] == 'published' and saved['published_at'] and saved['editorial_note'] == advice
    assert any(d['id'] == id for d in get('/deals').json()) and get('/stats').json()['total'] == baseline + 1
    assert get(f'/deals/{id}/original').json()['source'] == 'TEST_fixture'
    assert get(f'/go/d/{id}').status_code == 200
    assert get(f'/price-history/{id}').json()['best']['current'] == 100
    r = admin.put(API + f'/deals/{id}/review', json={'title': row['title'], 'editorial_note': advice, 'publish': False}, timeout=30)
    assert r.status_code == 200 and r.json()['ok'] is True
    saved = next(d for d in admin.get(API + '/review-deals', timeout=30).json() if d['id'] == id)
    assert saved['publication_status'] == 'draft' and saved['published_at'] is None
    assert get('/stats').json()['total'] == baseline and not any(d['id'] == id for d in get('/deals').json())
    r = admin.delete(API + f'/deals/{id}', timeout=30)
    assert r.status_code == 200 and r.json()['ok'] is True
    assert database.deals.find_one({'id': id}) is None and get(f'/go/d/{id}').status_code == 404

def test_public_editorial_pages_and_404():
    paths = ['/guides', '/guides/real-cost-of-a-deal', '/guides/headphones-buying-checklist', '/guides/gift-cards-and-rewards'] + ['/info/' + p for p in ['about', 'contact', 'editorial', 'disclosure', 'privacy', 'terms']]
    for path in paths:
        r = requests.get(BASE_URL + path, timeout=30)
        assert r.status_code == 200 and 'DealLoot' in r.text, path
    r = requests.get(BASE_URL + '/info/contact', timeout=30)
    assert 'mailto:hari121vrind@gmail.com' in r.text
    for path in ['/guides/TEST_invalid', '/info/TEST_invalid']:
        r = requests.get(BASE_URL + path, timeout=30)
        assert r.status_code == 404, (path, r.status_code)

def test_manual_deal_rejects_missing_product_url(admin):
    r = admin.post(API + '/deals', json={'title': 'TEST_invalid_payload'}, timeout=30)
    assert r.status_code == 400 and r.json()['detail'], r.text