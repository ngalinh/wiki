require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CONTENT_DIR = path.join(DATA_DIR, 'content');

// Bootstrap data dirs
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_FILE)) {
  const bootstrapAdmins = (process.env.ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ admins: bootstrapAdmins, editors: [] }, null, 2));
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..')));

// Lấy email người dùng từ header do dashboard gửi
function getUserEmail(req) {
  const header = process.env.USER_EMAIL_HEADER || 'x-user-email';
  return (
    req.headers[header] ||
    req.headers['x-user-email'] ||
    req.query.user_email ||
    ''
  ).trim().toLowerCase() || null;
}

function getConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { admins: [], editors: [] }; }
}

function getEnvAdmins() {
  return (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

function isAdmin(email) {
  if (!email) return false;
  const c = getConfig();
  return c.admins.includes(email) || getEnvAdmins().includes(email);
}

function isEditor(email) {
  if (!email) return false;
  const c = getConfig();
  return c.admins.includes(email) || c.editors.includes(email) || getEnvAdmins().includes(email);
}

// GET /api/me
app.get('/api/me', (req, res) => {
  const email = getUserEmail(req);
  res.json({ email, isAdmin: isAdmin(email), isEditor: isEditor(email) });
});

// GET /api/settings  — admin only
app.get('/api/settings', (req, res) => {
  const email = getUserEmail(req);
  if (!isAdmin(email)) return res.status(403).json({ error: 'Chỉ Admin mới có quyền xem cài đặt' });
  res.json(getConfig());
});

// POST /api/settings  — admin only
app.post('/api/settings', (req, res) => {
  const email = getUserEmail(req);
  if (!isAdmin(email)) return res.status(403).json({ error: 'Chỉ Admin mới có quyền thay đổi cài đặt' });
  const { admins, editors } = req.body;
  if (!Array.isArray(admins) || !Array.isArray(editors))
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
  const config = {
    admins: admins.map(e => e.toLowerCase().trim()).filter(Boolean),
    editors: editors.map(e => e.toLowerCase().trim()).filter(Boolean),
  };
  // Giữ admin hiện tại không bị xóa chính mình
  if (email && !config.admins.includes(email)) config.admins.push(email);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  res.json({ success: true, config });
});

// GET /api/content/:pageId  — public
app.get('/api/content/:pageId', (req, res) => {
  const pageId = req.params.pageId.replace(/[^a-z0-9-]/g, '');
  const file = path.join(CONTENT_DIR, `${pageId}.json`);
  if (!fs.existsSync(file)) return res.json({ content: null });
  try { res.json(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { res.json({ content: null }); }
});

// POST /api/content/:pageId  — editor only
app.post('/api/content/:pageId', (req, res) => {
  const email = getUserEmail(req);
  if (!isEditor(email)) return res.status(403).json({ error: 'Không có quyền chỉnh sửa' });
  const pageId = req.params.pageId.replace(/[^a-z0-9-]/g, '');
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'Nội dung không hợp lệ' });
  fs.writeFileSync(path.join(CONTENT_DIR, `${pageId}.json`), JSON.stringify({
    content, updatedBy: email, updatedAt: new Date().toISOString()
  }, null, 2));
  res.json({ success: true });
});

// DELETE /api/content/:pageId  — reset về mặc định, editor only
app.delete('/api/content/:pageId', (req, res) => {
  const email = getUserEmail(req);
  if (!isEditor(email)) return res.status(403).json({ error: 'Không có quyền' });
  const pageId = req.params.pageId.replace(/[^a-z0-9-]/g, '');
  const file = path.join(CONTENT_DIR, `${pageId}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Wiki server: http://localhost:${PORT}`);
  const cfg = getConfig();
  if (cfg.admins.length === 0) {
    console.log('⚠️  Chưa có admin. Thêm ADMIN_EMAILS vào .env hoặc vào file data/config.json');
  } else {
    console.log(`Admins: ${cfg.admins.join(', ')}`);
  }
});
