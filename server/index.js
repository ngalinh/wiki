require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CONTENT_DIR = path.join(DATA_DIR, 'content');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// Bootstrap data dirs
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
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

// Gom toàn bộ nội dung wiki: nội dung mặc định trong index.html,
// thay bằng bản đã chỉnh sửa (data/content/*.json) nếu có
function getWikiContext() {
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
5. Nếu câu hỏi không liên quan đến công việc/nội dung wiki, từ chối nhẹ nhàng và nhắc rằng bạn chỉ hỗ trợ hỏi đáp nội dung wiki nội bộ.`;

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
            parts: [{ text: `${AI_SYSTEM_PROMPT}\n\nNỘI DUNG WIKI:\n\n${getWikiContext()}` }]
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
