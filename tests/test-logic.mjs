// The rules in SPEC.md, checked with plain arrays. Runs in Node, no browser.
//   node tests/test-logic.mjs
import assert from 'node:assert/strict';

process.env.TZ = 'America/New_York';
const { nextStep, plan, sundaySlots } = await import('../src/plan.js');
const { matchFamily, reconcile, bookedBy, isAppointment, unmatchedBookings } = await import('../src/match.js');
const { parseIcs } = await import('../src/ics.js');
const { parseFamilies } = await import('../src/importer.js');
const { fill, smsLink, mailLink, linkFor, firstNames } = await import('../src/messages.js');
const { emptyDoc, merge, view } = await import('../src/doc.js');

// steps
assert.deepEqual(nextStep([]), { channel: 'text', again: false });
assert.deepEqual(nextStep([{ channel: 'text' }]), { channel: 'email', again: false });
assert.deepEqual(nextStep([{ channel: 'text' }, { channel: 'email' }]), { channel: 'call', again: false });
assert.deepEqual(nextStep([{ channel: 'text' }, { channel: 'email' }, { channel: 'call' }]), { channel: 'call', again: true });
assert.deepEqual(nextStep([{ channel: 'call' }]), { channel: 'call', again: true }, 'a call first does not fall back to text');
assert.deepEqual(nextStep([{ channel: 'in_person' }]), { channel: 'call', again: true });
assert.deepEqual(nextStep([], ['email', 'call']), { channel: 'email', again: false }, 'custom steps');
assert.deepEqual(nextStep([{ channel: 'text' }], ['email', 'call']), { channel: 'call', again: false }, 'an off-list channel counts as the first step');

// plan
const today = '2026-09-20';
const fams = [
  { id: 1, name: 'Pellegrino', status: 'scheduled', appointment_at: '2026-09-21T15:00' },
  { id: 2, name: 'Quill', status: 'scheduled', appointment_at: '2026-09-21' },
  { id: 3, name: 'Abbott', status: 'open', appointment_at: null },
  { id: 4, name: 'Ainsley', status: 'open', appointment_at: null },
  { id: 5, name: 'Old', status: 'scheduled', appointment_at: '2026-09-13' },
  { id: 6, name: 'Done', status: 'declared', appointment_at: '2026-09-13' },
];
const out = new Map([
  [2, [{ purpose: 'reminder', channel: 'text', at: '2026-09-20T09:00', appointment_at: '2026-09-21' }]],
  [4, [{ purpose: 'invite', channel: 'text', at: '2026-09-18T09:00' }]],
]);
const p = plan(fams, out, { today, followupDays: 7 });
assert.deepEqual(p.remind.map((f) => f.name), ['Pellegrino'], 'Quill already reminded');
assert.deepEqual(p.followUp.map((f) => f.name), ['Old']);
assert.deepEqual(p.reach.map((f) => f.name), ['Abbott']);
assert.deepEqual(p.waiting.map((f) => f.name), ['Ainsley']);
assert.equal(p.waiting[0].dueOn, '2026-09-25');
assert.equal(p.waiting[0].next.channel, 'email');
assert.equal(p.counts.open, 2);
assert.equal(plan([{ ...fams[1], appointment_at: '2026-09-21T10:00' }], out, { today }).remind.length, 1, 'a moved appointment needs a fresh reminder');

// matching
const ev = (id, summary, start, description = '') => ({ id, summary, description, start });
const list = [{ id: 1, name: 'Linwood' }, { id: 2, name: 'Linwood, Miles' }, { id: 3, name: 'Ashby-Moreno' }, { id: 4, name: 'Carter' }];
assert.equal(matchFamily({ summary: 'Tithing Declaration - Linwood Family' }, list).id, 1);
assert.equal(matchFamily({ summary: 'Miles Linwood' }, list).id, 2);
assert.equal(matchFamily({ summary: 'Ashby Moreno tithing' }, list).id, 3);
assert.equal(matchFamily({ summary: 'Moreno' }, list), null);
assert.equal(matchFamily({ summary: 'Tithing', description: 'with the Carters' }, list).id, 4);
assert.equal(matchFamily({ summary: 'Hollises' }, [{ id: 9, name: 'Hollis' }]).id, 9);
assert.equal(matchFamily({ summary: 'Haye' }, [{ id: 9, name: 'Hayes' }]), null, 'a family name is never trimmed');
assert.equal(matchFamily({ summary: 'Tithing Declaration - Fenn' }, [{ id: 1, name: 'Fenn' }, { id: 2, name: 'Fenn' }]), null, 'tie leaves it unmatched');
const fenns = [{ id: 1, name: 'Fenn, Owen & Marta', aliases: 'Owen Fenn' }, { id: 2, name: 'Fenn, Ruth' }, { id: 3, name: 'Fennimore' }];
assert.equal(matchFamily({ summary: 'Tithing Declaration (Owen & Marta Fenn)' }, fenns).id, 1);
assert.equal(matchFamily({ summary: 'Tithing Declaration (Ruth Fenn)' }, fenns).id, 2);
assert.equal(matchFamily({ summary: 'José Linwood' }, [{ id: 1, name: 'Jose Linwood' }]).id, 1, 'accents ignored');

