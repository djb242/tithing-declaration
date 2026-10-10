// .ics files → plain events ({ id, summary, description, start }).
//
// Every calendar app can export one: Google, Outlook, Apple, Proton, Yahoo.
// Only what matching needs is read. Times with a TZID or a Z are turned into
// the device's local time; floating times are taken as already local.

import { localStamp } from './dates.js';

function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

// The offset of a named zone at a given instant, from the browser's own tz data.
function zoneOffsetMs(zone, utcMs) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - utcMs;
  } catch {
    return null; // unknown zone: treat as local
  }
}

export function parseDate(value, params = '') {
  const v = value.trim();
  if (/^\d{8}$/.test(v) || /VALUE=DATE(?!-)/i.test(params)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', z] = m;
  if (z) return localStamp(new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)));
  const tzid = params.match(/TZID=("?)([^;:"]+)\1/i)?.[2];
  if (tzid) {
    const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    const off = zoneOffsetMs(tzid, guess);
    if (off !== null) return localStamp(new Date(guess - zoneOffsetMs(tzid, guess - off)));
  }
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

export function parseIcs(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text).split('\n')) {
    if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; continue; }
    if (/^END:VEVENT/i.test(line)) {
      if (cur && cur.start && !/CANCELLED/i.test(cur.status || '')) {
        events.push({
          id: `ics:${cur.uid || `${cur.summary}|${cur.start}`}${cur.recurrence ? `|${cur.recurrence}` : ''}`,
          summary: cur.summary || '', description: cur.description || '', start: cur.start,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/i);
    if (!m) continue;
    const [, name, params, value] = m;
    switch (name.toUpperCase()) {
      case 'UID': cur.uid = value.trim(); break;
      case 'SUMMARY': cur.summary = unescapeText(value); break;
      case 'DESCRIPTION': cur.description = unescapeText(value); break;
      case 'DTSTART': cur.start = parseDate(value, params); break;
      case 'RECURRENCE-ID': cur.recurrence = value.trim(); break;
      case 'STATUS': cur.status = value; break;
      default: break;
    }
  }
  return events;
}
