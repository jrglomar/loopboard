Deployment plan
Step 0 — decide what ships
Your main branch is still at the pre-v1.58 commit — none of the last week's work (aging, Trends & KPIs, the InvokeBoard rebrand, or this storage port) is merged yet; it's sitting in 8 stacked PRs. Merge that stack first, oldest to newest — each PR is scoped to one phase and retargets automatically as its predecessor merges. Deploying from an unmerged branch while continuing new work on top is how things quietly diverge.

Step 1 — pick a host
Already covered in an earlier turn; the short version: VPS + Docker Compose is the best fit (it's what's actually built — docker-compose.yml, 3 Dockerfiles, nginx reverse proxy, all done). Render/Fly work too if you'd rather not manage a VPS, with one caveat that matters more now than before: exactly one replica, always — this was true for JSON and stays true for SQLite (both are single-file, per-instance storage). Don't let a platform's "auto-scale" default spin up a second instance.

Step 2 — provision + secrets
git clone https://github.com/jrglomar/invokeboard.git
cd invokeboard
cp .env.docker.example .env
# edit .env: real JIRA_*, GITHUB_*, board IDs, TOKEN_ENC_KEY, SESSION_SECRET, ADMIN_EMAILS
Generate real secrets rather than leaving placeholders:

node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # TOKEN_ENC_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # SESSION_SECRET
Put TLS in front of web before anything else touches real credentials — Caddy is the lowest-ceremony option (auto-renewing Let's Encrypt in a ~5-line Caddyfile). Full rationale is in DEPLOYMENT.md §5.1; don't skip it, since the Connections tab is where real Jira/GitHub tokens get typed.

Step 3 — database setup (the part you asked about)
The decision. JSON is genuinely fine to keep running — it's crash-atomic since v1.63, and for a small team the data volume is trivial. SQLite is the "production-ready" upgrade: one real database file with actual transactions instead of eleven-plus-per-user JSON files, which is what "ready for production database setup" concretely means here. My recommendation: switch to SQLite for the production instance, since that's the whole point of this phase, and it costs you nothing risky — the switch is reversible and the JSON files are never deleted.

Scenario A — fresh deployment, no existing data. Just start on SQLite from boot 1:

# in docker-compose.yml, uncomment these two lines in the jira service:
#   STORAGE_DRIVER: sqlite
#   STORAGE_SQLITE_FILE: /data/.invokeboard-stores.sqlite

docker compose up --build -d
docker compose logs jira | grep -i storage   # confirm it opened in sqlite mode, no import (empty→empty)
Scenario B — you're already running JSON and switching over (almost certainly your actual case, since you've been using this app):

Back up first, belt-and-suspenders, even though the JSON files are never touched by the switch:
docker run --rm -v invokeboard_invokeboard-data:/data -v "$PWD":/backup alpine \
  sh -c "cp /data/.invokeboard-*.json /backup/pre-sqlite-backup/ 2>/dev/null || true"
Uncomment the same two lines in docker-compose.yml (STORAGE_DRIVER: sqlite, STORAGE_SQLITE_FILE: /data/.invokeboard-stores.sqlite).
Restart just the jira service (the only one that reads storage):
docker compose up -d --build jira
Watch for the auto-import. The bridge sees an empty database and imports every JSON store it finds — shared files and every per-user store — in one transaction, logging a loud multi-line summary:
docker compose logs jira | grep -A20 -i "auto-import\|storage"
You should see every store name it picked up (leaves, team, impediments, offset, users, each user's journal, etc.). If a store you expect is missing from that list, stop and investigate before trusting the switch.

Verify by eye. Log into the app, check the Offset Tracker balances, a leave you know was plotted, and a Huddle meeting note — they should match exactly what you saw before the switch.
Leave the JSON files where they are. They're never read again once the database is non-empty, and they're your instant rollback: if anything looks wrong, re-comment those two compose lines and restart — you're back on JSON with zero data loss, because nothing about the switch ever modified those files.
Backup, going forward (SQLite mode). Simpler than before — one file instead of many:

docker run --rm -v invokeboard_invokeboard-data:/data -v "$PWD":/backup alpine \
  sh -c "cp /data/.invokeboard-stores.sqlite /backup/invokeboard-$(date +%F).sqlite"
Same hard rule as always: never back this file up alongside .env — the database holds the same sealed tokens the JSON users-store did, and TOKEN_ENC_KEY is what unseals them. Keep them apart. A cron entry running that command nightly, plus a few days of retention, is a reasonable baseline.

Restore drill (worth doing once, before you need it for real):

docker compose down
docker run --rm -v invokeboard_invokeboard-data:/data -v "$PWD":/backup alpine \
  sh -c "cp /backup/invokeboard-2026-07-18.sqlite /data/.invokeboard-stores.sqlite"
docker compose up -d
Sanity-check the database directly, if you want a health-check beyond the app UI:

docker compose exec jira node -e "
const db = require('better-sqlite3')('/data/.invokeboard-stores.sqlite');
console.log(db.prepare('SELECT scope, name FROM docs ORDER BY scope, name').all());
"
Step 4 — go-live checklist
DEPLOYMENT.md §5 already has the full 12-item hardening list (TLS, NODE_ENV=production, token scope, backups, login-throttle limits, the one-replica rule) — worth reading start to finish once, not repeating here. The one item this phase adds: watch the first docker compose build closely for the Alpine/Python step above — it's the one thing in this whole plan that hasn't been proven end-to-end.

Step 5 — ongoing operations
docker compose ps                     # health status
docker compose logs -f jira           # tail one service
git pull && docker compose up -d --build   # deploy a new version
Redeploys are safe with SQLite exactly as they were with JSON — the volume persists across up/down/rebuild, and the import logic only fires once, so pulling a new version never re-imports or duplicates anything.