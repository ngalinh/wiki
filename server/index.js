require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const IMGTEXT_DIR = path.join(DATA_DIR, 'imgtext');
const LINKTEXT_DIR = path.join(DATA_DIR, 'linktext');
const MAX_HISTORY = 10;

// Bootstrap data dirs
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
if (!fs.existsSync(IMGTEXT_DIR)) fs.mkdirSync(IMGTEXT_DIR, { recursive: true });
if (!fs.existsSync(LINKTEXT_DIR)) fs.mkdirSync(LINKTEXT_DIR, { recursive: true });
if (!fs.existsSync(CONFIG_FILE)) {
  const bootstrapAdmins = (process.env.ADMIN_EMAILS || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ admins: bootstrapAdmins, editors: [] }, null, 2));
}

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html')) {
      // no-store: trình duyệt/PWA luôn tải bản mới, không giữ bản cũ sau deploy
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// Đọc email từ cookie platform_token của hệ thống (gửi kèm mọi request
// cùng origin). Token dạng base64("{\"u\":\"email\",...}") [+ ".chữ_ký"].
function emailFromPlatformToken(req) {
  try {
    const m = /(?:^|;\s*)platform_token=([^;]+)/.exec(req.headers.cookie || '');
    if (!m) return null;
    const seg = decodeURIComponent(m[1]).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(Buffer.from(seg, 'base64').toString('utf8'));
    if (p && p.exp) {
      // exp có thể là epoch giây hoặc mili-giây
      const expMs = Number(p.exp) < 1e12 ? Number(p.exp) * 1000 : Number(p.exp);
      if (expMs < Date.now()) return null;
    }
    const email = p && (p.u || p.email || p.username);
    return email ? String(email).trim().toLowerCase() : null;
  } catch { return null; }
}

// Lấy email người dùng từ header do dashboard gửi
function getUserEmail(req) {
  const header = process.env.USER_EMAIL_HEADER || 'x-user-email';
  return (
    req.headers[header] ||
    req.headers['x-user-email'] ||
    req.query.user_email ||
    emailFromPlatformToken(req) ||
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

// Đọc commit SHA từ .git lúc khởi động (không cần git binary trong container).
// Giá trị nằm trong RAM của process → /api/version chứng minh process đang chạy
// được khởi động với code của commit nào (dùng cho bước xác minh deploy).
function getGitSha() {
  try {
    const gitDir = path.join(__dirname, '..', '.git');
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    const ref = head.slice(4).trim();
    const refFile = path.join(gitDir, ...ref.split('/'));
    if (fs.existsSync(refFile)) return fs.readFileSync(refFile, 'utf8').trim();
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    const line = packed.split('\n').find(l => l.trim().endsWith(' ' + ref));
    return line ? line.trim().split(' ')[0] : 'unknown';
  } catch { return 'unknown'; }
}
const STARTED_SHA = getGitSha();
const STARTED_AT = new Date().toISOString();

// GET /api/version — public, dùng để xác minh deploy
app.get('/api/version', (req, res) => {
  res.json({ sha: STARTED_SHA, startedAt: STARTED_AT });
});

// GET /api/debug-auth — chẩn đoán nhận diện đăng nhập (email được che bớt)
app.get('/api/debug-auth', (req, res) => {
  const email = getUserEmail(req);
  const c = getConfig();
  const mask = e => String(e).replace(/^(..)[^@]*/, '$1***');
  res.json({
    emailServerNhanDuoc: email || null,
    laAdmin: isAdmin(email),
    laEditor: isEditor(email),
    danhSachAdmin: c.admins.map(mask),
    danhSachEditor: c.editors.map(mask),
    adminTuEnv: getEnvAdmins().map(mask),
    headerXUserEmail: req.headers['x-user-email'] || null,
    emailTuCookiePlatform: emailFromPlatformToken(req),
    cacHeaderX: Object.keys(req.headers).filter(h => h.startsWith('x-')),
    tenCookie: (req.headers.cookie || '').split(';').map(s => s.split('=')[0].trim()).filter(Boolean),
  });
});

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

// ─── Lịch sử phiên bản: data/history/<pageId>.json, mới nhất đứng đầu ──
function readHistory(pageId) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, `${pageId}.json`), 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function pushHistory(pageId, entry) {
  const versions = readHistory(pageId);
  versions.unshift({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ...entry });
  fs.writeFileSync(path.join(HISTORY_DIR, `${pageId}.json`),
    JSON.stringify(versions.slice(0, MAX_HISTORY), null, 2));
}

// POST /api/content/:pageId  — editor only
app.post('/api/content/:pageId', (req, res) => {
  const email = getUserEmail(req);
  if (!isEditor(email)) return res.status(403).json({ error: 'Không có quyền chỉnh sửa' });
  const pageId = req.params.pageId.replace(/[^a-z0-9-]/g, '');
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'Nội dung không hợp lệ' });
  const record = { content, updatedBy: email, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(CONTENT_DIR, `${pageId}.json`), JSON.stringify(record, null, 2));
  pushHistory(pageId, record);
  // Trích xuất trước nội dung hình và link mới trong trang (chạy ngầm cho AI hỏi-đáp)
  injectImageText(content).catch(() => {});
  injectLinkText(content, { cookie: req.headers.cookie || '', host: req.headers.host }).catch(() => {});
  res.json({ success: true });
});

