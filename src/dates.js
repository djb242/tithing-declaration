// Local-day arithmetic. Appointments are stored as local strings — "YYYY-MM-DD"
// for an all-day event, "YYYY-MM-DDTHH:MM" when there is a time — because the
// question the app answers is "is this tomorrow?", and tomorrow is a local day.
// Everything uses the device's own time zone.

const pad = (n) => String(n).padStart(2, '0');

export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localStamp(d = new Date()) {
  return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
export const isStamp = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s || '');
export const dayOf = (s) => (s ? String(s).slice(0, 10) : null);

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
}

export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function prettyDay(day, { weekday = true } = {}) {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${weekday ? `${DOW[dt.getDay()]} ` : ''}${MONTHS[m - 1]} ${d}`;
}

export function prettyTime(stamp) {
  if (!isStamp(stamp)) return '';
  const [h, mi] = stamp.slice(11).split(':').map(Number);
  const h12 = h % 12 || 12;
  return `${h12}:${pad(mi)} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Sun Sep 27, 3:00 pm" or "Sun Sep 27". */
export function prettyAppt(appt) {
  if (!appt) return '';
  const t = prettyTime(appt);
  return t ? `${prettyDay(dayOf(appt))}, ${t}` : prettyDay(dayOf(appt));
}

/** A calendar start ({date} or {dateTime}) → our local string. */
export function fromGoogleStart(start) {
  if (!start) return null;
  if (start.date) return start.date;
  if (start.dateTime) return localStamp(new Date(start.dateTime));
  return null;
}
