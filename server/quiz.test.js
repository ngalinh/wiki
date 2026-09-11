const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const mount = require('./quiz');
const seed = require('./quiz-bank.json');
test('quiz bank, authorization, random selection, grading, persistence and snapshots', async () => {
  assert.equal(seed.length, 150); assert.equal(seed.filter(q => q.type === 'mc').length, 105); assert(mount.validateBank(seed));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-quiz-test-'));
  let server;
  async function boot() {
    const app = express(); app.use(express.json());
    mount(app, { dataDir: dir, getUserEmail: req => req.headers['x-test-user'], isAdmin: email => email === 'admin', canManage: email => ['admin', 'editor'].includes(email) });
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  }
  await boot();
  async function call(route, user = 'employee', method = 'GET', body) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/quiz${route}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  }
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'quiz/state.json')));
  try {
    assert.equal((await call('', null)).status, 401);
    assert.equal((await call('/bank')).status, 403);
    assert.equal((await call('/bank', 'employee', 'PUT', { bank: seed, revision: 1 })).status, 403);
    assert.equal((await call('/attempts', 'employee', 'POST', { name: '' })).status, 400);
    let first = (await call('/attempts', 'employee', 'POST', { name: 'Test Employee' })).data;
    assert.equal(first.questions.length, 50); assert.equal(new Set(first.questions.map(q => q.id)).size, 50);
    assert(first.questions.every(q => ['mc', 'tf'].includes(q.type)));
    assert(first.questions.every(q => !('correct' in q) && !('explanation' in q)));
    assert.equal((await call('/attempts', 'employee', 'POST', { name: 'Again' })).data.id, first.id);
    assert.equal((await call(`/attempts/${first.id}/submit`, 'other', 'POST', { answers: [] })).status, 404);
    assert.equal((await call(`/attempts/${first.id}/submit`, 'employee', 'POST', { answers: [] })).status, 400);
    const bank = structuredClone(seed); bank[0].enabled = false;
    bank.forEach(q => { q.correct = (q.correct + 1) % q.options.length; });
    assert.equal((await call('/bank', 'admin', 'PUT', { bank, revision: 1 })).status, 200);
    assert.equal((await call('/bank', 'admin', 'PUT', { bank, revision: 1 })).status, 409);
    const broken = structuredClone(bank); broken.forEach(q => { q.enabled = false; });
    assert.equal((await call('/bank', 'admin', 'PUT', { bank: broken, revision: 2 })).status, 400);
    for (const count of [40, 39, 41, 50, 0]) {
      const a = count === 40 ? first : (await call('/attempts', 'employee', 'POST', { name: 'Test Employee' })).data;
      if (count !== 40) { assert(!a.questions.some(q => q.id === seed[0].id)); assert.notDeepEqual(a.questions.map(q => q.id), first.questions.map(q => q.id)); }
      const stored = state().attempts.find(x => x.id === a.id);
      const answers = stored.questions.map((q, i) => i < count ? q.correct : (q.correct + 1) % q.options.length);
      const result = await call(`/attempts/${a.id}/submit`, 'employee', 'POST', { answers, score: 100 });
      assert.equal(result.status, 200); assert.equal(result.data.score, count * 2);
      assert.equal(result.data.status, count >= 40 ? 'Success' : 'Failed');
      const duplicate = await call(`/attempts/${a.id}/submit`, 'employee', 'POST', { answers: Array(50).fill(0) });
      assert.equal(duplicate.data.score, count * 2);
    }
    assert.equal((await call('/results', 'employee')).data.length, 5);
    assert.equal((await call('/results', 'other')).data.length, 0);
    assert.equal((await call('/results/' + first.id, 'other')).status, 404);
    assert.equal((await call('/results/' + first.id, 'admin')).status, 200);
    assert.equal((await call('/results', 'admin')).data.length, 5);
    await new Promise(resolve => server.close(resolve)); await boot();
    assert.equal((await call('/results')).data.length, 5);
    assert.equal((await call('/bank', 'admin')).data.revision, 2);
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('editors create image questions, paragraph grading and employee isolation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-quiz-editor-'));
  const app = express(); app.use(express.json());
  mount(app, { dataDir: dir, getUserEmail: req => req.headers['x-test-user'], isAdmin: e => e === 'admin', canManage: e => ['admin', 'editor'].includes(e) });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  async function call(route, user, method = 'GET', body) {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/quiz${route}`, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': user }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  }
  try {
    assert.equal((await call('', 'editor')).data.canManage, true);
    assert.equal((await call('', 'employee')).data.canManage, false);
    const paragraph = { type: 'paragraph', source: 'bao-gia', enabled: true, prompt: 'Giải thích cách tính giá về VN.', options: [], correct: null, explanation: 'Tiền hàng và ship web nhân tỷ giá, cộng phụ thu và cước quốc tế.', image: 'uploads/example.jpg', imageAlt: 'Sản phẩm' };
    assert.equal((await call('/questions', 'employee', 'POST', paragraph)).status, 403);
    for (const image of ['javascript:alert(1)', 'https://other.test/image.svg', 'uploads/../../server/data/quiz/state.json', 'uploads/evil.svg'])
      assert.equal((await call('/questions', 'editor', 'POST', { ...paragraph, image })).status, 400);
    assert.equal((await call('/questions', 'editor', 'POST', { ...paragraph, explanation: '' })).status, 400);
    assert.equal((await call('/questions', 'editor', 'POST', paragraph)).status, 201);
    for (const type of ['mc', 'tf']) assert.equal((await call('/questions', 'editor', 'POST', { ...paragraph, type, options: ['Đúng', 'Sai'], correct: 0 })).status, 201);
    const fetched = (await call('/bank', 'editor')).data;
    const bank = fetched.bank.map((q, i) => ({ ...q, enabled: i < 49 || q.type === 'paragraph' }));
    assert.equal((await call('/bank', 'editor', 'PUT', { bank, revision: fetched.revision })).status, 200);
    const active = (await call('/attempts', 'employee', 'POST', { name: 'Employee' })).data;
    assert.equal(active.questions.length, 50); assert.equal(active.questions.filter(q => q.type === 'paragraph').length, 1);
    assert(active.questions.every(q => !('correct' in q) && !('explanation' in q)));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'quiz/state.json'))).attempts[0];
    const answers = saved.questions.map(q => q.type === 'paragraph' ? 'Câu trả lời để giáo viên chấm.' : q.correct);
    const invalid = answers.map(x => typeof x === 'string' ? '   ' : x);
    assert.equal((await call(`/attempts/${active.id}/submit`, 'employee', 'POST', { answers: invalid })).status, 400);
    let result = (await call(`/attempts/${active.id}/submit`, 'employee', 'POST', { answers })).data;
    assert.equal(result.score, 98); assert.equal(result.status, 'Pending review'); assert.equal(result.pendingCount, 1);
    const qid = saved.questions.find(q => q.type === 'paragraph').id;
    assert.equal((await call('/results/' + active.id, 'other')).status, 404);
    assert.equal((await call('/results', 'other')).data.length, 0);
    assert.equal((await call('/results', 'editor')).data.length, 1);
    assert.equal((await call(`/results/${active.id}/grade`, 'employee', 'POST', { grades: { [qid]: 2 } })).status, 403);
    assert.equal((await call(`/results/${active.id}/grade`, 'editor', 'POST', { grades: { [qid]: 1 } })).status, 400);
    assert.equal((await call(`/results/${active.id}/grade`, 'editor', 'POST', { grades: {} })).status, 400);
    result = (await call(`/results/${active.id}/grade`, 'editor', 'POST', { grades: { [qid]: 2 } })).data;
    assert.equal(result.score, 100); assert.equal(result.status, 'Success'); assert.equal(result.gradedBy, 'editor'); assert.equal(result.pendingCount, 0);
    assert.equal((await call('/results/' + active.id, 'employee')).data.score, 100);
    const repeated = (await call(`/attempts/${active.id}/submit`, 'employee', 'POST', { answers: [] })).data;
    assert.equal(repeated.score, 100);
  } finally { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('seed migration preserves edits and snapshots, and runs only once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-quiz-migrate-'));
  const old = structuredClone(seed.slice(0, 100)); old[0].prompt = 'Manager edited this'; old[0].enabled = false;
  old[44] = { ...old[44], prompt: 'Khi thông báo hỗ trợ thêm, cần làm rõ điều gì?', options: ['Đây là ngoại lệ, không phải thông lệ', 'Lần sau luôn được như vậy', 'Mọi khách đều được tự động', 'Không cần nhắc policy'], correct: 0, explanation: 'đây là ngoại lệ chứ ko phải thông lệ' };
  const attempts = [{ id: 'old', questions: [structuredClone(old[44])], score: 80, status: 'Success' }];
  fs.mkdirSync(path.join(dir, 'quiz')); fs.writeFileSync(path.join(dir, 'quiz/state.json'), JSON.stringify({ bank: old, revision: 7, attempts }));
  try {
    const boot = () => mount(express(), { dataDir: dir, getUserEmail: () => null, isAdmin: () => false });
    boot(); let state = JSON.parse(fs.readFileSync(path.join(dir, 'quiz/state.json')));
    assert.equal(state.bank.length, 150); assert.equal(state.revision, 8); assert.equal(state.bank[0].prompt, old[0].prompt); assert.equal(state.bank[0].enabled, false);
    assert.equal(state.bank[44].prompt, seed[44].prompt); assert.deepEqual(state.attempts, attempts);
    boot(); state = JSON.parse(fs.readFileSync(path.join(dir, 'quiz/state.json'))); assert.equal(state.revision, 8); assert.equal(state.bank.length, 150);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pricing answer keys and all referenced images', () => {
  const answers = ['$60.00','$84.00','$40.00','$41.00','$90.00','$20.00','$56.00','$81.00','$72.00','$76.00','$90.00','$42.00','1.977.500 đ','2.628.000 đ','1.503.000 đ','1.293.500 đ','3.125.000 đ','740.000 đ','$60.00','$85.00','120.000 đ','0 đ','477.000 đ','0 đ','2.519.000 đ','110.000 đ','2.808.000 đ','1.541.000 đ','2.177.000 đ','912.500 đ'];
  answers.forEach((answer, i) => { const q = seed[100 + i]; assert.equal(q.options[q.correct], answer, q.id); });
  for (const q of seed.slice(100)) { assert(fs.existsSync(path.join(__dirname, '..', q.image)), q.image); assert.equal(new Set(q.options).size, q.options.length); }
});
