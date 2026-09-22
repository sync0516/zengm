"""Validate bonus reconstruction and bootstrap by game. Run after analyze.py."""
import collections
import csv
import io
import json
from pathlib import Path
import random
import tarfile

ROOT = Path(__file__).resolve().parent
penalty_types = {1, 2, 3, 5, 6, 9, 14, 15, 27, 28, 29, 31}
validation = []
for year in [2021, 2022, 2023]:
    counts = collections.Counter()
    late = collections.Counter()
    checked = mismatches = 0
    examples = []
    with tarfile.open(ROOT / 'data' / f'nbastats_{year}.tar.xz') as archive:
        member = next(m for m in archive.getmembers() if m.name.endswith('.csv'))
        for row in csv.DictReader(io.TextIOWrapper(archive.extractfile(member))):
            if row['EVENTMSGTYPE'] != '6':
                continue
            kind = int(row['EVENTMSGACTIONTYPE'])
            key = (row['GAME_ID'], row['PERIOD'], row['PLAYER1_TEAM_ABBREVIATION'])
            minute, second = row['PCTIMESTRING'].split(':')
            seconds = int(minute) * 60 + float(second)
            if kind in penalty_types:
                counts[key] += 1
                if seconds <= 120:
                    late[key] += 1
            if kind not in {1, 27}:
                continue
            text = row['HOMEDESCRIPTION'] or row['VISITORDESCRIPTION']
            if not text:
                continue
            predicted = counts[key] > (4 if int(row['PERIOD']) <= 4 else 3) or (seconds <= 120 and late[key] > 1)
            checked += 1
            if predicted != ('.PN)' in text):
                mismatches += 1
                if len(examples) < 5:
                    examples.append(dict(game=row['GAME_ID'], event=row['EVENTNUM'], description=text, predicted=predicted))
    validation.append(dict(year=year, personalFoulsChecked=checked, mismatches=mismatches, examples=examples))
(ROOT / 'bonus-validation.json').write_text(json.dumps(validation, indent=2))

groups = {key: collections.defaultdict(lambda: [0, 0]) for key in ['ordinary', 'late']}
for line in (ROOT / 'possessions.jsonl').open():
    p = json.loads(line)
    if not (0 <= p['lead'] <= 2 and p['bonus'] and not p['ambiguous_bonus'] and p['start'] > 2):
        continue
    key = 'ordinary' if p['period'] < 4 or p['start'] > 120 else ('late' if p['start'] <= 60 else None)
    if key:
        group = groups[key][p['game']]
        group[0] += 1
        group[1] += int(p['personal'] > 0)
rng = random.Random(12345)
bootstrap = {}
for key, group in groups.items():
    values = list(group.values())
    rates = []
    for _ in range(2000):
        n = k = 0
        for __ in values:
            a, b = rng.choice(values)
            n += a
            k += b
        rates.append(k / n)
    rates.sort()
    bootstrap[key] = dict(games=len(values), bootstrap95_pct=[100 * rates[50], 100 * rates[1949]])
(ROOT / 'uncertainty.json').write_text(json.dumps(bootstrap, indent=2))
print(validation)
print(bootstrap)
