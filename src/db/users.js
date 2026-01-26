/**
 * 用户数据访问层 (v2.0)
 */
const db = require('./index');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

/**
 * 创建用户
 * @param {string} phone - 手机号
 * @param {string} password - 明文密码
 * @returns {object} 用户对象
 */
async function createUser(phone, password) {
  const id = uuid();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const now = Date.now();

  db.prepare(`
    INSERT INTO users (id, phone, password_hash, tier, created_at)
    VALUES (?, ?, ?, 'free', ?)
  `).run(id, phone, passwordHash, now);

  return { id, phone, tier: 'free', createdAt: now };
}

/**
 * 根据手机号查找用户
 * @param {string} phone - 手机号
 * @returns {object|null} 用户对象
 */
function findByPhone(phone) {
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
}

/**
 * 根据 ID 查找用户
 * @param {string} id - 用户 ID
 * @returns {object|null} 用户对象
 */
function findById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/**
 * 验证密码
 * @param {string} password - 明文密码
 * @param {string} hash - 密码哈希
 * @returns {boolean} 是否匹配
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * 更新最后登录时间
 * @param {string} id - 用户 ID
 */
function updateLastLogin(id) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), id);
}

/**
 * 获取用户等级
 * @param {string} userId - 用户 ID
 * @returns {string} 等级：guest | free | paid
 */
function getTier(userId) {
  if (userId === 'public') return 'guest';
  const user = findById(userId);
  return user ? user.tier : 'guest';
}

module.exports = {
  createUser,
  findByPhone,
  findById,
  verifyPassword,
  updateLastLogin,
  getTier
};
