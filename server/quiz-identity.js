// Quiz/result access must use a verified session, never a query email.
// A locally-issued wiki_session cookie (server/wiki-auth.js) counts as verified
// too — it's used by probation-hire accounts that have no Basso/Dashboard login.
const wikiAuth = require('./wiki-auth');
module.exports = async function quizIdentity(req) {
  const local = wikiAuth.emailFromRequest(req);
  if (local) return local;
  const cookie = /(?:^|;\s*)platform_token=([^;]+)/.exec(req.headers.cookie || '');
  if (!cookie) return null;
  const response = await fetch(process.env.BASSO_AUTH_URL || 'https://ai.basso.vn/platform/api/auth/session', {
    headers: { Cookie: 'platform_token=' + cookie[1], Accept: 'application/json' },
    signal: AbortSignal.timeout(10000), redirect: 'error'
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw Error('Platform session verification failed');
  const data = await response.json();
  return data.success === true && typeof data.user?.username === 'string' ? data.user.username.trim().toLowerCase() || null : null;
};