// GET /api/history/:pageId  — danh sách phiên bản (không kèm nội dung), editor only
app.get('/api/history/:pageId', (req, res) => {
  const email = getUserEmail(req);
  if (!isEditor(email)) return res.status(403).json({ error: 'Không có quyền' });
  const pageId = req.params.pageId.replace(/[^a-z0-9-]/g, '');
  res.json({
    versions: readHistory(pageId).map(v => ({ id: v.id, updatedBy: v.updatedBy, updatedAt: v.updatedAt }))
  });
});

// POST /api/history/:pageId/restore  — khôi phục về một phiên bản, editor only
app.post('/api/history/:pageId/restore', (req, res) => {
  const email = getUserEmail(req);
  if (!isEditor(email)) return res.status(403).json({ error: 'Không có quyền chỉnh sửa' });
  const pageId = req.params.pageId.replace(/[^a-z0-9-]/g, '');
  const version = readHistory(pageId).find(v => v.id === (req.body || {}).id);
  if (!version) return res.status(404).json({ error: 'Không tìm thấy phiên bản này' });
  const record = { content: version.content, updatedBy: email, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(CONTENT_DIR, `${pageId}.json`), JSON.stringify(record, null, 2));
  // Bản khôi phục cũng được ghi vào lịch sử như một lần cập nhật
  pushHistory(pageId, record);
  res.json({ success: true, content: version.content });
});

// POST /api/upload  — upload ảnh từ máy tính, editor only
const IMAGE_EXTS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
app.post('/api/upload', express.raw({ type: 'image/*', limit: '10mb' }), (req, res) => {
  const email = getUserEmail(req);
  if (!isEditor(email)) return res.status(403).json({ error: 'Không có quyền chỉnh sửa' });
  const ext = IMAGE_EXTS[(req.headers['content-type'] || '').split(';')[0].trim()];
  if (!ext) return res.status(400).json({ error: 'Chỉ hỗ trợ ảnh PNG, JPG, GIF, WebP' });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0)
    return res.status(400).json({ error: 'File ảnh rỗng' });
  const name = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
  res.json({ success: true, url: `uploads/${name}` });
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

// ─── Hỏi đáp AI (Google Gemini) ──────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const AI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Chuyển HTML của trang wiki thành văn bản thuần cho AI đọc
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(h2|h3)[^>]*>/gi, '\n\n## ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(tr|p|div|h1|h2|h3|h4|ul|ol|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Đọc nội dung hình minh họa cho AI ────────────────────────
// Mỗi hình được Gemini (vision) trích xuất chữ/thông tin MỘT lần rồi cache
// vào data/imgtext/<md5(src)>.json — hình mới upload tự được xử lý ở lần
// hỏi tiếp theo (hoặc ngay sau khi lưu trang, chạy ngầm).
const imgTextFailed = new Map(); // src -> timestamp lần fail gần nhất (chỉ trong RAM)

async function loadImageBytes(src) {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(src);
  if (m) return { mime: m[1], data: m[2] };
  const up = /(?:^|\/)uploads\/([\w.-]+)$/.exec(src.split('?')[0]);
  if (up) {
    const file = path.join(UPLOAD_DIR, up[1]);
    if (!fs.existsSync(file)) return null;
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[path.extname(file).slice(1).toLowerCase()];
    if (!mime) return null;
    return { mime, data: fs.readFileSync(file).toString('base64') };
  }
  if (/^https?:\/\//.test(src)) {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!mime.startsWith('image/')) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null;
      return { mime, data: buf.toString('base64') };
    } catch { return null; }
  }
  return null;
}

