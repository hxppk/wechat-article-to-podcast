/**
 * SQLite 数据库初始化 (v2.0)
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 默认数据库位于 data/app.db；测试可通过 APP_DB_PATH 指向临时文件实现隔离。
const DB_PATH = process.env.APP_DB_PATH || path.join(__dirname, '../../data', 'app.db');
const DATA_DIR = path.dirname(DB_PATH);

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据库连接
const db = new Database(DB_PATH);

// 生产并发加固：WAL 模式 + 锁等待。
// 云端 Web 进程与本地 worker（经 API）及清理任务并发读写，WAL 允许读写并发、降低锁竞争。
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

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

  -- 分布式拉模式任务队列：云端持久化，本地 worker 经 API 认领/上报。
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending|leased|completed|failed
    source_url TEXT NOT NULL,
    tts_provider TEXT NOT NULL DEFAULT 'minimax',
    stage TEXT,
    lease_token TEXT,
    leased_until INTEGER,
    worker_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    account_name TEXT,
    error TEXT,
    podcast_id TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_leased_until ON tasks(leased_until);
  CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
`);

// 迁移：为旧库补 attempts 列（CREATE TABLE IF NOT EXISTS 不会为既有表加列）。
const taskCols = db.prepare("PRAGMA table_info(tasks)").all();
if (!taskCols.some((c) => c.name === 'attempts')) {
  db.exec("ALTER TABLE tasks ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
}

// 确保 public 用户存在（用于匿名访问）
const publicUser = db.prepare('SELECT id FROM users WHERE id = ?').get('public');
if (!publicUser) {
  db.prepare(`
    INSERT INTO users (id, phone, password_hash, tier, created_at)
    VALUES ('public', 'public', '', 'guest', ?)
  `).run(Date.now());
}

module.exports = db;
