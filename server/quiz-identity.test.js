const { test } = require('node:test');
const assert = require('node:assert/strict');
const identity = require('./quiz-identity');
test('quiz uses only a platform-verified identity, not user-controlled emails or unsigned tokens', async () => {
  const realFetch = global.fetch;
  try {
    global.fetch = async () => { throw Error('should not call without a cookie'); };
    assert.equal(await identity({ headers: { 'x-user-email': 'admin' }, query: { user_email: 'admin' } }), null);
    let captured;
    global.fetch = async (url, options) => { captured = { url, options }; return { ok: true, json: async () => ({ success: true, user: { username: 'Employee@Example.Test' } }) }; };
    assert.equal(await identity({ headers: { cookie: 'unrelated=private; platform_token=opaque', 'x-user-email': 'admin' }, query: { user_email: 'admin' } }), 'employee@example.test');
    assert.equal(captured.options.headers.Cookie, 'platform_token=opaque');
    global.fetch = async () => ({ status: 401, ok: false });
    assert.equal(await identity({ headers: { cookie: 'platform_token=forged' } }), null);
    global.fetch = async () => ({ status: 500, ok: false });
    await assert.rejects(identity({ headers: { cookie: 'platform_token=opaque' } }));
  } finally { global.fetch = realFetch; }
});