async function describeImage(src) {
  const cacheFile = path.join(IMGTEXT_DIR, crypto.createHash('md5').update(src).digest('hex') + '.json');
  try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')).text; } catch {}
  if (!GEMINI_API_KEY) return null;
  // Hình từng fail (hỏng/không tải được): chỉ thử lại sau 10 phút
  const failedAt = imgTextFailed.get(src);
  if (failedAt && Date.now() - failedAt < 10 * 60 * 1000) return null;
  try {
    const img = await loadImageBytes(src);
    if (!img) throw new Error('no image data');
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(AI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inline_data: { mime_type: img.mime, data: img.data } },
            { text: 'Đây là hình minh họa trong wiki nội bộ công ty. Hãy trích xuất TOÀN BỘ chữ và thông tin trong hình thành văn bản thuần (tiếng Việt giữ nguyên tiếng Việt), giữ đúng các con số, mức phí, công thức, các bước, nhãn sơ đồ. Trình bày theo cấu trúc của hình. Chỉ trả về nội dung trích xuất, không bình luận thêm.' },
          ] }],
          generationConfig: { maxOutputTokens: 2048, temperature: 0 },
        }),
      }
    );
    const data = await apiRes.json().catch(() => ({}));
    if (!apiRes.ok) throw new Error(`Gemini ${apiRes.status}`);
    const cand = data.candidates && data.candidates[0];
    const text = cand && cand.content && Array.isArray(cand.content.parts)
      ? cand.content.parts.map(p => p.text || '').join('').trim() : '';
    if (!text) throw new Error('empty extraction');
    fs.writeFileSync(cacheFile, JSON.stringify({ src: src.slice(0, 200), text, extractedAt: new Date().toISOString() }, null, 2));
    imgTextFailed.delete(src);
    return text;
  } catch (err) {
    console.error('Trích xuất hình lỗi:', src.slice(0, 80), err && err.message);
    imgTextFailed.set(src, Date.now());
    return null;
  }
}

// Thay mỗi thẻ <img> trong HTML bằng nội dung chữ trích xuất từ hình đó
async function injectImageText(html) {
  const srcs = [...new Set([...html.matchAll(/<img\b[^>]*?\ssrc=["']([^"']+)["']/gi)].map(m => m[1]))];
  const texts = new Map();
  // Xử lý tuần tự từng nhóm 4 hình để không dồn quá nhiều request
  for (let i = 0; i < srcs.length; i += 4) {
    await Promise.all(srcs.slice(i, i + 4).map(async s => texts.set(s, await describeImage(s))));
  }
  return html.replace(/<img\b[^>]*?\ssrc=["']([^"']+)["'][^>]*>/gi, (tag, src) => {
    const text = texts.get(src);
    // Địa chỉ hình kèm theo để AI trích dẫn nguồn dạng [HÌNH: địa_chỉ].
    // Bỏ dấu < để htmlToText không nhầm nội dung trích xuất là thẻ HTML.
    const cite = src.startsWith('data:') ? '' : ` — địa chỉ hình: ${src}`;
    return text ? `\n[HÌNH MINH HỌA${cite}]\n${text.replace(/</g, '‹')}\n[HẾT HÌNH]\n` : `\n[Hình minh họa${cite}]\n`;
  });
}

// ─── Đọc nội dung trang web được gắn link cho AI ──────────────
// Văn bản chính của trang được tải MỘT lần và cache 7 ngày vào
// data/linktext/; hết hạn thì tự tải lại ở lần hỏi kế tiếp.
// Link nội bộ (cùng host với wiki hoặc host trong LINK_AUTH_HOSTS) được tải
// kèm cookie đăng nhập của người đang hỏi → đọc được cả trang cần đăng nhập
// như bảng tỉ giá/quản lý website.
const LINK_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_TEXT_MAX = 15000;
const linkTextFailed = new Map(); // url -> timestamp lần fail gần nhất (chỉ trong RAM)

// Host được gửi kèm cookie: trùng host của wiki, hoặc nằm trong LINK_AUTH_HOSTS
// (khai "basso.vn" là khớp luôn mọi subdomain như www.basso.vn, dashboard.basso.vn)
function linkHostAllowed(host, auth) {
  if (auth && host === auth.host) return true;
  return (process.env.LINK_AUTH_HOSTS || '').split(',').map(h => h.trim()).filter(Boolean)
    .some(h => host === h || host.endsWith('.' + h));
}

