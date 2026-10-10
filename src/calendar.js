// Where bookings come from: a connected Google or Outlook calendar, an .ics
// file, or nothing (appointments typed in by hand). Which calendar is kept on
// this device only — it belongs to whoever signed in here.

import { localDay } from './dates.js';
import { parseIcs } from './ics.js';
import { reconcile } from './match.js';
import * as google from './google.js';
import * as microsoft from './microsoft.js';
import * as store from './store.js';
import { view } from './doc.js';

const PROVIDERS = { google, microsoft };
let chosen = null; // { provider, id, name }

export async function init() { chosen = (await store.getLocal('calendar')) || null; }
export const getChosen = () => chosen;

export async function choose(provider, cal) {
  chosen = cal ? { provider, id: cal.id, name: cal.name } : null;
  await store.setLocal('calendar', chosen);
}

function apply(events) {
  const doc = store.current();
  const { families } = view(doc);
  const result = reconcile(events, families, localDay(), { titleFilter: doc.settings.titleFilter });
  return store.applyCalendar(result).then(() => ({ events: events.length, changes: result.changes, matched: result.tagged.filter((e) => e.family_id).length }));
}

/** Read the chosen calendar, two weeks back to six months ahead. */
export async function refresh() {
  if (!chosen) return null;
  const p = PROVIDERS[chosen.provider];
  if (!p.hasCalendar()) throw Object.assign(new Error('Sign in again to read your calendar'), { reauth: true });
  const from = new Date(Date.now() - 14 * 86400000);
  const to = new Date(Date.now() + 180 * 86400000);
  return apply(await p.events(chosen.id, from, to));
}

export async function importIcs(text) {
  const events = parseIcs(text);
  if (!events.length) throw new Error('No events found in that file.');
  const today = localDay();
  const cutoff = new Date(Date.now() - 14 * 86400000);
  const recent = events.filter((e) => e.start.slice(0, 10) >= localDay(cutoff) || e.start.slice(0, 10) >= today);
  return apply(recent);
}
