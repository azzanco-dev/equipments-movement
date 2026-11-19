const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// The daily backup to the company Google Drive (.github/workflows/backup.yml,
// owner 2026-11-19). This repository is PUBLIC, so its Actions logs are
// public: these checks keep the data out of them and keep the job read-only
// towards production and append-only towards the backed-up files.

const FILE = path.join(__dirname, '..', '.github', 'workflows', 'backup.yml')
const SOURCE = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')
// The workflow without its comment lines.
const CODE = SOURCE.split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')

test('runs on the schedule and by hand only, with read-only permissions', () => {
  assert.match(CODE, /schedule:\n\s+- cron: '0 0 \* \* \*'/)
  assert.match(CODE, /workflow_dispatch:/)
  assert.doesNotMatch(CODE, /pull_request|push:|issue_comment|workflow_run/)
  assert.match(CODE, /permissions:\n\s+contents: read\n/)
  assert.match(CODE, /timeout-minutes: \d+/)
  assert.match(CODE, /concurrency:\n\s+group: backup/)
})

test('nothing of the data can reach GitHub', () => {
  // No checkout, artifact or cache; no shell tracing.
  assert.doesNotMatch(CODE, /actions\/checkout|upload-artifact|actions\/cache/)
  assert.doesNotMatch(CODE, /set -x|set -o xtrace|bash -x/)
  // The dump commands send their output nowhere; nothing prints a dump.
  for (const line of CODE.split('\n').filter((l) => /supabase db dump/.test(l))) {
    assert.match(line, />\/dev\/null|\\$/, line)
  }
  assert.doesNotMatch(CODE, /\b(cat|head|tail|zcat|less)\b[^\n]*\.sql/)
  // rclone always quiet, never listing files.
  for (const line of CODE.split('\n').filter((l) => /\brclone (copy|delete|rmdirs|lsf)\b/.test(l))) {
    assert.match(line, / -q\b/, line)
  }
  assert.doesNotMatch(CODE, /rclone (ls|lsl|lsjson|tree|cat)\b/)
  assert.match(CODE, /RCLONE_STATS: '0'/)
})

test('every credential comes from a secret', () => {
  for (const name of [
    'SUPABASE_DB_URL',
    'SUPABASE_S3_ACCESS_KEY_ID',
    'SUPABASE_S3_SECRET_ACCESS_KEY',
    'GDRIVE_TOKEN',
  ]) {
    assert.match(CODE, new RegExp(`\\$\\{\\{ secrets\\.${name} \\}\\}`), name)
  }
  assert.doesNotMatch(CODE, /postgres(ql)?:\/\/|password=|AKIA|"refresh_token"/i)
  // The Drive token reaches only the files this job made.
  assert.match(CODE, /RCLONE_CONFIG_GDRIVE_SCOPE: drive\.file/)
})

test('the backed-up files are never deleted; only dated dumps age out', () => {
  assert.doesNotMatch(CODE, /rclone (sync|move|purge|moveto)\b/)
  assert.match(CODE, /rclone copy -q --ignore-existing[^\n]*\\\n\s+"supabase:\$bucket" "\$DRIVE_ROOT\/files\/\$bucket"/)
  const deletes = CODE.split('\n').filter((l) => /rclone (delete|rmdirs)\b/.test(l))
  assert.equal(deletes.length, 4)
  for (const line of deletes) {
    assert.match(line, /"\$DRIVE_ROOT\/database\/(daily|monthly)"/, line)
  }
  assert.match(CODE, /rclone delete -q --min-age 31d "\$DRIVE_ROOT\/database\/daily"/)
  assert.match(CODE, /rclone delete -q --min-age 370d "\$DRIVE_ROOT\/database\/monthly"/)
})

test('the dump is the Supabase restore shape and is checked before upload', () => {
  // CLI 3.x: a database URL goes through --remote=<url> (no --db-url).
  assert.match(CODE, /supabase db dump --remote="\$SUPABASE_DB_URL" -f roles\.sql --role-only/)
  assert.match(CODE, /supabase db dump --remote="\$SUPABASE_DB_URL" -f schema\.sql/)
  assert.match(CODE, /supabase db dump --remote="\$SUPABASE_DB_URL" -f data\.sql --use-copy --data-only/)
  assert.doesNotMatch(CODE, /--db-url/)
  assert.match(CODE, /version: 3\.2\.0/)
  assert.match(CODE, /entry_exit_logs/)
  assert.match(CODE, /gzip -t roles\.sql\.gz schema\.sql\.gz data\.sql\.gz/)
  // The day is a Saudi day.
  assert.match(CODE, /TZ=Asia\/Riyadh date \+%F/)
  assert.match(CODE, /set -euo pipefail/)
})

test('the Drive token is decoded from rclone\'s blob and masked before use', () => {
  // rclone authorize with a base64 blob prints the token as a base64 blob
  // ({"token": "<json>"}); the first run failed on it (2026-11-19).
  assert.doesNotMatch(CODE, /RCLONE_CONFIG_GDRIVE_TOKEN: \$\{\{/)
  assert.match(CODE, /- name: Read the Drive token\n\s+env:\n\s+RAW_TOKEN: \$\{\{ secrets\.GDRIVE_TOKEN \}\}/)
  assert.match(CODE, /base64\.urlsafe_b64decode/)
  assert.match(CODE, /python3 - 2>\/dev\/null <<'PY'/)
  const mask = CODE.indexOf('echo "::add-mask::$token"')
  const fields = CODE.indexOf('for field in access_token refresh_token')
  const env = CODE.indexOf('echo "RCLONE_CONFIG_GDRIVE_TOKEN=$token" >> "$GITHUB_ENV"')
  assert.ok(mask > 0 && fields > mask && env > fields, 'masked before it enters the environment')
  // The step runs before anything talks to Drive.
  assert.ok(CODE.indexOf('- name: Read the Drive token') < CODE.indexOf('- name: Upload the database dump'))
})