async function describeLink(url, auth) {
  // 'v3': đổi key để bỏ cache cũ (bản tải khi chưa kèm cookie / lỡ dính trang login)
  const cacheFile = path.join(LINKTEXT_DIR, crypto.createHash('md5').update('v3|' + url).digest('hex') + '.json');
  let stale = null;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (Date.now() - new Date(c.fetchedAt).getTime() < LINK_CACHE_MS) return c.text;
    stale = c.text; // bản cũ: dùng tạm nếu tải lại thất bại
  } catch {}
  const failedAt = linkTextFailed.get(url);
  if (failedAt && Date.now() - failedAt < 10 * 60 * 1000) return stale;
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; BassoWikiBot/1.0)', 'Accept-Language': 'vi,en' };
    try {
      if (auth && auth.cookie && linkHostAllowed(new URL(url).host, auth)) headers.cookie = auth.cookie;
    } catch {}
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (ct !== 'text/html' && ct !== 'text/plain') throw new Error(`content-type ${ct}`);
    let body = (await res.text()).slice(0, 3e6);
    if (ct === 'text/html') body = body.replace(/<head[\s\S]*?<\/head>/gi, '').replace(/<(nav|footer|noscript)[\s\S]*?<\/\1>/gi, '');
    const text = htmlToText(body).slice(0, LINK_TEXT_MAX);
    if (!text) throw new Error('empty page');
    // Trang trả về form đăng nhập (cookie không được chấp nhận) → coi như lỗi,
    // KHÔNG cache 7 ngày kẻo sửa cấu hình xong vẫn dùng nhầm bản login
    if (text.length < 400 && /đăng nhập|log\s?in|sign\s?in/i.test(text)) throw new Error('trang yêu cầu đăng nhập');
    fs.writeFileSync(cacheFile, JSON.stringify({ url, text, fetchedAt: new Date().toISOString() }, null, 2));
    linkTextFailed.delete(url);
    return text;
  } catch (err) {
    console.error('Đọc link lỗi:', url.slice(0, 80), err && err.message);
    linkTextFailed.set(url, Date.now());
    return stale;
  }
}

// Chèn nội dung trang web ngay sau mỗi link http(s) trong HTML
// (htmlToText vốn vứt bỏ thuộc tính href nên phải giữ lại địa chỉ ở đây)
async function injectLinkText(html, auth) {
  const urls = [...new Set([...html.matchAll(/<a\b[^>]*?\shref=["'](https?:\/\/[^"']+)["']/gi)].map(m => m[1]))];
  const texts = new Map();
  for (let i = 0; i < urls.length; i += 4) {
    await Promise.all(urls.slice(i, i + 4).map(async u => texts.set(u, await describeLink(u, auth))));
  }
  return html.replace(/<a\b[^>]*?\shref=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (tag, url, label) => {
    const text = texts.get(url);
    const head = `${label} [LINK: ${url}]`;
    return text ? `${head}\n[NỘI DUNG TRANG WEB TRONG LINK]\n${text.replace(/</g, '‹')}\n[HẾT TRANG WEB]\n` : head;
  });
}

// Gom toàn bộ nội dung wiki: nội dung mặc định trong index.html,
// thay bằng bản đã chỉnh sửa (data/content/*.json) nếu có
async function getWikiContext(auth) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const sections = [];
  const re = /<section class="page" data-page="([a-z-]+)">([\s\S]*?)<\/section>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, pageId, body] = m;
    if (pageId === 'settings' || pageId === 'hoi-dap') continue;
    const titleMatch = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    const title = titleMatch ? htmlToText(titleMatch[1]) : pageId;
    let contentHtml = body;
    const customFile = path.join(CONTENT_DIR, `${pageId}.json`);
    if (fs.existsSync(customFile)) {
      try {
        const custom = JSON.parse(fs.readFileSync(customFile, 'utf8'));
        if (custom && custom.content) contentHtml = custom.content;
      } catch {}
    }
    contentHtml = await injectImageText(contentHtml);
    contentHtml = await injectLinkText(contentHtml, auth);
    sections.push(`# Trang: ${title}\n\n${htmlToText(contentHtml)}`);
  }
  return sections.join('\n\n---\n\n');
}

