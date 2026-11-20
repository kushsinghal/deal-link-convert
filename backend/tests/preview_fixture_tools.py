"""Create/remove only an explicitly tracked private UI fixture; audit secret exclusions."""
import json
import os
import sys
import uuid
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv, dotenv_values
from pymongo import MongoClient

load_dotenv('/app/backend/.env')
assert os.environ['DB_NAME'] == 'dealloot_preview'
client = MongoClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]
tracking = Path('/app/test_reports/ui-fixtures.json')
if sys.argv[1] == 'setup':
    id = 'TEST_' + str(uuid.uuid4())
    tracking.write_text(json.dumps({'deal_id': id}))
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    db.deals.insert_one({'id': id, 'title': 'TEST private editorial workflow ' + 'LongTitle' * 15, 'publication_status': 'draft', 'created_at': now, 'posted_at': now, 'published_at': None, 'url': 'https://example.org/TEST_product?' + 'longurl=' + 'x' * 200, 'clean_url': 'https://example.org/TEST_product', 'affiliate_url': 'https://example.org/TEST_product?' + 'longurl=' + 'x' * 200, 'converted': False, 'store': 'Other', 'price': 100, 'mrp': 200, 'discount': 50, 'categories': ['heavy_discount'], 'source': 'TEST_private_fixture', 'posted_to': [], 'featured': False, 'score': 50})
    print('Created private UI fixture:', id)
elif sys.argv[1] == 'cleanup':
    id = json.loads(tracking.read_text())['deal_id']
    db.deals.delete_one({'id': id})
    assert db.deals.find_one({'id': id}) is None
    print('UI fixture removed by tracked ID')
elif sys.argv[1] == 'audit':
    for file in ['backend/.env', 'frontend/.env', '.env']:
        result = subprocess.run(['git', 'check-ignore', '--no-index', file], cwd='/app', capture_output=True)
        assert result.returncode == 0, file + ' not ignored'
    tracked = subprocess.run(['git', 'ls-files', 'backend/.env', 'frontend/.env', '.env'], cwd='/app', capture_output=True, text=True).stdout.strip().splitlines()
    for file in tracked:
        print('WARNING tracked env:', file, 'keys only:', ','.join(dotenv_values('/app/' + file)))
    assert Path('/app/.output/server/index.mjs').exists()
    secrets = [os.environ.get(k, '') for k in ['ADMIN_PASSWORD', 'SESSION_SECRET', 'EXTRAPE_SESSION_SECRET', 'MONGO_URL']]
    leaked = []
    for file in Path('/app/.output/public').rglob('*'):
        if file.is_file():
            raw = file.read_bytes()
            if any(len(secret) >= 8 and secret.encode() in raw for secret in secrets):
                leaked.append(str(file))
    assert not leaked, 'Secret found in public artifacts: ' + ','.join(leaked)
    print('PASS Node build output and env exclusions; loaded backend secrets absent from public output')
client.close()