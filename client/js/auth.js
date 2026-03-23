/**
 * auth.js — GitHub OAuth web flow.
 *
 * CLIENT_ID and CLIENT_SECRET are stored in localStorage by the player on
 * first run. Each player registers their own GitHub OAuth App and enters the
 * credentials once. See docs/oauth.md § Security Notes for the rationale.
 *
 * Usage:
 *   startLogin()                          — redirects to GitHub
 *   const token = await handleCallback() — null if not a callback
 */

const SCOPES = 'repo';

export function getOAuthApp() {
  const raw = localStorage.getItem('conspiracy_oauth_app');
  return raw ? JSON.parse(raw) : null;
}

export function saveOAuthApp(clientId, clientSecret) {
  localStorage.setItem('conspiracy_oauth_app', JSON.stringify({ clientId, clientSecret }));
}

export function clearOAuthApp() {
  localStorage.removeItem('conspiracy_oauth_app');
}

function redirectUri() {
  return window.location.origin + window.location.pathname.replace(/\/$/, '');
}

/** Redirect the browser to GitHub's OAuth consent screen. */
export function startLogin() {
  const { clientId } = getOAuthApp();
  const state = crypto.randomUUID();
  sessionStorage.setItem('oauth_state', state);
  const q = new URLSearchParams({
    client_id:    clientId,
    redirect_uri: redirectUri(),
    scope:        SCOPES,
    state,
  });
  window.location.href = `https://github.com/login/oauth/authorize?${q}`;
}

/**
 * Call on every page load.
 * If the URL contains ?code=..., exchanges it for an access token, cleans the
 * URL, and returns the token string. Returns null if not a callback.
 */
export async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  const error  = params.get('error');

  if (error) {
    history.replaceState(null, '', location.pathname);
    throw new Error(params.get('error_description') ?? error);
  }

  if (!code) return null;

  const state = params.get('state');
  if (state !== sessionStorage.getItem('oauth_state')) {
    sessionStorage.removeItem('oauth_state');
    history.replaceState(null, '', location.pathname);
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }
  sessionStorage.removeItem('oauth_state');
  history.replaceState(null, '', location.pathname);

  const { clientId, clientSecret } = getOAuthApp();
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method:  'POST',
    headers: { Accept: 'application/json' },
    body:    new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri() }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data.access_token;
}