const AI_SYSTEM_PROMPT = `Bạn là trợ lý hỏi đáp của Wiki Nội Bộ công ty Basso / ShipUS, trả lời câu hỏi của nhân viên bằng tiếng Việt.

QUY TẮC BẮT BUỘC:
1. CHỈ trả lời dựa trên nội dung wiki được cung cấp bên dưới. Tuyệt đối KHÔNG bịa thông tin, KHÔNG dùng kiến thức bên ngoài wiki, KHÔNG suy đoán.
2. Nếu wiki không có thông tin để trả lời, nói rõ: "Thông tin này chưa có trong wiki" và gợi ý người hỏi liên hệ quản lý hoặc nhờ Admin/Editor bổ sung nội dung.
3. Luôn ghi rõ thông tin lấy từ trang nào của wiki (ví dụ: "Theo trang Báo giá, ...").
4. Trả lời ngắn gọn, đúng trọng tâm. Trích đúng con số, mức phí, thời hạn như wiki ghi — không làm tròn hay diễn giải lại số liệu.
5. Nếu câu hỏi không liên quan đến công việc/nội dung wiki, từ chối nhẹ nhàng và nhắc rằng bạn chỉ hỗ trợ hỏi đáp nội dung wiki nội bộ.
6. Nếu câu trả lời dùng thông tin từ hình minh họa (khối [HÌNH MINH HỌA — địa chỉ hình: ...]) hoặc trang web trong link (khối [LINK: ...]), kết thúc câu trả lời bằng dòng "Nguồn:" rồi liệt kê mỗi nguồn trên một dòng theo ĐÚNG định dạng: [HÌNH: địa_chỉ_hình] hoặc [LINK: địa_chỉ_link] — địa chỉ chép nguyên văn từ ngữ cảnh, không tự bịa.
   QUY TẮC CHỌN NGUỒN (rất quan trọng, sai còn tệ hơn không có):
   - CHỈ dẫn hình/link khi chính nội dung trích xuất của hình/link đó là nơi bạn lấy thông tin để trả lời. KHÔNG dẫn hình chỉ vì nó chứa từ khóa giống câu hỏi.
   - Câu trả lời lấy từ phần chữ của trang (ngoài các khối hình/link) → KHÔNG kèm nguồn hình/link nào, kể cả khi gần đó có hình.
   - Hình/link phải nằm trong ĐÚNG trang mà bạn nêu tên trong câu trả lời (ví dụ trả lời "Theo trang Báo hàng về" thì không được dẫn hình của trang Hàng stock).
   - Không chắc chắn → bỏ qua, không thêm dòng "Nguồn:".`;

// POST /api/ask — hỏi đáp AI dựa trên nội dung wiki
app.post('/api/ask', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(503).json({
      error: 'Chưa cấu hình GEMINI_API_KEY trong file .env của server. Liên hệ Admin để bật tính năng này.'
    });
  }
  const { question, history } = req.body || {};
  if (typeof question !== 'string' || !question.trim() || question.length > 4000) {
    return res.status(400).json({ error: 'Câu hỏi không hợp lệ' });
  }
  // Giữ tối đa 6 lượt hội thoại gần nhất để hỏi nối tiếp (Gemini dùng role "model" cho AI)
  const contents = (Array.isArray(history) ? history : [])
    .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .slice(-6)
    .map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content.slice(0, 4000) }] }));
  contents.push({ role: 'user', parts: [{ text: question.trim() }] });

  try {
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(AI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: `${AI_SYSTEM_PROMPT}\n\nNỘI DUNG WIKI:\n\n${await getWikiContext({ cookie: req.headers.cookie || '', host: req.headers.host })}` }]
          },
          contents,
          generationConfig: { maxOutputTokens: 4096, temperature: 0.2 },
        }),
      }
    );
    const data = await apiRes.json().catch(() => ({}));

    if (!apiRes.ok) {
      console.error('Gemini API error:', apiRes.status, data && data.error && data.error.message);
      const msg = apiRes.status === 400 || apiRes.status === 403
        ? 'GEMINI_API_KEY không hợp lệ. Liên hệ Admin kiểm tra lại cấu hình.'
        : apiRes.status === 429
          ? 'AI đang quá tải hoặc hết hạn mức. Vui lòng thử lại sau ít phút.'
          : 'Không gọi được AI lúc này. Vui lòng thử lại sau.';
      return res.status(502).json({ error: msg });
    }

    const candidate = data.candidates && data.candidates[0];
    const answer = candidate && candidate.content && Array.isArray(candidate.content.parts)
      ? candidate.content.parts.map(p => p.text || '').join('').trim()
      : '';
    if (!answer) {
      // Bị chặn bởi bộ lọc an toàn hoặc không có nội dung trả về
      return res.json({ answer: 'Xin lỗi, tôi không thể trả lời câu hỏi này. Bạn thử diễn đạt lại hoặc hỏi nội dung khác trong wiki nhé.' });
    }
    res.json({ answer });
  } catch (err) {
    console.error('AI ask error:', err && err.message);
    res.status(502).json({ error: 'Không gọi được AI lúc này. Vui lòng thử lại sau.' });
  }
});

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
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
