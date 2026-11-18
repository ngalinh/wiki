// Tài khoản đăng nhập riêng cho Wiki — độc lập với Dashboard/Basso, dành cho
// nhân viên thử việc chưa có tài khoản hệ thống. Mật khẩu hash bằng scrypt
// (sẵn có trong Node, không cần thêm dependency); phiên đăng nhập là cookie
// tự ký bằng HMAC, xác minh cục bộ — không gọi mạng, không phụ thuộc Basso.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.WIKI_DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'wiki-users.json');
const SECRET_FILE = path.join(DATA_DIR, 'wiki-session-secret.key');
const COOKIE_NAME = 'wiki_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày

function getSecret() {
  if (process.env.WIKI_SESSION_SECRET) return process.env.WIKI_SESSION_SECRET;
  try { return fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret);
  return secret;
}
const SECRET = getSecret();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  try {
    const check = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch { return false; }
}

function signToken(email) {
  const payload = Buffer.from(JSON.stringify({ u: email, exp: Date.now() + SESSION_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try { if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null; }
  catch { return null; }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.u || !data.exp || data.exp < Date.now()) return null;
    return String(data.u).trim().toLowerCase();
  } catch { return null; }
}

// Đọc + xác minh cookie wiki_session từ request. Trả về email hoặc null.
// Token tự ký không mang trạng thái "còn tồn tại" — phải tra lại danh sách
// tài khoản mỗi lần, để xóa tài khoản có hiệu lực ngay (không phải chờ cookie
// cũ (tối đa 30 ngày) tự hết hạn).
function emailFromRequest(req) {
  const m = /(?:^|;\s*)wiki_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const email = verifyToken(decodeURIComponent(m[1]));
  return email && findUser(email) ? email : null;
}

function setSessionCookie(req, res, email) {
  const secure = Boolean(req.secure) || (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  res.cookie(COOKIE_NAME, signToken(email), { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_MS, path: '/' });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// ─── Danh sách tài khoản (data/wiki-users.json) ────────────────
function listUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function saveUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function findUser(email) {
  return listUsers().find(u => u.email === email) || null;
}

function upsertUser(email, password, label, createdBy) {
  const users = listUsers().filter(u => u.email !== email);
  users.push({ email, passwordHash: hashPassword(password), label: label || '', createdAt: new Date().toISOString(), createdBy: createdBy || null });
  saveUsers(users);
}

function removeUser(email) {
  saveUsers(listUsers().filter(u => u.email !== email));
}

module.exports = {
  verifyPassword, emailFromRequest, setSessionCookie, clearSessionCookie,
  listUsers, findUser, upsertUser, removeUser,
};
