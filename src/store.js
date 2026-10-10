// The document in this browser (IndexedDB), and every change to it.
// Nothing here talks to a network.

import { localStamp } from './dates.js';
import { DEFAULT_SETTINGS, emptyDoc, merge, newId } from './doc.js';

const DB = 'tithing-declaration';
const KEY = 'doc';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kv(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const getLocal = (key) => kv('readonly', (s) => s.get(key));
export const setLocal = (key, value) => kv('readwrite', (s) => s.put(value, key));

// Which browser wrote a change, so ties break the same way everywhere.
let DEVICE = null;
async function device() {
  if (!DEVICE) {
    DEVICE = (await getLocal('device')) || newId();
    await setLocal('device', DEVICE);
  }
  return DEVICE;
}

let doc = null;
const listeners = new Set();

export async function load() {
  await device();
  doc = (await getLocal(KEY)) || emptyDoc();
  doc.settings = { ...DEFAULT_SETTINGS, ...doc.settings };
  return doc;
}

export const current = () => doc;
export const onChange = (fn) => listeners.add(fn);

async function commit(next, { fromSync = false } = {}) {
  doc = next;
  await setLocal(KEY, doc);
  for (const fn of listeners) fn(doc, { fromSync });
}

const stamp = () => ({ updated: Date.now(), by: DEVICE });

export function addFamily(fields) {
  const id = newId();
  const f = {
    id, name: '', first: '', aliases: '', phone: '', phone2: '', email: '', notes: '',
    status: 'open', appointment_at: null, appointment_source: null, calendar_event_id: null,
    ...fields, ...stamp(),
  };
  return commit({ ...doc, families: { ...doc.families, [id]: f } }).then(() => f);
}

export function addFamilies(list) {
  const families = { ...doc.families };
  const have = new Set(Object.values(families).filter((f) => !f.deleted).map((f) => f.name.toLowerCase()));
  let added = 0;
  for (const fields of list) {
    if (have.has(fields.name.toLowerCase())) continue;
    const id = newId();
    families[id] = {
      id, name: '', first: '', aliases: '', phone: '', phone2: '', email: '', notes: '',
      status: 'open', appointment_at: null, appointment_source: null, calendar_event_id: null,
      ...fields, ...stamp(),
    };
    added++;
  }
  return commit({ ...doc, families }).then(() => added);
}

export function updateFamily(id, fields) {
  const f = doc.families[id];
  if (!f) return Promise.resolve();
  return commit({ ...doc, families: { ...doc.families, [id]: { ...f, ...fields, ...stamp() } } });
}

// A removed family keeps only its id, so the removal syncs but the details go.
export function deleteFamily(id) {
  if (!doc.families[id]) return Promise.resolve();
  const outreach = { ...doc.outreach };
  for (const o of Object.values(outreach)) {
    if (o.family_id === id && !o.deleted) outreach[o.id] = { id: o.id, family_id: id, deleted: true, at: o.at, ...stamp() };
  }
  return commit({ ...doc, families: { ...doc.families, [id]: { id, deleted: true, name: '', ...stamp() } }, outreach });
}

export function logOutreach(family_id, { purpose, channel, note = '', appointment_at = null }) {
  const id = newId();
  const o = { id, family_id, purpose, channel, note, appointment_at, at: localStamp(), ...stamp() };
  return commit({ ...doc, outreach: { ...doc.outreach, [id]: o } });
}

export function deleteOutreach(id) {
  const o = doc.outreach[id];
  if (!o) return Promise.resolve();
  return commit({ ...doc, outreach: { ...doc.outreach, [id]: { id, family_id: o.family_id, at: o.at, deleted: true, ...stamp() } } });
}

export function saveSettings(fields) {
  return commit({ ...doc, settings: { ...doc.settings, ...fields, ...stamp() } });
}

/** Calendar results: the family changes plus the tagged bookings. */
export function applyCalendar({ changes, tagged }) {
  const families = { ...doc.families };
  for (const c of changes) {
    const f = families[c.id];
    if (f) families[c.id] = { ...f, ...c.fields, ...stamp() };
  }
  return commit({ ...doc, families, events: tagged, eventsAt: Date.now() });
}

export function ignoreBooking(eventId) {
  return commit({ ...doc, ignored: [...new Set([...doc.ignored, eventId])] });
}

/** Fold in a copy from elsewhere (a synced file or a backup). */
export function mergeIn(other, { fromSync = true } = {}) {
  return commit(merge(doc, other), { fromSync });
}

export function replaceAll(next) {
  return commit(next);
}

/** Everything off this device. The synced file, if any, is the person's to delete. */
export async function eraseLocal() {
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* private mode */ }
}
