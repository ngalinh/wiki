const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const mount = require('./quiz');
const seed = require('./quiz-bank.json');
test('quiz bank, authorization, random selection, grading, persistence and snapshots', async () => {
  assert.equal(seed.length, 200); assert.equal(seed.filter(q => q.type === 'mc').length, 105); assert(mount.validateBank(seed));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-quiz-test-'));
  const autoBank = seed.map(q => ({ ...q, enabled: q.correct !== null }));
  fs.mkdirSync(path.join(dir, 'quiz')); fs.writeFileSync(path.join(dir, 'quiz/state.json'), JSON.stringify({ bank: autoBank, revision: 1, seedVersion: 4, attempts: [] }));
  let server;
  async function boot() {
    const app = express(); app.use(express.json({ limit: '2mb' }));
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
    const bank = structuredClone(autoBank); bank[0].enabled = false;
    bank.forEach(q => { if (q.correct !== null) q.correct = (q.correct + 1) % q.options.length; });
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
  const app = express(); app.use(express.json({ limit: '2mb' }));
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
    const bank = fetched.bank.map((q, i) => ({ ...q, enabled: i < 49 || q.id.startsWith('custom-') && q.type === 'paragraph' }));
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
    assert.equal(state.bank.length, 200); assert.equal(state.revision, 10); assert.equal(state.bank[0].prompt, old[0].prompt); assert.equal(state.bank[0].enabled, false);
    assert.equal(state.bank[44].prompt, seed[44].prompt); assert.deepEqual(state.attempts, attempts);
    boot(); state = JSON.parse(fs.readFileSync(path.join(dir, 'quiz/state.json'))); assert.equal(state.revision, 10); assert.equal(state.bank.length, 200);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('form import and screenshot pricing exercises are complete', () => {
  const form = seed.filter(q => q.id.startsWith('form-'));
  assert.equal(form.length, 50); assert(form.every(q => q.correct === null));
  for (let i = 1; i <= 50; i++) assert(form.some(q => q.id === 'form-' + String(i).padStart(3, '0')));
  assert.equal(form.filter(q => q.image).length, 14);
  const pricing = seed.slice(100, 150);
  assert.equal(pricing.length, 50);
  assert(pricing.every(q => q.image.startsWith('assets/quiz/form-') && !q.prompt.includes('Giá giả định')));
  assert.equal(new Set(pricing.map(q => q.prompt)).size, 50);
  for (const q of seed.filter(q => q.image)) assert(fs.existsSync(path.join(__dirname, '..', q.image)), q.image);
});

test('v3 migration replaces old prices, preserves edited questions and historical attempts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-quiz-v3-'));
  const previous = require('./quiz-bank-v2-pricing.json');
  const bank = structuredClone([...seed.slice(0, 100), ...previous]);
  bank[100].enabled = false; bank[101].prompt = 'Manager custom pricing';
  const attempts = [{ id: 'snapshot', questions: [structuredClone(bank[100])] }];
  fs.mkdirSync(path.join(dir, 'quiz'));
  const file = path.join(dir, 'quiz/state.json');
  fs.writeFileSync(file, JSON.stringify({ bank, seedVersion: 2, revision: 5, attempts }));
  const boot = () => mount(express(), { dataDir: dir, getUserEmail: () => null, isAdmin: () => false });
  try {
    boot(); const state = JSON.parse(fs.readFileSync(file));
    assert.equal(state.bank.length, 200); assert.equal(state.seedVersion, 4); assert.equal(state.revision, 7);
    assert.equal(state.bank[100].prompt, seed[100].prompt); assert.equal(state.bank[100].enabled, false);
    assert.equal(state.bank[101].prompt, 'Manager custom pricing'); assert.deepEqual(state.attempts, attempts);
    boot(); assert.deepEqual(JSON.parse(fs.readFileSync(file)), state);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('form questions match the source exactly; v4 migration preserves attempt snapshots', () => {
  const source = require('./quiz-form-source.json');
  for (const expected of source) {
    const q = seed.find(q => q.id === expected.id);
    for (const key of ['prompt', 'type', 'options', 'otherOption', 'imageAlt']) assert.deepEqual(q[key], expected[key], `${q.id}: ${key}`);
  }
  assert.equal(source.filter(q => q.type === 'mc').length, 9);
  assert.equal(source.filter(q => q.type === 'paragraph').length, 24);
  assert.equal(source.filter(q => q.type === 'short').length, 17);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-quiz-v4-'));
  const bank = structuredClone(seed); bank[0].prompt = 'Unrelated manager edit';
  bank[150].prompt = 'Old rewritten form wording'; bank[150].enabled = false;
  const attempts = [{ id: 'historical', questions: [structuredClone(bank[150])], answers: ['Historical answer'], score: 80 }];
  fs.mkdirSync(path.join(dir, 'quiz')); const file = path.join(dir, 'quiz/state.json');
  fs.writeFileSync(file, JSON.stringify({ bank, attempts, revision: 12, seedVersion: 3 }));
  const boot = () => mount(express(), { dataDir: dir, getUserEmail: () => null, isAdmin: () => false });
  try {
    boot(); const state = JSON.parse(fs.readFileSync(file));
    assert.equal(state.bank[0].prompt, bank[0].prompt); assert.equal(state.bank[150].enabled, false);
    assert.equal(state.bank[150].prompt, seed[150].prompt); assert.deepEqual(state.attempts, attempts);
    assert.equal(state.revision, 13); assert.equal(state.seedVersion, 4);
    boot(); assert.deepEqual(JSON.parse(fs.readFileSync(file)), state);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('short answers and Other choices are validated, saved and manually graded', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-quiz-other-'));
  fs.mkdirSync(path.join(dir, 'quiz'));
  fs.writeFileSync(path.join(dir, 'quiz/state.json'), JSON.stringify({ bank: seed.map(q => ({ ...q, enabled: q.id.startsWith('form-') })), attempts: [], revision: 1, seedVersion: 4 }));
  const app = express(); app.use(express.json());
  mount(app, { dataDir: dir, getUserEmail: req => req.headers['x-test-user'], isAdmin: e => e === 'admin' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  async function call(route, body, user = 'employee') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quiz${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': user }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  try {
    const a = (await call('/attempts', { name: 'Local test' })).data;
    const answers = a.questions.map(q => ['short', 'paragraph'].includes(q.type) ? 'Written answer' : q.otherOption !== undefined ? { option: q.otherOption, text: 'Other answer' } : 0);
    for (let i = 0; i < a.questions.length; i++) assert.deepEqual(a.questions[i].options, seed.find(q => q.id === a.questions[i].id).options);
    const other = a.questions.findIndex(q => q.otherOption !== undefined), short = a.questions.findIndex(q => q.type === 'short'), closed = a.questions.findIndex(q => q.type === 'mc' && q.otherOption === undefined);
    for (const [index, value] of [[other, { option: a.questions[other].otherOption, text: ' ' }], [other, a.questions[other].otherOption], [short, ' '], [closed, { text: 'Forged' }]]) {
      const invalid = structuredClone(answers); invalid[index] = value;
      assert.equal((await call(`/attempts/${a.id}/submit`, { answers: invalid })).status, 400);
    }
    const submitted = await call(`/attempts/${a.id}/submit`, { answers });
    assert.equal(submitted.status, 200); assert.equal(submitted.data.pendingCount, 50); assert.deepEqual(submitted.data.answers, answers);
    const result = await call(`/results/${a.id}/grade`, { grades: Object.fromEntries(a.questions.map(q => [q.id, 2])) }, 'admin');
    assert.equal(result.status, 200); assert.equal(result.data.score, 100); assert.equal(result.data.status, 'Success');
  } finally { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
