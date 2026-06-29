const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// require 会在 worktree 内创建 data/app.db（已 gitignore）
const db = require(path.join(__dirname, '..', 'src', 'db'));

test('SQLite 启用 WAL', () => {
  // Genuine: SQLite on-disk default is 'delete'; we explicitly set 'wal'.
  // This assertion fails if the pragma line is removed from src/db/index.js.
  assert.strictEqual(db.pragma('journal_mode', { simple: true }), 'wal');
});

// busy_timeout: better-sqlite3's built-in default is already 5000 ms,
// so an equality assertion (=== 5000) passes even without our pragma line
// and cannot discriminate our configuration from an unconfigured connection.
// The pragma line in src/db/index.js is kept for explicit defensive clarity,
// but no value-equality test is added here — it would be tautological.
