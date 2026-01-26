/**
 * SQLite 数据库初始化 (v2.0)
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据库连接
const db = new Database(DB_PATH);

// 启用外键约束
db.pragma('foreign_keys = ON');

// 创建表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    tier TEXT DEFAULT 'free',
    created_at INTEGER,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS podcasts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    share_id TEXT UNIQUE,
    source_url TEXT,
    title TEXT,
    account_name TEXT,
    duration_ms INTEGER,
    file_size_bytes INTEGER,
    summary TEXT,
    script_preview TEXT,
    audio_path TEXT,
    script_path TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS usage (
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_podcasts_user_id ON podcasts(user_id);
  CREATE INDEX IF NOT EXISTS idx_podcasts_share_id ON podcasts(share_id);
  CREATE INDEX IF NOT EXISTS idx_podcasts_created_at ON podcasts(created_at);
`);

// 确保 public 用户存在（用于匿名访问）
const publicUser = db.prepare('SELECT id FROM users WHERE id = ?').get('public');
if (!publicUser) {
  db.prepare(`
    INSERT INTO users (id, phone, password_hash, tier, created_at)
    VALUES ('public', 'public', '', 'guest', ?)
  `).run(Date.now());
}

module.exports = db;
