// Calendar → list. Bookings are matched to families by name; a match sets the
// appointment. The calendar is the source of truth for anything it set: if the
// booking goes away before the day, the family goes back to "open".
//
// Every source (Google, Outlook, an .ics file) is first turned into the same
// plain event: { id, summary, description, start } with `start` a local
// "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM". Everything here is pure.
//
// Matching is by tokens. "Ashby-Moreno" needs both words in the title;
// "Linwood, Miles" needs both, and beats plain "Linwood" for an event called
// "Miles Linwood" because more of its tokens matched. The title is matched
// first, then the description as a fallback.

const STOP = ['family', 'the', 'and', 'tithing', 'declaration', 'settlement', 'appointment', 'with'];

const tokens = (s) =>
  String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.includes(t));

// "Hollises" should find Hollis: a plural in the event also counts as its
// singular. Only the event is loosened; a family name is matched whole.
const withSingulars = (list) => {
  const set = new Set(list);
  for (const t of list) {
    if (t.length > 3 && t.endsWith('es')) set.add(t.slice(0, -2));
    if (t.length > 3 && t.endsWith('s')) set.add(t.slice(0, -1));
  }
  return set;
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  // One pass, so "&amp;lt;" becomes "&lt;" and not "<".
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Google's booking pages write "Booked by <name> <email>" into the description. */
export function bookedBy(description) {
  const text = decodeEntities(String(description || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const m = text.match(/booked by\s+(.+?)\s+([^\s<>]+@[^\s<>]+)/i);
  if (!m) return null;
  return { name: m[1].trim(), email: m[2].trim() };
}

const namesOf = (f) => [f.name, ...String(f.aliases || '').split('\n')].map((n) => n.trim()).filter(Boolean);

export function matchFamily(event, families) {
  const title = withSingulars(tokens(event.summary));
  const body = withSingulars(tokens(event.description));
  let best = null;
  for (const f of families) {
    for (const name of namesOf(f)) {
      const need = tokens(name);
      if (!need.length) continue;
      const inTitle = need.every((t) => title.has(t));
      const inBody = !inTitle && need.every((t) => body.has(t));
      if (!inTitle && !inBody) continue;
      const score = need.length * 10 + (inTitle ? 1 : 0);
      if (!best || score > best.score) best = { family: f, score, tie: false };
      else if (score === best.score && best.family.id !== f.id) best.tie = true;
    }
  }
  // Two families fit equally well (two Fenn households): guessing would put the
  // reminder under the wrong name, so leave it unmatched for a person to link.
  return best && !best.tie ? best.family : null;
}

/** Events that count as appointments: title contains the filter, if one is set. */
export function isAppointment(event, titleFilter) {
  const want = String(titleFilter || '').trim().toLowerCase();
  return !want || String(event.summary || '').toLowerCase().includes(want);
}

// Recurring ward business on a mixed calendar is not somebody to add.
const NOISE = /\b(meeting|council|picnic|conference|activity|activities|devotional|fireside|broadcast|training|interview|class|practice)\b/i;

/**
 * Decide what changes the events imply. Returns
 *   { changes: [{ id, fields, note }], tagged: [{ ...event, family_id }] }
 * `changes` are applied by the caller; nothing here writes.
 */
export function reconcile(events, families, today, { titleFilter = '' } = {}) {
  const byFamily = new Map();
  const tagged = [];
  for (const e of events) {
    if (!e.start || !isAppointment(e, titleFilter)) continue;
    const fam = matchFamily(e, families);
    const who = bookedBy(e.description);
    tagged.push({ id: e.id, summary: e.summary || '', start: e.start, family_id: fam?.id ?? null, booker: who });
    if (!fam) continue;
    if (!byFamily.has(fam.id)) byFamily.set(fam.id, []);
    byFamily.get(fam.id).push({ id: e.id, start: e.start, summary: e.summary, booker: who });
  }

  // Several bookings for one family (rescheduled, old one left behind): the
  // soonest one still ahead wins; if all are behind, the most recent.
  const pick = new Map();
  for (const [fid, list] of byFamily) {
    list.sort((a, b) => a.start.localeCompare(b.start));
    pick.set(fid, list.find((e) => e.start.slice(0, 10) >= today) || list[list.length - 1]);
  }

  const changes = [];
  for (const f of families) {
    const ev = pick.get(f.id);
    if (ev) {
      if (f.status === 'declared' || f.status === 'skip') continue;
      if (f.appointment_at === ev.start && f.calendar_event_id === ev.id && f.status === 'scheduled') continue;
      const sameDay = f.appointment_at && f.appointment_at.slice(0, 10) === ev.start.slice(0, 10);
      const moved = f.appointment_at && !sameDay;
      const fields = { status: 'scheduled', appointment_at: ev.start, appointment_source: 'calendar', calendar_event_id: ev.id };
      // The booking form asked for an email; if the family has none, keep it.
      if (ev.booker?.email && !f.email) fields.email = ev.booker.email;
      const by = ev.booker ? ` — booked by ${ev.booker.name}` : '';
      const note = moved ? `Calendar moved the appointment${by}` : sameDay ? `Calendar confirmed the appointment${by}` : `Matched booking "${ev.summary}"${by}`;
      changes.push({ id: f.id, fields, note });
    } else if (
      f.status === 'scheduled' && f.appointment_source === 'calendar' && f.appointment_at
      && f.appointment_at.slice(0, 10) >= today
    ) {
      // It was on the calendar, it is still ahead, and it is gone.
      changes.push({
        id: f.id,
        fields: { status: 'open', appointment_at: null, appointment_source: null, calendar_event_id: null },
        note: 'Calendar booking disappeared — back to unscheduled',
      });
    }
  }
  return { changes, tagged };
}

/**
 * Upcoming bookings a person has to look at: ones that matched nobody, and ones
 * that matched a family already marked declared or not-this-year.
 */
export function unmatchedBookings(tagged, families, today, ignored = []) {
  const ign = new Set(ignored);
  const byId = new Map(families.map((f) => [f.id, f]));
  const out = [];
  for (const e of tagged) {
    if (e.start.slice(0, 10) < today || NOISE.test(e.summary) || ign.has(e.id)) continue;
    if (!e.family_id) { out.push({ ...e, reason: '' }); continue; }
    const f = byId.get(e.family_id);
    if (f && (f.status === 'declared' || f.status === 'skip')) {
      out.push({ ...e, reason: `matches ${f.name}, marked ${f.status === 'skip' ? 'not this year' : 'declared'}` });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
