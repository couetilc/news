"""Reproduce pagination plans locally; no production access or data."""
from pathlib import Path
import sqlite3

db = sqlite3.connect(':memory:')
for migration in sorted(Path('migrations').glob('*.sql')):
    if migration.name.startswith('0010_'):
        continue
    db.executescript(migration.read_text())
query = '''SELECT i.id FROM items i
LEFT JOIN item_reads r ON r.item_id=i.id AND r.user_id=?
WHERE r.read_at IS NULL
AND COALESCE(i.published_at,i.fetched_at) <= ?
AND (COALESCE(i.published_at,i.fetched_at), i.id) < (?, ?)
ORDER BY COALESCE(i.published_at,i.fetched_at) DESC,i.id DESC LIMIT ?'''
for phase in ['before', 'after']:
    if phase == 'after':
        db.execute('CREATE INDEX items_by_effective_time ON items(COALESCE(published_at,fetched_at) DESC,id DESC)')
    for source in [False, True]:
        sql = query.replace('AND (COALESCE', "AND i.source IN ('openai') AND (COALESCE") if source else query
        print(phase, 'source-filtered' if source else 'all sources')
        for row in db.execute('EXPLAIN QUERY PLAN '+sql, (1, 1000, 1000, 50, 51)):
            print(row[3])
