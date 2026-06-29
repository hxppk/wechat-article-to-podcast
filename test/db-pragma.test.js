const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// require 会在 worktree 内创建 data/app.db（已 gitignore）
const db = require(path.join(__dirname, '..', 'src', 'db'));

test('SQLite 启用 WAL', () => {
  assert.strictEqual(db.pragma('journal_mode', { simple: true }), 'wal');
});

test('SQLite 设置 busy_timeout=5000', () => {
  assert.strictEqual(db.pragma('busy_timeout', { simple: true }), 5000);
});
