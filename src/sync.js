// Keeping this device and the person's cloud file the same.
//
// One round: read the file, merge it into the copy here, write the merged
// result back if it differs. merge() never loses a record, so two devices
// (or two people) syncing at once can only delay an edit, not drop it: each
// still has its own copy, and the next round folds it in.

import { sameDoc } from './doc.js';
import * as google from './google.js';
import * as microsoft from './microsoft.js';
import * as store from './store.js';

export const PROVIDERS = { google, microsoft };

let state = null; // { provider, ref } kept in IndexedDB
let running = null;
let status = { ok: true, at: 0, error: '', needsSignIn: false };
const listeners = new Set();

export const onStatus = (fn) => listeners.add(fn);
const setStatus = (s) => { status = { ...status, ...s }; for (const fn of listeners) fn(status); };
export const getStatus = () => status;
export const getState = () => state;
export const provider = () => (state ? PROVIDERS[state.provider] : null);

export async function init() {
  state = (await store.getLocal('sync')) || null;
  if (state && !provider()?.hasToken()) setStatus({ needsSignIn: true });
}

/** Turn sync on with a fresh or existing file of this person's own. */
export async function connect(name, ref = null) {
  const p = PROVIDERS[name];
  const fileRef = ref || (await p.findOrCreate(store.current()));
  state = { provider: name, ref: fileRef };
  await store.setLocal('sync', state);
  setStatus({ needsSignIn: false });
  return syncNow();
}

export async function disconnect() {
  const p = provider();
  state = null;
  await store.setLocal('sync', null);
  if (p) await p.signOut();
  setStatus({ ok: true, error: '', needsSignIn: false, at: 0 });
}

export function syncNow() {
  if (!state) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    const p = provider();
    try {
      if (!p.hasToken()) { setStatus({ needsSignIn: true }); return; }
      const remote = await p.read(state.ref);
      await store.mergeIn(remote);
      if (!sameDoc(remote, store.current())) await p.write(state.ref, store.current());
      setStatus({ ok: true, error: '', needsSignIn: false, at: Date.now() });
    } catch (err) {
      setStatus({ ok: false, error: err.message || String(err), needsSignIn: Boolean(err.reauth) });
    } finally {
      running = null;
    }
  })();
  return running;
}

// Local edits go up a moment later, batched; another device's edits come
// down whenever the app comes back to the front, and every few minutes.
let timer = null;
export function startAuto() {
  store.onChange((_, { fromSync }) => {
    if (fromSync || !state) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 1500);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 3 * 60_000);
}
