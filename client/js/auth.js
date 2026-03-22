/**
 * auth.js — GitHub OAuth Device Flow.
 * No CLIENT_SECRET, no redirect URI. Works from any static page.
 *
 * Usage:
 *   const { user_code, verification_uri, device_code, interval } = await startDeviceFlow();
 *   // show user_code + verification_uri to the user
 *   const token = await pollForToken(device_code, interval, onTick);
 */

const CLIENT_ID = 'https://leshikus.github.io/conspiracy';
const SCOPES    = 'repo';

/**
 * Step 1: Request a device code from GitHub.
 * Returns { device_code, user_code, verification_uri, interval, expires_in }.
 */
export async function startDeviceFlow() {
  const res = await fetch('https://github.com/login/device/code', {
    method:  'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body:    JSON.stringify({ client_id: CLIENT_ID, scope: SCOPES }),
  });
  if (!res.ok) throw new Error(`Device flow init failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data;
}

/**
 * Step 2: Poll until the user authorises (or until expired/denied).
 * Returns the access token string.
 * onTick is called with 'pending' | 'slow_down' on each unsuccessful poll.
 */
export async function pollForToken(device_code, interval_seconds, onTick) {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  let wait = interval_seconds * 1000;

  while (true) {
    await delay(wait);
    const res  = await fetch('https://github.com/login/oauth/access_token', {
      method:  'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        client_id:  CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = await res.json();

    if (data.access_token)                      return data.access_token;
    if (data.error === 'authorization_pending') { onTick?.('pending');   continue; }
    if (data.error === 'slow_down')             { wait += 5000; onTick?.('slow_down'); continue; }
    if (data.error === 'expired_token')         throw new Error('Code expired — try again.');
    if (data.error === 'access_denied')         throw new Error('Access denied.');
    throw new Error(data.error_description ?? data.error ?? 'Unknown OAuth error');
  }
}
