// Google: the list as a file in the person's own Drive, and read-only access
// to their calendars. Straight from this browser to Google; the token lives in
// this tab's memory and session only.
//
// Scopes:
//   drive.file          only files this app created or the person picked —
//                       not the rest of their Drive
//   calendar.readonly   asked for only when they connect a calendar

import { config } from './config.js';
import { fromGoogleStart } from './dates.js';

const FILE_NAME = 'Tithing Declaration list.json';
const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.file';
const SCOPE_CAL = 'https://www.googleapis.com/auth/calendar.readonly';

const loaded = {};
function script(src) {
  loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${new URL(src).host}. Check the connection.`));
    document.head.appendChild(s);
  });
  return loaded[src];
}

let token = null; // { access_token, expires, scopes:Set }
try {
  const t = JSON.parse(sessionStorage.getItem('td-google') || 'null');
  if (t && t.expires > Date.now()) token = { ...t, scopes: new Set(t.scopes) };
} catch { /* none */ }

export const available = () => Boolean(config().google.clientId);
export const label = 'Google Drive';

export function hasToken(scope = SCOPE_DRIVE) {
  return Boolean(token && token.expires > Date.now() + 60_000 && token.scopes.has(scope));
}

/** Must run from a tap: Google opens a popup. */
export async function signIn({ calendar = false } = {}) {
  await script('https://accounts.google.com/gsi/client');
  const scopes = [SCOPE_DRIVE, ...(calendar || token?.scopes.has(SCOPE_CAL) ? [SCOPE_CAL] : [])];
  const res = await new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: config().google.clientId,
      scope: scopes.join(' '),
      include_granted_scopes: true,
      callback: (r) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r)),
      error_callback: (e) => reject(new Error(e.message || e.type || 'Sign-in was closed')),
    });
    client.requestAccessToken({ prompt: '' });
  });
  token = { access_token: res.access_token, expires: Date.now() + res.expires_in * 1000, scopes: new Set(res.scope.split(' ')) };
  sessionStorage.setItem('td-google', JSON.stringify({ ...token, scopes: [...token.scopes] }));
  return token;
}

export function signOut() {
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {});
  token = null;
  sessionStorage.removeItem('td-google');
}

async function api(url, opts = {}) {
  if (!token || token.expires < Date.now()) throw Object.assign(new Error('Google sign-in expired'), { reauth: true });
  const res = await fetch(url, { ...opts, headers: { authorization: `Bearer ${token.access_token}`, ...(opts.headers || {}) } });
  if (res.status === 401) { token = null; throw Object.assign(new Error('Google sign-in expired'), { reauth: true }); }
  if (!res.ok) throw new Error(`Google said ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** The list file this app made in their Drive, or a new one. → { id, name } */
export async function findOrCreate(initial) {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const { files } = await (await api(`${DRIVE}/files?q=${q}&fields=files(id,name,ownedByMe)&orderBy=modifiedTime desc`)).json();
  if (files.length) return { id: files[0].id, name: files[0].name };
  const boundary = `td${Date.now()}`;
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' })}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(initial)}\r\n--${boundary}--`;
  const f = await (await api(`${UPLOAD}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body,
  })).json();
  return { id: f.id, name: f.name };
}

export async function read(ref) {
  return (await api(`${DRIVE}/files/${ref.id}?alt=media`)).json();
}

export async function write(ref, doc) {
  await api(`${UPLOAD}/files/${ref.id}?uploadType=media`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc),
  });
}

/** Give someone edit access; Google emails them a link. */
export async function share(ref, email) {
  await api(`${DRIVE}/files/${ref.id}/permissions?sendNotificationEmail=true&emailMessage=${encodeURIComponent('I shared our tithing declaration list with you. Open the Tithing Declaration app, choose "Join a shared list", and sign in with this Google account.')}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: email }),
  });
}

export async function sharedWith(ref) {
  const { permissions = [] } = await (await api(`${DRIVE}/files/${ref.id}/permissions?fields=permissions(id,emailAddress,role,displayName)`)).json();
  return permissions.filter((p) => p.role !== 'owner').map((p) => ({ id: p.id, email: p.emailAddress, name: p.displayName }));
}

export async function unshare(ref, permId) {
  await api(`${DRIVE}/files/${ref.id}/permissions/${permId}`, { method: 'DELETE' });
}

/** Someone shared their list: Google's own picker lets this app open it. */
export async function pickShared() {
  const { apiKey, appId } = config().google;
  await script('https://apis.google.com/js/api.js');
  await new Promise((r) => gapi.load('picker', r));
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setOwnedByMe(false).setQuery(FILE_NAME).setMode(google.picker.DocsViewMode.LIST);
    const picker = new google.picker.PickerBuilder()
      .setAppId(appId).setDeveloperKey(apiKey).setOAuthToken(token.access_token)
      .addView(view).setTitle('Choose the shared list')
      .setCallback((d) => {
        if (d.action === google.picker.Action.PICKED) resolve({ id: d.docs[0].id, name: d.docs[0].name });
        else if (d.action === google.picker.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}

// ------------------------------------------------------------- calendar

export const hasCalendar = () => hasToken(SCOPE_CAL);

export async function calendars() {
  const { items = [] } = await (await api('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader')).json();
  return items.map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: Boolean(c.primary) }));
}

export async function events(calendarId, from, to) {
  const out = [];
  let page = '';
  do {
    const u = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    u.searchParams.set('timeMin', from.toISOString());
    u.searchParams.set('timeMax', to.toISOString());
    u.searchParams.set('singleEvents', 'true');
    u.searchParams.set('maxResults', '2500');
    if (page) u.searchParams.set('pageToken', page);
    const r = await (await api(u)).json();
    for (const e of r.items || []) {
      if (e.status === 'cancelled') continue;
      out.push({ id: `g:${e.id}`, summary: e.summary || '', description: e.description || '', start: fromGoogleStart(e.start) });
    }
    page = r.nextPageToken || '';
  } while (page);
  return out;
}
