"""Reproducible exploratory NBA foul analysis; archives remain outside the game repo."""
import collections
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parent
PENALTY_TYPES = {1, 2, 3, 5, 6, 9, 14, 15, 27, 28, 29, 31}


def rows(name):
    with tarfile.open(ROOT / 'data' / (name + '.tar.xz')) as archive:
        member = next(m for m in archive.getmembers() if m.name.endswith('.csv'))
        yield from csv.DictReader(io.TextIOWrapper(archive.extractfile(member)))


def seconds(clock):
    m, s = clock.split(':')
    return 60 * int(m) + float(s)


def summarize(items):
    n = len(items)
    k = sum(x['personal'] > 0 for x in items)
    rate = k / n if n else 0
    z = 1.96
    center = (rate + z*z/(2*n))/(1+z*z/n) if n else 0
    half = z*math.sqrt(rate*(1-rate)/n+z*z/(4*n*n))/(1+z*z/n) if n else 0
    return dict(possessions=n, games=len({x['game'] for x in items}), personal_foul_possessions=k,
                personal_foul_pct=100*rate, wilson95_pct=[100*(center-half),100*(center+half)],
                personal_fouls=sum(x['personal'] for x in items),
                take_fouls=sum(x['take'] for x in items),
                nonshooting_ft_fouls=sum(x['nsft'] for x in items))


all_possessions = []
coverage = []
for year in [2021, 2022, 2023]:
    foul_map = collections.defaultdict(list)
    raw_games = set()
    for r in rows(f'nbastats_{year}'):
        raw_games.add(r['GAME_ID'])
        if r['EVENTMSGTYPE'] != '6':
            continue
        foul_map[(r['GAME_ID'], int(r['PERIOD']), r['PLAYER1_TEAM_ABBREVIATION'])].append({
            'time': seconds(r['PCTIMESTRING']), 'type': int(r['EVENTMSGACTIONTYPE']),
            'description': r['HOMEDESCRIPTION'] or r['VISITORDESCRIPTION'],
        })
    seen = set()
    season_possessions = []
    raw_count = 0
    for r in rows(f'pbpstats_{year}'):
        raw_count += 1
        key = tuple(v for k, v in r.items() if k not in {'DESCRIPTION', 'URL'})
        if key in seen:
            continue
        seen.add(key)
        start = seconds(r['STARTTIME'])
        end = seconds(r['ENDTIME'])
        period = int(r['PERIOD'])
        game = r['GAMEID']
        if game not in raw_games:
            continue
        fouls = foul_map[(game, period, r['OPPONENT'])]
        prior = [f for f in fouls if f['time'] > start and f['type'] in PENALTY_TYPES]
        ambiguous = any(f['time'] == start and f['type'] in PENALTY_TYPES for f in fouls)
        bonus = len(prior) >= (4 if period <= 4 else 3) or (start <= 120 and sum(f['time'] <= 120 for f in prior) >= 1)
        matched = [f for f in fouls if end <= f['time'] <= start and f['description'] and f['description'] in r['EVENTS'].splitlines()]
        season_possessions.append(dict(year=year, game=game, period=period, start=start, end=end,
            lead=-int(r['STARTSCOREDIFFERENTIAL']), bonus=bonus, ambiguous_bonus=ambiguous,
            personal=sum(f['type'] in {1,27} for f in matched), take=sum(f['type']==28 for f in matched),
            nsft=int(r['NONSHOOTINGFOULSTHATRESULTEDINFTS']),
            events=r['EVENTS'], orb=int(r['OFFENSIVEREBOUNDS']), startType=r['STARTTYPE']))
    coverage.append(dict(year=year, raw_rows=raw_count, unique_possessions=len(seen),
                         matched_possessions=len(season_possessions), raw_games=len(raw_games),
                         possession_games=len({p['game'] for p in season_possessions})))
    all_possessions += season_possessions
    print('loaded', coverage[-1], flush=True)

reports = {}
for year in ['all',2021,2022,2023]:
    data = [p for p in all_possessions if (year=='all' or p['year']==year) and p['start'] > 2]
    for bonus in ['all',True,False]:
        for window in ['ordinary',120,60,30]:
            for leads in [(0,2),(0,0),(1,2),(3,3),(-6,-1)]:
                sample = [p for p in data if leads[0] <= p['lead'] <= leads[1]
                    and (bonus=='all' or (not p['ambiguous_bonus'] and p['bonus']==bonus))
                    and ((p['period']<4 or p['start']>120) if window=='ordinary' else (p['period']>=4 and p['start']<=window))]
                reports[f'{year}/bonus={bonus}/window={window}/lead={leads[0]}:{leads[1]}'] = summarize(sample)

manifest=[dict(file=p.name,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
               url='https://raw.githubusercontent.com/shufinskiy/nba_data/main/datasets/'+p.name)
          for p in sorted((ROOT/'data').glob('*.tar.xz'))]
(ROOT/'nba-analysis.json').write_text(json.dumps(dict(coverage=coverage,manifest=manifest,reports=reports),indent=2))
with (ROOT/'possessions.jsonl').open('w') as f:
    for p in all_possessions:
        f.write(json.dumps(p)+'\n')
(ROOT/'calibration-cases.json').write_text(json.dumps([
    {k:p[k] for k in ['year','game','period','start','lead','startType']}
    for p in all_possessions if p['period']>=4 and 2<p['start']<=60 and 0<=p['lead']<=2
    and p['bonus'] and not p['ambiguous_bonus']
]))
for k,v in reports.items():
    if k.startswith('all/') and k.endswith('lead=0:2'): print(k, v)
