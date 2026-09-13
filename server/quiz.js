const fs = require('fs');
const path = require('path');
const { randomUUID, randomInt } = require('crypto');
const seed = require('./quiz-bank.json');
const previousPricing = require('./quiz-bank-v2-pricing.json');
const QUOTAS = { short: 20, mc: 20, paragraph: 5, tf: 5 };
const TYPE_NAMES = { short: 'trả lời ngắn', mc: 'trắc nghiệm', paragraph: 'tự luận', tf: 'đúng/sai' };
const SOURCES = new Set(seed.map(q => q.source));
function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function validImage(value) {
  return !value || (typeof value === 'string' && /^(?:assets\/quiz\/[\w.-]+|uploads\/[\w.-]+)\.(?:png|jpg|jpeg|gif|webp)$/.test(value));
}
function validateBank(bank) {
  return Array.isArray(bank) && bank.length <= 2000 && bank.every(q => q && typeof q === 'object') && new Set(bank.map(q => q.id)).size === bank.length && bank.every(q =>
    q && typeof q.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(q.id) &&
    ['mc', 'tf', 'paragraph', 'short'].includes(q.type) && typeof q.enabled === 'boolean' && SOURCES.has(q.source) &&
    typeof q.prompt === 'string' && q.prompt.trim() && q.prompt.length <= 2000 &&
    typeof q.explanation === 'string' && q.explanation.trim() && q.explanation.length <= 3000 && validImage(q.image) &&
    (!q.imageAlt || (typeof q.imageAlt === 'string' && q.imageAlt.length <= 200)) &&
    (!q.productUrl || (typeof q.productUrl === 'string' && q.productUrl.length <= 1000 && /^https:\/\/[^\s]+$/.test(q.productUrl))) &&
    (q.otherOption === undefined || (q.type === 'mc' && Array.isArray(q.options) && Number.isInteger(q.otherOption) && q.otherOption >= 0 && q.otherOption < q.options.length)) &&
    Array.isArray(q.options) && (['paragraph', 'short'].includes(q.type)
      ? q.options.length === 0 && q.correct === null
      : q.options.length >= 2 && q.options.length <= 8 &&
        q.options.every(o => typeof o === 'string' && o.trim() && o.length <= 500) &&
        new Set(q.options.map(o => o.trim())).size === q.options.length &&
        (q.type !== 'tf' || (q.options.length === 2 && q.options[0] === 'Đúng' && q.options[1] === 'Sai')) &&
        (q.correct === null || (Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length))));
}
function cleanQuestion(q) {
  const { id, type, source, prompt, options, correct, explanation, image = '', imageAlt = '', productUrl = '' } = q;
  return { id, type, source, prompt, options, correct, enabled: true, explanation, image, imageAlt, productUrl, ...(q.otherOption === undefined ? {} : { otherOption: q.otherOption }) };
}
function grade(a, grades = a.grades || {}) {
  const points = a.questions.map((q, i) => q.correct === null ? (grades[q.id] ?? null) : (q.correct === (typeof a.answers[i] === 'object' ? a.answers[i].option : a.answers[i]) ? 2 : 0));
  const pendingCount = points.filter(p => p === null).length;
  const score = points.reduce((sum, p) => sum + (p || 0), 0);
  return { ...a, grades, points, pendingCount, correctCount: points.filter(p => p === 2).length,
    score, status: pendingCount ? 'Pending review' : score >= 80 ? 'Success' : 'Failed' };
}
module.exports = function mountQuiz(app, { dataDir, getUserEmail, isAdmin, canManage = isAdmin }) {
  const dir = path.join(dataDir, 'quiz');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'state.json');
  let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { bank: seed, revision: 1, attempts: [], seedVersion: 5 };
  function commit(next) {
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(next));
    fs.renameSync(temp, file);
    state = next;
  }
  // Append new bundled questions once; preserve edits and all attempt snapshots.
  if (!state.seedVersion || state.seedVersion < 2) {
    const ids = new Set(state.bank.map(q => q.id));
    const bank = state.bank.map(q => q.id === 'q045' && q.prompt === 'Khi thông báo hỗ trợ thêm, cần làm rõ điều gì?' && q.correct === 0 && q.explanation === 'đây là ngoại lệ chứ ko phải thông lệ' && JSON.stringify(q.options) === JSON.stringify(['Đây là ngoại lệ, không phải thông lệ', 'Lần sau luôn được như vậy', 'Mọi khách đều được tự động', 'Không cần nhắc policy']) ? { ...seed.find(s => s.id === q.id), enabled: q.enabled } : q);
    bank.push(...seed.filter(q => !ids.has(q.id)));
    commit({ ...state, bank, seedVersion: 2, revision: state.revision + 1 });
  }
  // Replace only unchanged bundled pricing exercises; retain manager edits and attempts.
  if (state.seedVersion < 3) {
    const ids = new Set(state.bank.map(q => q.id));
    const bank = state.bank.map(q => {
      const previous = previousPricing.find(p => p.id === q.id);
      if (!previous) return q;
      const unchanged = Object.entries(cleanQuestion(previous)).every(([key, value]) => key === 'enabled' || JSON.stringify(cleanQuestion(q)[key]) === JSON.stringify(value));
      const replacement = seed.find(s => s.id === q.id);
      return unchanged && replacement ? { ...replacement, enabled: q.enabled } : q;
    });
    bank.push(...seed.filter(q => !ids.has(q.id)));
    commit({ ...state, bank, seedVersion: 3, revision: state.revision + 1 });
  }
  // Restore the source form verbatim as requested; retain inclusion choices and all past attempts.
  if (state.seedVersion < 4) {
    const bank = state.bank.map(q => {
      const replacement = seed.find(s => s.id === q.id && s.id.startsWith('form-'));
      return replacement ? { ...replacement, enabled: q.enabled } : q;
    });
    commit({ ...state, bank, seedVersion: 4, revision: state.revision + 1 });
  }
  // Remove exactly the 50 withdrawn rewrites; keep original form questions and attempt snapshots.
  if (state.seedVersion < 5) {
    const bank = state.bank.filter(q => !/^q(?:10[1-9]|1[1-4][0-9]|150)$/.test(q.id));
    commit({ ...state, bank, seedVersion: 5, revision: state.revision + 1 });
  }
  // Fill only missing answers for unchanged questions; never overwrite manager answers or resurrect deletions.
  const answerUpdates = require('./quiz-answer-updates.json');
  const normalizePrompt = value => value.replace(/^\s*\d+\s*[.)]\s*/, '').trim();
  let answersUpdated = false;
  const answeredBank = state.bank.map(q => {
    const update = answerUpdates.find(u => u.id === q.id && normalizePrompt(u.prompt) === normalizePrompt(q.prompt));
    if (!update || q.correct !== null || (q.explanation.trim() && q.explanation !== update.previousExplanation) ||
        (!['short', 'paragraph'].includes(q.type) && JSON.stringify(q.options) !== JSON.stringify(update.options))) return q;
    answersUpdated = true;
    return { ...q, explanation: update.explanation, source: update.source,
      correct: ['mc', 'tf'].includes(q.type) ? update.correct : null };
  });
  if (answersUpdated) commit({ ...state, bank: answeredBank, revision: state.revision + 1 });
  // All bank questions participate, including previously disabled questions.
  if (state.bank.some(q => !q.enabled)) {
    commit({ ...state, bank: state.bank.map(q => ({ ...q, enabled: true })), revision: state.revision + 1 });
  }
  function currentQuestions() {
    const pool = state.bank;
    const missing = Object.entries(QUOTAS).filter(([type, count]) => pool.filter(q => q.type === type).length < count);
    if (missing.length) throw Error('Ngân hàng chưa đủ câu: ' + missing.map(([type, count]) => `${TYPE_NAMES[type]} cần ${count}, hiện có ${pool.filter(q => q.type === type).length}`).join('; ') + '. Admin / Editor cần tạo thêm hoặc đổi loại câu hỏi.');
    const questions = shuffle(Object.entries(QUOTAS).flatMap(([type, count]) => shuffle(pool.filter(q => q.type === type)).slice(0, count))).map(q => {
      if (['paragraph', 'short'].includes(q.type)) return { ...q };
      const indices = q.options.map((_, i) => i);
      const order = q.type === 'mc' && !q.id.startsWith('form-') ? shuffle(indices) : indices;
      return { ...q, options: order.map(i => q.options[i]), correct: q.correct === null ? null : order.indexOf(q.correct), ...(q.otherOption === undefined ? {} : { otherOption: order.indexOf(q.otherOption) }) };
    });
    return questions;
  }
  function refreshActive(a) {
    if (!a || a.submittedAt || a.abandonedAt || a.bankRevision === state.revision) return a;
    const updated = { ...a, questions: currentQuestions(), bankRevision: state.revision };
    commit({ ...state, attempts: state.attempts.map(x => x.id === a.id ? updated : x) });
    return updated;
  }
  function summary(a) {
    return { id: a.id, name: a.name, email: a.email, startedAt: a.startedAt, submittedAt: a.submittedAt,
      score: a.score, correctCount: a.correctCount, status: a.status, pendingCount: a.pendingCount || 0, gradedBy: a.gradedBy, gradedAt: a.gradedAt };
  }
  function publicAttempt(a) {
    return { ...summary(a), bankRevision: a.bankRevision, questions: a.questions.map(({ correct, explanation, ...q }) => ({ ...q, manualReview: correct === null })) };
  }
  app.use('/api/quiz', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { req.quizEmail = await getUserEmail(req); } catch { return res.status(503).json({ error: 'Không xác minh được phiên đăng nhập. Vui lòng thử lại.' }); }
    if (!req.quizEmail) return res.status(401).json({ error: 'Vui lòng đăng nhập dashboard để làm bài và lưu kết quả.' });
    next();
  });
  app.get('/api/quiz', (req, res) => {
    const mc = state.bank.filter(q => q.type === 'mc').length;
    const tf = state.bank.filter(q => q.type === 'tf').length;
    let active = state.attempts.find(a => a.email === req.quizEmail && !a.submittedAt && !a.abandonedAt);
    let refreshError;
    try { active = refreshActive(active); } catch (e) { refreshError = e.message; active = null; }
    res.json({ refreshError, canManage: canManage(req.quizEmail), email: req.quizEmail, available: { mc, tf, paragraph: state.bank.filter(q => q.type === 'paragraph').length, short: state.bank.filter(q => q.type === 'short').length }, active: active ? publicAttempt(active) : null });
  });
  app.get('/api/quiz/bank', (req, res) => {
    if (!canManage(req.quizEmail)) return res.status(403).json({ error: 'Chỉ Admin và Editor được quản lý câu hỏi.' });
    res.json({ bank: state.bank, revision: state.revision });
  });
  app.put('/api/quiz/bank', (req, res) => {
    if (!canManage(req.quizEmail)) return res.status(403).json({ error: 'Chỉ Admin và Editor được quản lý câu hỏi.' });
    const { bank, revision } = req.body;
    if (revision !== state.revision) return res.status(409).json({ error: 'Ngân hàng đã được người khác sửa. Tải lại trước khi lưu.' });
    if (!validateBank(bank)) return res.status(400).json({ error: 'Ngân hàng tối đa 2000 câu; nội dung, loại câu, hình ảnh và đáp án phải hợp lệ.' });
    const clean = bank.map(cleanQuestion);
    commit({ ...state, bank: clean, revision: state.revision + 1 });
    res.json({ revision: state.revision });
  });
  app.post('/api/quiz/attempts', (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 120) return res.status(400).json({ error: 'Nhập họ tên (tối đa 120 ký tự).' });
    let active = state.attempts.find(a => a.email === req.quizEmail && !a.submittedAt && !a.abandonedAt);
    try { active = refreshActive(active); } catch (e) { return res.status(409).json({ error: e.message }); }
    if (req.body.replaceAttemptId && (!active || active.id !== req.body.replaceAttemptId)) return res.status(409).json({ error: 'Đề đã thay đổi. Tải lại trước khi tạo đề mới.' });
    if (active && !req.body.replaceAttemptId) return res.json(publicAttempt(active));
    let questions;
    try { questions = currentQuestions(); } catch (e) { return res.status(409).json({ error: e.message }); }
    const attempt = { id: randomUUID(), email: req.quizEmail, name, startedAt: new Date().toISOString(), questions, bankRevision: state.revision };
    commit({ ...state, attempts: [...state.attempts.map(a => active && a.id === active.id ? { ...a, abandonedAt: new Date().toISOString() } : a), attempt] });
    res.status(201).json(publicAttempt(attempt));
  });
  app.post('/api/quiz/attempts/:id/submit', (req, res) => {
    const a = state.attempts.find(a => a.id === req.params.id && a.email === req.quizEmail);
    if (!a) return res.status(404).json({ error: 'Không tìm thấy bài làm.' });
    if (a.abandonedAt) return res.status(409).json({ error: 'Đề này đã được thay bằng đề mới. Vui lòng tải lại.' });
    if (a.submittedAt) return res.json({ ...summary(a), questions: a.questions, answers: a.answers, points: a.points });
    if (a.bankRevision !== state.revision || (req.body.bankRevision !== undefined && req.body.bankRevision !== a.bankRevision)) {
      try { refreshActive(a); } catch (e) { return res.status(409).json({ error: e.message }); }
      return res.status(409).json({ error: 'Ngân hàng đã cập nhật. Đề được làm mới; vui lòng kiểm tra và trả lời đề mới.' });
    }
    const answers = req.body.answers;
    if (!Array.isArray(answers) || answers.length !== 50 || answers.some((v, i) => ['paragraph', 'short'].includes(a.questions[i].type) ? typeof v !== 'string' || !v.trim() || v.length > 5000 : (v && typeof v === 'object' ? !Number.isInteger(a.questions[i].otherOption) || !Number.isInteger(v.option) || v.option !== a.questions[i].otherOption || typeof v.text !== 'string' || !v.text.trim() || v.text.length > 5000 : !Number.isInteger(v) || v < 0 || v >= a.questions[i].options.length || v === a.questions[i].otherOption)))
      return res.status(400).json({ error: 'Vui lòng trả lời đủ 50 câu trước khi nộp.' });
    const result = grade({ ...a, answers, submittedAt: new Date().toISOString() });
    commit({ ...state, attempts: state.attempts.map(x => x.id === a.id ? result : x) });
    res.json({ ...summary(result), questions: result.questions, answers: result.answers, points: result.points });
  });
  app.delete('/api/quiz/questions/:id', (req, res) => {
    if (!canManage(req.quizEmail)) return res.status(403).json({ error: 'Chỉ Admin và Editor được xóa câu hỏi.' });
    if (req.body.revision !== state.revision) return res.status(409).json({ error: 'Ngân hàng đã thay đổi. Tải lại trước khi xóa.' });
    if (!state.bank.some(q => q.id === req.params.id)) return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
    commit({ ...state, bank: state.bank.filter(q => q.id !== req.params.id), revision: state.revision + 1 });
    res.json({ revision: state.revision });
  });
  app.post('/api/quiz/questions', (req, res) => {
    if (!canManage(req.quizEmail)) return res.status(403).json({ error: 'Chỉ Admin và Editor được tạo câu hỏi.' });
    const question = cleanQuestion({ ...req.body, id: 'custom-' + randomUUID() });
    if (!validateBank([...state.bank, question])) return res.status(400).json({ error: 'Kiểm tra nội dung, đáp án, giải thích và hình ảnh của câu hỏi.' });
    commit({ ...state, bank: [...state.bank, question], revision: state.revision + 1 });
    res.status(201).json({ question, revision: state.revision });
  });
  app.post('/api/quiz/results/:id/grade', (req, res) => {
    if (!canManage(req.quizEmail)) return res.status(403).json({ error: 'Chỉ Admin và Editor được chấm bài.' });
    const a = state.attempts.find(a => a.id === req.params.id && a.submittedAt);
    if (!a) return res.status(404).json({ error: 'Không tìm thấy bài làm.' });
    const grades = req.body.grades;
    const paragraphs = a.questions.filter(q => q.correct === null);
    if (!grades || typeof grades !== 'object' || Array.isArray(grades) ||
        Object.keys(grades).length !== paragraphs.length || !paragraphs.length ||
        !paragraphs.every(q => Object.hasOwn(grades, q.id) && [0, 2].includes(grades[q.id])))
      return res.status(400).json({ error: 'Chấm đủ câu cần duyệt: đúng 2 điểm hoặc sai 0 điểm.' });
    const result = grade({ ...a, gradedBy: req.quizEmail, gradedAt: new Date().toISOString() }, grades);
    commit({ ...state, attempts: state.attempts.map(x => x.id === a.id ? result : x) });
    res.json({ ...summary(result), questions: result.questions, answers: result.answers, points: result.points });
  });
  app.get('/api/quiz/results', (req, res) => {
    res.json(state.attempts.filter(a => a.submittedAt && (canManage(req.quizEmail) || a.email === req.quizEmail)).map(summary).reverse());
  });
  app.get('/api/quiz/results/:id', (req, res) => {
    const a = state.attempts.find(a => a.id === req.params.id && a.submittedAt && (canManage(req.quizEmail) || a.email === req.quizEmail));
    if (!a) return res.status(404).json({ error: 'Không tìm thấy kết quả.' });
    res.json({ ...summary(a), questions: a.questions, answers: a.answers, points: a.points });
  });
};
module.exports.validateBank = validateBank;
