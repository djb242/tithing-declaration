// The whole list is one document. It lives in this browser (store.js) and,
// if the person turns sync on, as one file in their own Google Drive or
// OneDrive. Two copies of it — two devices, or two people sharing the file —
// are combined with merge(), so nobody's edit is lost:
//
//   - families: each one keeps its newest version (by `updated`)
//   - outreach: the log only grows; a removed entry is kept as a tombstone so
//     the removal travels too
//   - settings: the newest version wins as a whole
//   - ignored bookings: union
//
// Records carry `updated` (ms since epoch) and `by` (which device wrote it).

export const VERSION = 1;

export const DEFAULT_SETTINGS = {
  wardName: '',
  senderName: '',
  signupLink: '',
  slotWindow: '11:00-13:00',
  slotMinutes: 15,
  followupDays: 7,
  steps: ['text', 'email', 'call'],
  titleFilter: 'Tithing Declaration',
  templates: {},
};

export function emptyDoc() {
  return {
    version: VERSION,
    settings: { ...DEFAULT_SETTINGS, updated: 0 },
    families: {},
    outreach: {},
    ignored: [],
    events: [], // the last bookings read from a calendar, already tagged
    eventsAt: 0,
  };
}

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

function newerOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  if ((a.updated || 0) !== (b.updated || 0)) return (a.updated || 0) > (b.updated || 0) ? a : b;
  // Same instant on two devices: pick one the same way on both sides.
  return String(a.by || '') >= String(b.by || '') ? a : b;
}

function mergeMap(a = {}, b = {}) {
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) out[id] = newerOf(a[id], b[id]);
  return out;
}

export function merge(a, b) {
  if (!a) return b;
  if (!b) return a;
  const events = (b.eventsAt || 0) > (a.eventsAt || 0) ? b : a;
  return {
    version: VERSION,
    settings: newerOf(a.settings, b.settings),
    families: mergeMap(a.families, b.families),
    outreach: mergeMap(a.outreach, b.outreach),
    ignored: [...new Set([...(a.ignored || []), ...(b.ignored || [])])],
    events: events.events || [],
    eventsAt: events.eventsAt || 0,
  };
}

/** Same content? Used to skip writing a file that would not change. */
export const sameDoc = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Live records only, as arrays the planner takes. */
export function view(doc) {
  const families = Object.values(doc.families).filter((f) => !f.deleted);
  const outreach = new Map();
  for (const o of Object.values(doc.outreach)) {
    if (o.deleted) continue;
    if (!outreach.has(o.family_id)) outreach.set(o.family_id, []);
    outreach.get(o.family_id).push(o);
  }
  for (const list of outreach.values()) list.sort((x, y) => x.at.localeCompare(y.at));
  return { families, outreach };
}

/** Accepts a backup file; refuses anything that is not one. */
export function fromJson(text) {
  const d = JSON.parse(text);
  if (!d || typeof d !== 'object' || !d.families || !d.settings) throw new Error('This is not a Tithing Declaration backup file.');
  return { ...emptyDoc(), ...d, settings: { ...DEFAULT_SETTINGS, ...d.settings } };
}
