"""Download the pinned study inputs and verify their recorded SHA-256 hashes."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parent
revision = 'e829d4678be1e075f99e5d41a1c5f97089be446b'
(ROOT / 'data').mkdir(exist_ok=True)
for entry in json.loads((ROOT / 'nba-analysis.json').read_text())['manifest']:
    path = ROOT / 'data' / entry['file']
    if not path.exists():
        url = f'https://raw.githubusercontent.com/shufinskiy/nba_data/{revision}/datasets/{path.name}'
        urllib.request.urlretrieve(url, path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != entry['sha256']:
        raise ValueError(f'Input hash mismatch: {path}')
    print(path.name, digest)