// reconcile
{
  const fam = list.map((f) => ({ ...f, status: 'open' }));
  const r = reconcile([ev('a', 'Carter', '2026-10-04T15:00'), ev('b', 'Carter', '2026-09-27T15:00'), ev('c', 'Nobody', '2026-10-11')], fam, today);
  const c = r.changes.find((x) => x.id === 4);
  assert.equal(c.fields.calendar_event_id, 'b', 'soonest ahead wins');
  assert.equal(c.fields.appointment_at, '2026-09-27T15:00');
  assert.equal(r.tagged.find((e) => e.id === 'c').family_id, null);

  const gone = reconcile([], [{ id: 1, name: 'X', status: 'scheduled', appointment_source: 'calendar', appointment_at: '2026-09-27' }], today);
  assert.equal(gone.changes[0].fields.status, 'open', 'a vanished booking reopens');
  const manual = reconcile([], [{ id: 1, name: 'X', status: 'scheduled', appointment_source: 'manual', appointment_at: '2026-09-27' }], today);
  assert.equal(manual.changes.length, 0, 'manual appointments are left alone');
  const declared = reconcile([ev('d', 'Carter', '2026-09-27')], [{ id: 4, name: 'Carter', status: 'declared' }], today);
  assert.equal(declared.changes.length, 0);
  assert.equal(unmatchedBookings(declared.tagged, [{ id: 4, name: 'Carter', status: 'declared' }], today)[0].reason, 'matches Carter, marked declared');

  const r2 = reconcile([
    ev('x', 'Maple Grove Ward Meeting Block', '2026-09-27T09:00'),
    ev('y', 'Tithing Declaration (Grace Okafor)', '2026-10-04T11:15', '<b>Booked by</b> Grace Okafor grace.o@example.com <br>'),
  ], [{ id: 1, name: 'Okafor', status: 'open' }, { id: 2, name: 'Okafur', status: 'open' }], today, { titleFilter: 'Tithing Declaration' });
  assert.equal(r2.tagged.length, 1);
  assert.equal(r2.changes[0].fields.email, 'grace.o@example.com', 'booking email kept when none on file');
}
assert.deepEqual(bookedBy('<b>Booked by</b> Theo Pellegrino tpellegrino@example.com <br>Short'), { name: 'Theo Pellegrino', email: 'tpellegrino@example.com' });
assert.equal(isAppointment({ summary: 'Anything' }, ''), true);
assert.equal(unmatchedBookings([{ id: 'm', summary: 'Ward council meeting', start: '2026-09-27', family_id: null }], [], today).length, 0, 'ward business is not a booking');
console.log('plan and matching ok');

// slots
{
  const s = sundaySlots({ today: '2026-10-10', booked: ['2026-10-11T11:00', '2026-10-11T11:15', '2026-10-18T11:30'] });
  assert.equal(s.day, '2026-10-11');
  assert.deepEqual(s.taken.map((x) => x.time), ['11:00', '11:15']);
  assert.equal(s.open.length, 6);
  assert.equal(sundaySlots({ today: '2026-10-11', nowTime: '11:40' }).open[0].time, '11:45');
}

