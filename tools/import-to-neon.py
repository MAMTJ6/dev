# Import rescue dump into Neon.
# Run:  $env:NEON_DATABASE_URL="<pooled connection string from Neon Dashboard → Connect>"
#       python tools/import-to-neon.py "C:\Users\EYM LAPPY\Downloads\backup-supabase-2026-10-13.json"
# Needs: pip install psycopg[binary]
# Safe to re-run (INSERT ... ON CONFLICT DO NOTHING throughout).
import json, os, sys

try:
    import psycopg
    from psycopg.types.json import Json
except ImportError:
    sys.exit('Missing driver. Run: pip install "psycopg[binary]"')

path = sys.argv[1] if len(sys.argv) > 1 else None
if not path or not os.path.exists(path):
    sys.exit('Usage: python tools/import-to-neon.py <backup-supabase-YYYY-MM-DD.json>')
dsn = os.environ.get('NEON_DATABASE_URL')
if not dsn:
    sys.exit('Missing NEON_DATABASE_URL env var (Neon Dashboard → your project → Connect → pooled string).')

with open(path, encoding='utf-8') as f:
    dump = json.load(f)

TABLES = [
    'admins', 'ustaz', 'schedule', 'activity_log',
    'infaq_projects', 'infaq_kutipan_mingguan', 'infaq_projek_kutipan',
    'infaq_perbelanjaan_bulanan', 'infaq_activity_log',
    'news_announcements', 'news_ticker', 'news_settings', 'news_activity_log',
    'staff', 'staff_activity_log',
    'khutbah_weeks', 'khutbah_settings', 'khutbah_activity_log',
    'calendar_activity_log',
]

def adapt(v):
    return Json(v) if isinstance(v, (dict, list)) else v

total = 0
with psycopg.connect(dsn) as conn:
    for t in TABLES:
        rows = dump.get(t)
        if not rows:
            print(f'{t}: 0 rows in backup, skipped')
            continue
        cols = [c for c in rows[0].keys()]
        collist = ', '.join(f'"{c}"' for c in cols)
        placeholders = ', '.join(f'%s' for _ in cols)
        sql = f'INSERT INTO "{t}" ({collist}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'
        with conn.cursor() as cur:
            cur.executemany(sql, [[adapt(r.get(c)) for c in cols] for r in rows])
        conn.commit()
        print(f'{t}: {len(rows)} rows imported (new rows only, existing kept)')
        total += len(rows)
print(f'DONE. {total} rows processed.')
print('Verify in Neon SQL Editor: SELECT count(*) FROM ustaz; -- expect 24')
print('                           SELECT count(*) FROM schedule; -- expect 123')
