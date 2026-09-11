const fs = require('fs');
const path = require('path');
const { randomUUID, randomInt } = require('crypto');
const seed = require('./quiz-bank.json');
const SOURCES = new Set(seed.map(q => q.source));
function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function validateBank(bank) {
  return Array.isArray(bank) && bank.length === 100 && new Set(bank.map(q => q.id)).size === 100 &&
    bank.filter(q => q.type === 'mc').length === 70 && bank.filter(q => q.type === 'tf').length === 30 && bank.every(q =>
      seed.some(s => s.id === q.id && s.type === q.type) && typeof q.enabled === 'boolean' && SOURCES.has(q.source) &&
      typeof q.prompt === 'string' && q.prompt.trim() && q.prompt.length <= 1000 &&
      typeof q.explanation === 'string' && q.explanation.trim() && q.explanation.length <= 3000 &&
      Array.isArray(q.options) && q.options.length === (q.type === 'mc' ? 4 : 2) &&
      q.options.every(o => typeof o === 'string' && o.trim() && o.length <= 500) &&
      new Set(q.options.map(o => o.trim())).size === q.options.length &&
      (q.type !== 'tf' || (q.options[0] === 'Đúng' && q.options[1] === 'Sai')) &&
      Number.isInteger(q.correct) && q.correct >= 0 && q.correct < q.options.length);
}
module.exports = function mountQuiz(app, { dataDir, getUserEmail, isAdmin }) {
  const dir = path.join(dataDir, 'quiz');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'state.json');
  let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { bank: seed, revision: 1, attempts: [] };
  function commit(next) {
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(next));
    fs.renameSync(temp, file);
    state = next;
  }
  function summary(a) {
    return { id: a.id, name: a.name, email: a.email, startedAt: a.startedAt, submittedAt: a.submittedAt,
      score: a.score, correctCount: a.correctCount, status: a.status };
  }
  function publicAttempt(a) {
    return { ...summary(a), questions: a.questions.map(({ correct, explanation, ...q }) => q) };
  }
  app.use('/api/quiz', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    req.quizEmail = getUserEmail(req);
    if (!req.quizEmail) return res.status(401).json({ error: 'Vui lòng đăng nhập dashboard để làm bài và lưu kết quả.' });
    next();
  });
  app.get('/api/quiz', (req, res) => {
    const mc = state.bank.filter(q => q.enabled && q.type === 'mc').length;
    const tf = state.bank.filter(q => q.enabled && q.type === 'tf').length;
    const active = state.attempts.find(a => a.email === req.quizEmail && !a.submittedAt);
    res.json({ isAdmin: isAdmin(req.quizEmail), email: req.quizEmail, available: { mc, tf }, active: active ? publicAttempt(active) : null });
  });
  app.get('/api/quiz/bank', (req, res) => {
    if (!isAdmin(req.quizEmail)) return res.status(403).json({ error: 'Chỉ Admin được quản lý câu hỏi.' });
    res.json({ bank: state.bank, revision: state.revision });
  });
  app.put('/api/quiz/bank', (req, res) => {
    if (!isAdmin(req.quizEmail)) return res.status(403).json({ error: 'Chỉ Admin được quản lý câu hỏi.' });
    const { bank, revision } = req.body;
    if (revision !== state.revision) return res.status(409).json({ error: 'Ngân hàng đã được người khác sửa. Tải lại trước khi lưu.' });
    if (!validateBank(bank)) return res.status(400).json({ error: 'Cần đủ 70 câu trắc nghiệm, 30 câu đúng/sai; nội dung, lựa chọn và đáp án phải hợp lệ.' });
    if (bank.filter(q => q.enabled && q.type === 'mc').length < 35 || bank.filter(q => q.enabled && q.type === 'tf').length < 15)
      return res.status(400).json({ error: 'Cần chọn ít nhất 35 câu trắc nghiệm và 15 câu đúng/sai để tạo đề.' });
    const clean = bank.map(({ id, type, source, prompt, options, correct, enabled, explanation }) => ({ id, type, source, prompt, options, correct, enabled, explanation }));
    commit({ ...state, bank: clean, revision: state.revision + 1 });
    res.json({ revision: state.revision });
  });
  app.post('/api/quiz/attempts', (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 120) return res.status(400).json({ error: 'Nhập họ tên (tối đa 120 ký tự).' });
    const active = state.attempts.find(a => a.email === req.quizEmail && !a.submittedAt);
    if (active) return res.json(publicAttempt(active));
    const mc = state.bank.filter(q => q.enabled && q.type === 'mc');
    const tf = state.bank.filter(q => q.enabled && q.type === 'tf');
    if (mc.length < 35 || tf.length < 15) return res.status(409).json({ error: 'Ngân hàng chưa đủ câu đang được chọn.' });
    const questions = shuffle([...shuffle(mc).slice(0, 35), ...shuffle(tf).slice(0, 15)]).map(q => {
      const order = q.type === 'mc' ? shuffle(q.options.map((_, i) => i)) : [0, 1];
      return { ...q, options: order.map(i => q.options[i]), correct: order.indexOf(q.correct) };
    });
    const attempt = { id: randomUUID(), email: req.quizEmail, name, startedAt: new Date().toISOString(), questions };
    commit({ ...state, attempts: [...state.attempts, attempt] });
    res.status(201).json(publicAttempt(attempt));
  });
  app.post('/api/quiz/attempts/:id/submit', (req, res) => {
    const a = state.attempts.find(a => a.id === req.params.id && a.email === req.quizEmail);
    if (!a) return res.status(404).json({ error: 'Không tìm thấy bài làm.' });
    if (a.submittedAt) return res.json({ ...summary(a), questions: a.questions, answers: a.answers });
    const answers = req.body.answers;
    if (!Array.isArray(answers) || answers.length !== 50 || answers.some((v, i) => !Number.isInteger(v) || v < 0 || v >= a.questions[i].options.length))
      return res.status(400).json({ error: 'Vui lòng trả lời đủ 50 câu trước khi nộp.' });
    const correctCount = a.questions.filter((q, i) => q.correct === answers[i]).length;
    const score = correctCount * 2;
    const result = { ...a, answers, correctCount, score, status: score >= 80 ? 'Success' : 'Failed', submittedAt: new Date().toISOString() };
    commit({ ...state, attempts: state.attempts.map(x => x.id === a.id ? result : x) });
    res.json({ ...summary(result), questions: result.questions, answers: result.answers });
  });
  app.get('/api/quiz/results', (req, res) => {
    res.json(state.attempts.filter(a => a.submittedAt && (isAdmin(req.quizEmail) || a.email === req.quizEmail)).map(summary).reverse());
  });
  app.get('/api/quiz/results/:id', (req, res) => {
    const a = state.attempts.find(a => a.id === req.params.id && a.submittedAt && (isAdmin(req.quizEmail) || a.email === req.quizEmail));
    if (!a) return res.status(404).json({ error: 'Không tìm thấy kết quả.' });
    res.json({ ...summary(a), questions: a.questions, answers: a.answers });
  });
};
module.exports.validateBank = validateBank;
