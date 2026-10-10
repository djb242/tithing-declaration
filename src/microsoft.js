// Microsoft: the list as a file in the person's own OneDrive, and read-only
// access to their Outlook calendars. Straight from this browser to Microsoft
// (sign-in with PKCE, no secret, no server). Works with personal Microsoft
// accounts and work or school ones.
//
// Scopes:
//   Files.ReadWrite.All   their OneDrive, including a list someone shared
//                         with them (Microsoft has no narrower scope that
//                         reaches shared files)
//   Calendars.Read        read-only; used only when they connect a calendar

import { config } from './config.js';
import { localStamp } from './dates.js';
import { getLocal, setLocal } from './store.js';

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'openid offline_access User.Read Files.ReadWrite.All Calendars.Read';
const FOLDER = 'Tithing Declaration';
const FILE_NAME = 'Tithing Declaration list.json';

export const available = () => Boolean(config().microsoft.clientId);
export const label = 'OneDrive';
const redirectUri = () => `${location.origin}${location.pathname}`;

let tok = null; // { access_token, refresh_token, expires }

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Leaves the page for Microsoft's sign-in; finishSignIn() picks it up on return. */
export async function signIn() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem('td-ms-pkce', JSON.stringify({ verifier, state }));
  const u = new URL(`${AUTH}/authorize`);
  u.search = new URLSearchParams({
    client_id: config().microsoft.clientId, response_type: 'code', redirect_uri: redirectUri(),
    scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  location.assign(u);
}

async function tokenRequest(params) {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config().microsoft.clientId, scope: SCOPES, ...params }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error_description?.split('\r\n')[0] || j.error || 'Microsoft sign-in failed');
  tok = { access_token: j.access_token, refresh_token: j.refresh_token || tok?.refresh_token, expires: Date.now() + j.expires_in * 1000 };
  // Kept on this device so sync survives a reload. Microsoft limits a
  // browser app's refresh token to 24 hours, after which they sign in again.
  await setLocal('ms-token', tok);
  return tok;
}

/** Call once at startup. True if this page load is the return from sign-in. */
export async function finishSignIn() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) {
    tok = (await getLocal('ms-token')) || null;
    return false;
  }
  const saved = JSON.parse(sessionStorage.getItem('td-ms-pkce') || 'null');
  sessionStorage.removeItem('td-ms-pkce');
  history.replaceState(null, '', redirectUri());
  if (p.has('error')) throw new Error(p.get('error_description') || p.get('error'));
  if (!saved || saved.state !== p.get('state')) throw new Error('Microsoft sign-in did not match; try again.');
  await tokenRequest({ grant_type: 'authorization_code', code: p.get('code'), redirect_uri: redirectUri(), code_verifier: saved.verifier });
  return true;
}

export const hasToken = () => Boolean(tok?.refresh_token || (tok && tok.expires > Date.now()));
export const hasCalendar = hasToken;

export async function signOut() {
  tok = null;
  await setLocal('ms-token', null);
}

async function access() {
  if (!tok) throw Object.assign(new Error('Not signed in to Microsoft'), { reauth: true });
  if (tok.expires < Date.now() + 60_000) {
    try {
      await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
    } catch {
      await signOut();
      throw Object.assign(new Error('Microsoft sign-in expired'), { reauth: true });
    }
  }
  return tok.access_token;
}

async function api(path, opts = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
    ...opts, headers: { authorization: `Bearer ${await access()}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) { await signOut(); throw Object.assign(new Error('Microsoft sign-in expired'), { reauth: true }); }
  if (!res.ok && res.status !== 404) throw new Error(`Microsoft said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

const itemPath = (ref) => `/drives/${ref.driveId}/items/${ref.id}`;

/** → { id, driveId, name } */
export async function findOrCreate(initial) {
  const path = `/me/drive/root:/${encodeURIComponent(FOLDER)}/${encodeURIComponent(FILE_NAME)}`;
  let res = await api(path);
  if (res.status === 404) {
    res = await api(`${path}:/content`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(initial) });
  }
  const it = await res.json();
  return { id: it.id, driveId: it.parentReference.driveId, name: it.name };
}

export async function read(ref) {
  return (await api(`${itemPath(ref)}/content`)).json();
}

export async function write(ref, doc) {
  await api(`${itemPath(ref)}/content`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
}

export async function share(ref, email) {
  await api(`${itemPath(ref)}/invite`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recipients: [{ email }], roles: ['write'], requireSignIn: true, sendInvitation: true,
      message: 'I shared our tithing declaration list with you. Open the Tithing Declaration app, choose "Join a shared list", and sign in with this Microsoft account.',
    }),
  });
}

export async function sharedWith(ref) {
  const { value = [] } = await (await api(`${itemPath(ref)}/permissions`)).json();
  return value.filter((p) => !p.roles?.includes('owner')).map((p) => {
    const u = p.grantedToV2?.user || p.grantedTo?.user || p.grantedToIdentitiesV2?.[0]?.user || {};
    return { id: p.id, email: u.email || p.invitation?.email || '', name: u.displayName || '' };
  });
}

export async function unshare(ref, permId) {
  await api(`${itemPath(ref)}/permissions/${permId}`, { method: 'DELETE' });
}

/** Lists shared with this account, newest first. */
export async function sharedLists() {
  const { value = [] } = await (await api('/me/drive/sharedWithMe')).json();
  return value
    .filter((it) => (it.name || '').startsWith('Tithing Declaration list'))
    .map((it) => ({
      id: it.remoteItem?.id || it.id, driveId: it.remoteItem?.parentReference?.driveId || it.parentReference?.driveId,
      name: it.name, owner: it.remoteItem?.shared?.owner?.user?.displayName || '',
    }));
}

// ------------------------------------------------------------- calendar

export async function calendars() {
  const { value = [] } = await (await api('/me/calendars?$select=id,name,isDefaultCalendar')).json();
  return value.map((c) => ({ id: c.id, name: c.name, primary: Boolean(c.isDefaultCalendar) }));
}

export async function events(calendarId, from, to) {
  const out = [];
  let next = `/me/calendars/${encodeURIComponent(calendarId)}/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$top=500&$select=id,subject,bodyPreview,start,isAllDay,isCancelled`;
  while (next) {
    const r = await (await api(next, { headers: { Prefer: 'outlook.timezone="UTC"' } })).json();
    for (const e of r.value || []) {
      if (e.isCancelled) continue;
      const startUtc = new Date(`${e.start.dateTime.replace(/\.\d+$/, '')}Z`);
      out.push({
        id: `ms:${e.id}`, summary: e.subject || '', description: e.bodyPreview || '',
        start: e.isAllDay ? e.start.dateTime.slice(0, 10) : localStamp(startUtc),
      });
    }
    next = r['@odata.nextLink'] || '';
  }
  return out;
}
