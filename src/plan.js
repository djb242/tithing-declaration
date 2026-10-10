// The reasoning, with no storage in it: given the families and their outreach
// history, who needs a reminder, who needs the next nudge and what that nudge
// is. Pure functions, so the page and the tests get the same answer.

import { addDays, dayOf, daysBetween, prettyAppt, prettyDay, prettyTime } from './dates.js';

export const CHANNELS = ['text', 'email', 'call', 'in_person'];
export const CHANNEL_LABEL = { text: 'Text', email: 'Email', call: 'Call', in_person: 'In person' };
export const CHANNEL_PAST = { text: 'texted', email: 'emailed', call: 'called', in_person: 'spoke in person' };
export const DEFAULT_STEPS = ['text', 'email', 'call'];

/**
 * The next step for a family that still needs an appointment. Measured from
 * the furthest step reached rather than the last one used, so a phone call
 * that happened to come first is not followed by a text. Past the last step it
 * is "that step again" — the list does not wrap back to something that already
 * went unanswered. "In person" counts as the last step.
 */
export function nextStep(invites, steps = DEFAULT_STEPS) {
  if (!steps.length) steps = DEFAULT_STEPS;
  if (!invites.length) return { channel: steps[0], again: false };
  const rung = (c) => (c === 'in_person' ? steps.length - 1 : Math.max(0, steps.indexOf(c)));
  const top = Math.max(...invites.map((o) => rung(o.channel)));
  if (top >= steps.length - 1) return { channel: steps[steps.length - 1], again: true };
  return { channel: steps[top + 1], again: false };
}

const lastOf = (rows) => (rows.length ? rows[rows.length - 1] : null);

function describeLast(o, today) {
  if (!o) return 'never contacted';
  const days = daysBetween(dayOf(o.at), today);
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return `${CHANNEL_PAST[o.channel] || o.channel} ${when}`;
}

/** One family, annotated. `outreach` is that family's rows oldest-first. */
export function annotate(f, outreach, { today, followupDays, steps }) {
  const invites = outreach.filter((o) => o.purpose === 'invite');
  const reminders = outreach.filter((o) => o.purpose === 'reminder');
  const last = lastOf(invites);
  const view = {
    ...f,
    invites: invites.length,
    lastInvite: last,
    lastLine: describeLast(last, today),
    apptDay: dayOf(f.appointment_at),
    apptPretty: prettyAppt(f.appointment_at),
    apptTime: prettyTime(f.appointment_at),
    reminded: false,
    remindDue: false,
    apptIsToday: false,
    apptPassed: false,
    next: null,
    dueOn: null,
    overdue: 0,
  };

  if (f.status === 'scheduled' && f.appointment_at) {
    view.reminded = reminders.some((r) => r.appointment_at === f.appointment_at);
    const gap = daysBetween(today, view.apptDay);
    view.apptIsToday = gap === 0;
    view.apptPassed = gap < 0;
    // Day-before is the ask; the same morning is the last chance, still shown.
    view.remindDue = !view.reminded && (gap === 1 || gap === 0);
  }

  if (f.status === 'open') {
    view.next = nextStep(invites, steps);
    view.dueOn = last ? addDays(dayOf(last.at), followupDays) : today;
    view.overdue = daysBetween(view.dueOn, today); // >= 0 means due
  }

  return view;
}

/** The whole picture, sectioned the way the page shows it. */
export function plan(families, outreachMap, { today, followupDays = 7, steps = DEFAULT_STEPS }) {
  const all = families.map((f) => annotate(f, outreachMap.get(f.id) || [], { today, followupDays, steps }));
  const byAppt = (a, b) => a.appointment_at.localeCompare(b.appointment_at);

  const remind = all.filter((f) => f.remindDue).sort(byAppt);
  const upcoming = all.filter((f) => f.status === 'scheduled' && f.apptDay && !f.apptPassed).sort(byAppt);
  // Appointment day has passed and nothing was recorded: did they come?
  const followUp = all.filter((f) => f.status === 'scheduled' && f.apptPassed).sort(byAppt);
  const reach = all
    .filter((f) => f.status === 'open' && f.overdue >= 0)
    .sort((a, b) => b.overdue - a.overdue || b.invites - a.invites || a.name.localeCompare(b.name));
  const waiting = all
    .filter((f) => f.status === 'open' && f.overdue < 0)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  const counts = { total: all.length, open: 0, scheduled: 0, declared: 0, skip: 0 };
  for (const f of all) counts[f.status] = (counts[f.status] || 0) + 1;

  return { today, tomorrow: addDays(today, 1), counts, remind, upcoming, followUp, reach, waiting, all };
}

/**
 * The coming Sunday's slots, open and taken. Booking pages do not expose their
 * availability, so the slots are rebuilt from the ward's window ("11:00-13:00",
 * every `minutes`) less whatever is already booked for that day. On Sunday
 * itself, slots already past drop off.
 */
export function sundaySlots({ today, nowTime = '00:00', window = '11:00-13:00', minutes = 15, booked = [] }) {
  const dow = new Date(`${today}T12:00:00`).getDay();
  const day = addDays(today, (7 - dow) % 7);
  const m = String(window).match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m || !(minutes > 0)) return { day, pretty: prettyDay(day), open: [], taken: [] };
  const toMin = (h, mi) => Number(h) * 60 + Number(mi);
  const hhmm = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  const takenSet = new Set(booked.filter((b) => b && b.slice(0, 10) === day).map((b) => b.slice(11, 16)));
  const open = [];
  const taken = [];
  for (let t = toMin(m[1], m[2]); t + minutes <= toMin(m[3], m[4]); t += minutes) {
    const slot = hhmm(t);
    if (day === today && slot <= nowTime) continue;
    (takenSet.has(slot) ? taken : open).push({ time: slot, pretty: prettyTime(`${day}T${slot}`) });
  }
  return { day, pretty: prettyDay(day), open, taken };
}