// ics
{
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT', 'UID:1', 'SUMMARY:Tithing Declaration (Grace Okafor)', 'DTSTART:20261004T151500Z', 'DESCRIPTION:Booked by Grace Okafor grace.o@exa', ' mple.com', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:2', 'SUMMARY:All day', 'DTSTART;VALUE=DATE:20261011', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:3', 'SUMMARY:Zoned', 'DTSTART;TZID=America/Denver:20261011T110000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:4', 'SUMMARY:Gone', 'STATUS:CANCELLED', 'DTSTART:20261011T110000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:5', 'SUMMARY:Floating\\, local', 'DTSTART:20261011T110000', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const e = parseIcs(ics);
  assert.equal(e.length, 4, 'cancelled dropped');
  assert.equal(e[0].start, '2026-10-04T11:15', 'UTC → local');
  assert.equal(e[0].description, 'Booked by Grace Okafor grace.o@example.com', 'folded lines joined');
  assert.equal(e[1].start, '2026-10-11');
  assert.equal(e[2].start, '2026-10-11T13:00', 'Denver 11:00 is New York 13:00');
  assert.equal(e[3].summary, 'Floating, local');
  assert.equal(e[3].start, '2026-10-11T11:00');
}

// importer
{
  assert.deepEqual(parseFamilies('Abbott\nCarter, Ann & Joe\n\nabbott').map((f) => f.name), ['Abbott', 'Carter, Ann & Joe'], 'one per line, deduped');
  const csv = 'Household,Phone,Email\n"Fenn, Owen & Marta",555-0100,owen@example.com\nHayes,,';
  const f = parseFamilies(csv);
  assert.equal(f.length, 2);
  assert.equal(f[0].name, 'Fenn, Owen & Marta');
  assert.equal(f[0].phone, '555-0100');
  assert.equal(f[0].email, 'owen@example.com');
  const tsv = parseFamilies('Name\tFirst Name\tMobile\nQuill\tDana\t555-0101');
  assert.equal(tsv[0].first, 'Dana');
  assert.equal(tsv[0].phone, '555-0101');
}

// messages
{
  const s = { wardName: 'Maple Grove Ward', senderName: 'Brother Lee', signupLink: 'https://example.com/book' };
  const f = { name: 'Fenn, Owen & Marta', phone: '(555) 010-0100', phone2: '555.010.0101', email: 'a@example.com, b@example.com', appointment_at: '2026-11-01T11:15' };
  assert.equal(firstNames(f.name), 'Owen & Marta');
  assert.equal(fill('Hi {first}, {when}. {link} — {sender}, {ward}', f, s), 'Hi Owen & Marta, Sun Nov 1 at 11:15 am. https://example.com/book — Brother Lee, Maple Grove Ward');
  assert.equal(fill('Hi {first}', { name: 'Hayes', first: 'Sam' }, s), 'Hi Sam');
  assert.match(smsLink(f, 'hi there'), /^sms:5550100100,5550100101\?&body=hi%20there$/, 'group text to both phones');
  assert.match(mailLink(f, 'S', 'B'), /^mailto:a@example\.com,b@example\.com\?subject=S&body=B$/);
  assert.equal(linkFor('text', 'invite', { name: 'X' }, s), null, 'no phone, no link');
  assert.match(linkFor('call', 'invite', f, s), /^tel:5550100100$/);
}
console.log('ics, import and messages ok');

// merge
{
  const a = emptyDoc();
  const b = emptyDoc();
  a.families.f1 = { id: 'f1', name: 'Abbott', phone: '1', updated: 10, by: 'a' };
  b.families.f1 = { id: 'f1', name: 'Abbott', phone: '2', updated: 20, by: 'b' };
  b.families.f2 = { id: 'f2', name: 'Carter', updated: 5, by: 'b' };
  a.outreach.o1 = { id: 'o1', family_id: 'f1', purpose: 'invite', channel: 'text', at: '2026-09-01T10:00', updated: 1, by: 'a' };
  b.outreach.o2 = { id: 'o2', family_id: 'f1', purpose: 'invite', channel: 'email', at: '2026-09-08T10:00', updated: 2, by: 'b' };
  const m = merge(a, b);
  assert.equal(m.families.f1.phone, '2', 'newer edit wins');
  assert.ok(m.families.f2, 'new family from the other side kept');
  assert.equal(Object.keys(m.outreach).length, 2, 'both logs kept');
  assert.deepEqual(merge(a, b), merge(b, a), 'same result either way');
  const c = merge(m, { ...emptyDoc(), families: { f2: { id: 'f2', deleted: true, name: '', updated: 30, by: 'a' } } });
  assert.equal(view(c).families.length, 1, 'a removal travels');
  assert.equal(c.families.f2.name, '', 'and takes the details with it');
}
console.log('merge ok');
