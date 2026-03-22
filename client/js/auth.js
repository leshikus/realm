/**
 * auth.js — GitHub OAuth PKCE login flow.
 * No CLIENT_SECRET required; works from any static page.
 *
 * Usage:
 *   On page load:  const token = await handleCallback();
 *   On login btn:  await startLogin();
 */

const CLIENT_ID = 'https://leshikus.github.io/realm';
const SCOPES    = 'repo';

function redirectUri() {
  // Strips trailing slash so GitHub's registered callback matches exactly.
  return window.location.origin + window.location.pathname.replace(/\/$/, '');
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function randomVerifier() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return base64url(b);
}

async function deriveChallenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(hash));
}

/**
 * Redirect the browser to GitHub's OAuth consent screen.
 * Stores the PKCE verifier and state in sessionStorage before leaving.
 */
export async function startLogin() {
  const verifier = randomVerifier();
  const state    = crypto.randomUUID();
  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('pkce_state',    state);

  const q = new URLSearchParams({
    client_id:             CLIENT_ID,
    redirect_uri:          redirectUri(),
    scope:                 SCOPES,
    state,
    code_challenge:        await deriveChallenge(verifier),
    code_challenge_method: 'S256',
  });
  window.location.href = `https://github.com/login/oauth/authorize?${q}`;
}

/**
 * Call on every page load.
 * If the URL contains ?code=..., exchanges it for an access token, cleans the
 * URL, and returns the token string.  Returns null if no callback is present.
 * Throws on state mismatch or GitHub error.
 */
export async function handleCallback() {
  const p    = new URLSearchParams(window.location.search);
  const code = p.get('code');
  if (!code) return null;

  const state = p.get('state');
  if (state !== sessionStorage.getItem('pkce_state')) {
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('pkce_state');
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const verifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('pkce_state');
  history.replaceState(null, '', location.pathname);  // strip ?code= from URL

  const res  = await fetch('https://github.com/login/oauth/access_token', {
    method:  'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     CLIENT_ID,
      code,
      redirect_uri:  redirectUri(),
      code_verifier: verifier,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data.access_token;
}
