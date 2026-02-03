#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'app.db');

function printUsage() {
  console.log('用法:');
  console.log('  node scripts/db-cli.js "<SQL>" [--db <path>] [--out <file.csv>]\n');
  console.log('示例:');
  console.log('  node scripts/db-cli.js "SELECT * FROM users LIMIT 10"');
  console.log('  node scripts/db-cli.js "SELECT * FROM podcasts" --out data/podcasts.csv');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let dbPath = DEFAULT_DB_PATH;
  let outPath = null;
  let sqlParts = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
    if (arg === '--db') {
      dbPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--db=')) {
      dbPath = arg.split('=', 2)[1];
      continue;
    }
    if (arg === '--out') {
      outPath = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.split('=', 2)[1];
      continue;
    }
    sqlParts.push(arg);
  }

  const sql = sqlParts.join(' ').trim();
  return { dbPath, outPath, sql, help: false };
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCsv(outPath, columns, rows) {
  const lines = [];
  if (columns.length > 0) {
    lines.push(columns.map(col => escapeCsv(col.name || col)).join(','));
  }
  for (const row of rows) {
    const line = columns.map(col => escapeCsv(row[col.name || col] ?? '')).join(',');
    lines.push(line);
  }
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
}

function main() {
  const { dbPath, outPath, sql, help } = parseArgs(process.argv);

  if (help || !sql) {
    printUsage();
    process.exit(sql ? 0 : 1);
  }

  if (!fs.existsSync(dbPath)) {
    console.error(`数据库不存在: ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: false });

  try {
    const stmt = db.prepare(sql);
    if (stmt.reader) {
      const rows = stmt.all();
      if (rows.length === 0) {
        console.log('0 rows');
      } else {
        console.table(rows);
      }

      if (outPath) {
        const columns = stmt.columns();
        writeCsv(outPath, columns, rows);
        console.log(`CSV 已保存: ${outPath}`);
      }
    } else {
      const result = stmt.run();
      console.log(`执行完成: changes=${result.changes}`);
      if (outPath) {
        console.log('非查询语句不支持导出。');
      }
    }
  } catch (error) {
    console.error(`SQL 执行失败: ${error.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
