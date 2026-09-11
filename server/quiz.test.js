const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const mount = require('./quiz');
const seed = require('./quiz-bank.json');
test('quiz bank, authorization, random selection, grading, persistence and snapshots', async () => {
  assert.equal(seed.length, 100); assert.equal(seed.filter(q => q.type === 'mc').length, 70); assert(mount.validateBank(seed));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-quiz-test-'));
  let server;
  async function boot() {
    const app = express(); app.use(express.json());
    mount(app, { dataDir: dir, getUserEmail: req => req.headers['x-test-user'], isAdmin: email => email === 'admin' });
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
    assert.equal(first.questions.filter(q => q.type === 'mc').length, 35);
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
