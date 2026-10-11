// The page. Plain DOM, rendered from the document on every change.

import * as calendar from './calendar.js';
import { config, saveLocalConfig } from './config.js';
import { localDay, localStamp, prettyAppt } from './dates.js';
import { emptyDoc, fromJson, view } from './doc.js';
import { parseFamilies } from './importer.js';
import { unmatchedBookings } from './match.js';
import { DEFAULT_TEMPLATES, PLACEHOLDERS, fill, linkFor } from './messages.js';
import { CHANNELS, CHANNEL_LABEL, plan, sundaySlots } from './plan.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { renderWizard } from './wizard.js';

const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = () => $('#main');

// ------------------------------------------------------------------ toast

let toastTimer = null;
export function toast(text, { undo } = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>${undo ? '<button class="link" data-undo>Undo</button>' : ''}`;
  el.hidden = false;
  if (undo) $('[data-undo]', el).onclick = () => { undo(); el.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

export async function attempt(fn) {
  try { return await fn(); } catch (err) { console.error(err); toast(err.message || String(err)); return undefined; }
}

// ------------------------------------------------------------------ state

function currentPlan() {
  const doc = store.current();
  const { families, outreach } = view(doc);
  const s = doc.settings;
  const today = localDay();
  const p = plan(families, outreach, { today, followupDays: Number(s.followupDays) || 7, steps: s.steps });
  const booked = [...doc.events.map((e) => e.start), ...families.map((f) => f.appointment_at)];
  return {
    ...p,
    unmatched: unmatchedBookings(doc.events, families, today, doc.ignored),
    sunday: sundaySlots({ today, nowTime: localStamp().slice(11, 16), window: s.slotWindow, minutes: Number(s.slotMinutes) || 15, booked }),
    outreach,
  };
}

// ------------------------------------------------------------------ routes

const ROUTES = { today: renderToday, families: renderFamilies, family: renderFamily, settings: renderSettings, setup: renderWizard };

export function go(hash) { location.hash = hash; }

export function render() {
  const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = ROUTES[route] || renderToday;
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('on', a.getAttribute('href') === `#${route || 'today'}`);
  document.body.classList.toggle('in-setup', route === 'setup');
  renderSyncBar();
  fn(arg);
}

function renderSyncBar() {
  const st = sync.getStatus();
  const s = sync.getState();
  const bar = $('#syncbar');
  if (!s) { bar.hidden = true; return; }
  const p = sync.provider();
  bar.hidden = false;
  if (st.needsSignIn) {
    bar.className = 'syncbar warn';
    bar.innerHTML = `Sync with ${esc(p.label)} is paused. <button class="link" data-resign>Sign in again</button>`;
    $('[data-resign]', bar).onclick = () => attempt(async () => { await p.signIn(); await sync.syncNow(); });
  } else if (!st.ok) {
    bar.className = 'syncbar warn';
    bar.innerHTML = `Couldn't sync: ${esc(st.error)} <button class="link" data-retry>Try again</button>`;
    $('[data-retry]', bar).onclick = () => sync.syncNow();
  } else {
    bar.className = 'syncbar';
    bar.textContent = st.at ? `Synced with ${p.label} at ${new Date(st.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : `Syncing with ${p.label}…`;
  }
}

// ------------------------------------------------------------------ today

// Small inline icons, drawn here so nothing loads from another site.
const ICON = {
  text: '<path d="M4 5h16v11H9l-5 4z"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  call: '<path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2"/>',
  in_person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
};
const icon = (ch) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${ICON[ch] || ''}</svg>`;

// A steady color per family, from its name, for the initials circle.
const HUES = [218, 200, 30, 150, 350, 260, 45, 180];
function avatar(name) {
  const clean = String(name || '?').replace(/,.*$/, '').trim();
  let h = 0;
  for (const c of clean) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const parts = clean.split(/[\s-]+/).filter(Boolean);
  const ini = ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
  return `<span class="avatar" style="--h:${HUES[h % HUES.length]}" aria-hidden="true">${esc(ini)}</span>`;
}

function stepButtons(f, purpose, primary) {
  const s = store.current().settings;
  const chans = purpose === 'reminder' ? ['text', 'email', 'call'] : [...new Set([...(s.steps || []), 'text', 'email', 'call'])];
  const sorted = [primary, ...chans.filter((c) => c !== primary)];
  return sorted.map((ch) => {
    const href = linkFor(ch, purpose, f, s);
    const cls = `btn ${ch === primary ? 'primary' : 'ghost'}${href ? '' : ' no-contact'}`;
    const attrs = `data-log="${ch}" data-purpose="${purpose}" data-id="${esc(f.id)}"`;
    if (!href) return `<button class="${cls}" ${attrs} title="No ${ch === 'email' ? 'email' : 'phone number'} on file. Tapping logs it as done." aria-label="${CHANNEL_LABEL[ch]} (log only)">${icon(ch)}<span>${CHANNEL_LABEL[ch]}</span></button>`;
    return `<a class="${cls}" href="${esc(href)}" ${attrs}>${icon(ch)}<span>${CHANNEL_LABEL[ch]}</span></a>`;
  }).join('');
}

function wireLogging(root) {
  for (const el of root.querySelectorAll('[data-log]')) {
    el.addEventListener('click', () => {
      const f = store.current().families[el.dataset.id];
      const purpose = el.dataset.purpose;
      const channel = el.dataset.log;
      attempt(async () => {
        await store.logOutreach(f.id, { purpose, channel, appointment_at: purpose === 'reminder' ? f.appointment_at : null });
        const ids = Object.keys(store.current().outreach);
        const id = ids[ids.length - 1];
        toast(`Logged: ${CHANNEL_LABEL[channel].toLowerCase()} ${purpose === 'reminder' ? 'reminder to' : 'to'} ${f.name}`, { undo: () => store.deleteOutreach(id) });
      });
    });
  }
}

const card = (title, body, extra = '', id = '') => `<section class="group"${id ? ` id="sec-${id}"` : ''}><h2>${title}</h2><div class="card">${extra}${body}</div></section>`;
const count = (n, tone = '') => `<span class="count ${tone}">${n}</span>`;

function renderToday() {
  const doc = store.current();
  const p = currentPlan();
  const c = p.counts;
  const done = c.scheduled + c.declared;
  const counted = c.total - (c.skip || 0);
  const pct = counted ? Math.round((done / counted) * 100) : 0;

  if (!c.total) {
    main().innerHTML = `<section class="card empty">${CAUGHT_UP.replace('M58 57l15 15 30-34', 'M80 35v40M60 55h40')}<h2>No families yet</h2><p>Add your ward's families to get started.</p>
      <p><a class="btn primary" href="#families">Add families</a> <a class="btn" href="#setup">Run setup</a></p></section>`;
    return;
  }

  const fam = (f, line, buttons) => `<li class="row">${avatar(f.name)}<div class="who"><a href="#family/${esc(f.id)}">${esc(f.name)}</a>
    <span class="meta">${line}</span>${f.notes ? `<span class="note">${esc(f.notes)}</span>` : ''}</div><div class="acts">${buttons}</div></li>`;

  const slots = p.sunday;
  const slotsCard = slots.open.length || slots.taken.length
    ? card(`Open on ${esc(slots.pretty)}`, `<p class="slots">${slots.open.map((s) => `<span class="chip">${esc(s.pretty)}</span>`).join('') || 'Every slot is taken.'}</p>
      ${slots.open.length ? '<button class="link" data-copy-slots>Copy these times</button>' : ''}`)
    : '';

  const remind = p.remind.length ? card(`Remind ${count(p.remind.length, 'blue')}`, `<ul>${p.remind.map((f) =>
    fam(f, `${f.apptIsToday ? 'Today' : 'Tomorrow'}${f.apptTime ? `, ${esc(f.apptTime)}` : ''}`, stepButtons(f, 'reminder', 'text'))).join('')}</ul>`, '', 'remind') : '';

  const close = p.followUp.length ? card(`Close out ${count(p.followUp.length, 'yellow')}`, `<p class="hint">These appointments have passed. Did they come?</p><ul>${p.followUp.map((f) =>
    fam(f, `Was ${esc(f.apptPretty)}`, `<button class="btn primary" data-status="declared" data-id="${esc(f.id)}">Declared</button>
      <button class="btn" data-status="open" data-id="${esc(f.id)}">Didn't come</button>`)).join('')}</ul>`, '', 'close') : '';

  const reach = p.reach.length ? card(`Reach out ${count(p.reach.length, '')}`, `<ul>${p.reach.map((f) =>
    fam(f, `${esc(f.lastLine)} · next: ${CHANNEL_LABEL[f.next.channel].toLowerCase()}${f.next.again ? ' again' : ''}`, stepButtons(f, 'invite', f.next.channel))).join('')}</ul>`, '', 'reach') : '';

  const unmatched = p.unmatched.length ? card(`Bookings to check ${count(p.unmatched.length, 'red')}`,
    `<p class="hint">These bookings didn't match exactly one family, so nobody will be reminded about them.</p><ul>${p.unmatched.map((e) => `
    <li class="row"><div class="who"><b>${esc(e.summary)}</b><span class="meta">${esc(prettyAppt(e.start))}${e.reason ? ` — ${esc(e.reason)}` : ''}${e.booker ? ` — booked by ${esc(e.booker.name)}` : ''}</span></div>
    <div class="acts"><select data-link-event="${esc(e.id)}"><option value="">Link to family…</option>${p.all.filter((f) => f.status !== 'skip').sort((a, b) => a.name.localeCompare(b.name)).map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select>
    <button class="btn" data-ignore="${esc(e.id)}">Not an appointment</button></div></li>`).join('')}</ul>`, '', 'check') : '';

  const nothing = !p.remind.length && !p.followUp.length && !p.reach.length && !p.unmatched.length
    ? card('All caught up', `${CAUGHT_UP}<p class="center">Nobody to remind or reach out to today.${p.waiting.length ? ` Next follow-up: ${esc(p.waiting[0].name)}, ${esc(p.waiting[0].dueOn)}.` : ''}</p>`) : '';

  const upcoming = p.upcoming.length ? card(`Coming up ${count(p.upcoming.length, 'green')}`, `<ul class="plain">${p.upcoming.slice(0, 12).map((f) =>
    `<li class="line"><a href="#family/${esc(f.id)}">${esc(f.name)}</a><span class="meta">${esc(f.apptPretty)}${f.reminded ? ' · reminded' : ''}</span></li>`).join('')}</ul>`) : '';

  main().innerHTML = `
    <section class="hero">
      ${doc.settings.wardName ? `<p class="eyebrow">${esc(doc.settings.wardName)}</p>` : ''}
      <p class="big"><span class="num">${done}</span><span class="of">/${counted}</span></p>
      <p class="sub">families scheduled or declared · <b>${pct}%</b></p>
      <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      <div class="jump">${[['check', 'To check', p.unmatched.length], ['remind', 'Remind', p.remind.length], ['close', 'Close out', p.followUp.length], ['reach', 'Reach out', p.reach.length]]
        .filter(([, , n]) => n).map(([k, label, n]) => `<button class="pill" data-jump="${k}">${label} <b>${n}</b></button>`).join('')}</div>
    </section>
    ${unmatched}${remind}${close}${reach}${nothing}${slotsCard}${upcoming}`;

  wireLogging(main());
  for (const b of main().querySelectorAll('[data-jump]')) b.onclick = () => document.getElementById(`sec-${b.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  for (const b of main().querySelectorAll('[data-status]')) {
    b.onclick = () => attempt(async () => {
      const id = b.dataset.id;
      const before = store.current().families[id];
      const fields = b.dataset.status === 'open'
        ? { status: 'open', appointment_at: null, appointment_source: null, calendar_event_id: null }
        : { status: 'declared' };
      await store.updateFamily(id, fields);
      toast(`${before.name}: ${b.dataset.status === 'open' ? 'back on the reach-out list' : 'declared'}`, {
        undo: () => store.updateFamily(id, { status: before.status, appointment_at: before.appointment_at, appointment_source: before.appointment_source, calendar_event_id: before.calendar_event_id }),
      });
    });
  }
  for (const s of main().querySelectorAll('[data-link-event]')) {
    s.onchange = () => attempt(async () => {
      if (!s.value) return;
      const ev = store.current().events.find((e) => e.id === s.dataset.linkEvent);
      const f = store.current().families[s.value];
      const alias = ev.booker?.name && !String(f.aliases).includes(ev.booker.name) ? `${f.aliases ? `${f.aliases}\n` : ''}${ev.booker.name}` : f.aliases;
      await store.updateFamily(f.id, { status: 'scheduled', appointment_at: ev.start, appointment_source: 'calendar', calendar_event_id: ev.id, aliases: alias });
      await store.applyCalendar({ changes: [], tagged: store.current().events.map((e) => (e.id === ev.id ? { ...e, family_id: f.id } : e)) });
      toast(`Linked to ${f.name}. Future bookings under "${ev.booker?.name || ev.summary}" will match too.`);
    });
  }
  for (const b of main().querySelectorAll('[data-ignore]')) b.onclick = () => store.ignoreBooking(b.dataset.ignore);
  const copy = $('[data-copy-slots]');
  if (copy) copy.onclick = () => attempt(async () => {
    await navigator.clipboard.writeText(`Open times ${slots.pretty}: ${slots.open.map((s) => s.pretty).join(', ')}`);
    toast('Copied');
  });
}

// ------------------------------------------------------------------ families

const CAUGHT_UP = `<svg class="art" viewBox="0 0 160 110" aria-hidden="true"><circle cx="80" cy="55" r="44" fill="var(--lemon)"/><path d="M58 57l15 15 30-34" fill="none" stroke="var(--brand)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24" r="6" fill="var(--brand)"/><circle cx="140" cy="86" r="8" fill="var(--brand)" opacity=".35"/><rect x="128" y="14" width="14" height="14" rx="4" fill="var(--brand)" opacity=".6" transform="rotate(20 135 21)"/></svg>`;

const STATUS_LABEL = { open: 'Not scheduled', scheduled: 'Scheduled', declared: 'Declared', skip: 'Not this year' };

function renderFamilies() {
  const p = currentPlan();
  const q = sessionStorage.getItem('td-q') || '';
  const list = p.all
    .filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  main().innerHTML = `
    <section class="card">
      <div class="toolbar"><input type="search" id="q" placeholder="Search ${p.all.length} families" value="${esc(q)}">
      <button class="btn primary" id="add">Add</button><button class="btn" id="import">Import list</button></div>
      <ul class="plain fams">${list.map((f) => `<li><a href="#family/${esc(f.id)}">${esc(f.name)}</a>
        <span class="status s-${f.status}">${STATUS_LABEL[f.status]}${f.status === 'scheduled' && f.apptPretty ? ` · ${esc(f.apptPretty)}` : ''}</span></li>`).join('') || '<li class="meta">No matches.</li>'}</ul>
    </section>
    <section class="card" id="import-box" hidden>${importBox()}</section>`;
  const qi = $('#q');
  qi.oninput = () => { sessionStorage.setItem('td-q', qi.value); renderFamilies(); $('#q').focus(); $('#q').setSelectionRange(qi.value.length, qi.value.length); };
  $('#add').onclick = () => attempt(async () => {
    const name = prompt_('Family name (as you want it listed, e.g. "Fenn, Owen & Marta")');
    if (!name) return;
    const f = await store.addFamily({ name });
    go(`family/${f.id}`);
  });
  $('#import').onclick = () => { $('#import-box').hidden = false; $('#import-box').scrollIntoView({ behavior: 'smooth' }); };
  wireImport($('#import-box'), () => render());
}

// A tiny inline prompt so no browser dialog blocks the page.
function prompt_(label) {
  return window.prompt(label); // eslint-disable-line no-alert
}

export function importBox() {
  return `<h2>Import families</h2>
    <p class="hint">Paste names one per line, or paste from a spreadsheet, or choose a CSV file (columns like Name, Phone, Email). It stays on this device.</p>
    <textarea id="import-text" rows="6" placeholder="Abbott&#10;Carter, Ann & Joe&#10;Fenn"></textarea>
    <p><input type="file" id="import-file" accept=".csv,.txt,text/csv,text/plain"></p>
    <p><button class="btn primary" id="import-go">Add these families</button> <span id="import-preview" class="meta"></span></p>`;
}

export function wireImport(root, after) {
  const text = $('#import-text', root);
  const preview = () => { const n = parseFamilies(text.value).length; $('#import-preview', root).textContent = n ? `${n} families found` : ''; };
  text.oninput = preview;
  $('#import-file', root).onchange = async (e) => { const f = e.target.files[0]; if (f) { text.value = await f.text(); preview(); } };
  $('#import-go', root).onclick = () => attempt(async () => {
    const list = parseFamilies(text.value);
    if (!list.length) return toast('Nothing to import yet.');
    const n = await store.addFamilies(list);
    text.value = '';
    toast(`Added ${n} ${n === 1 ? 'family' : 'families'}${n < list.length ? ` (${list.length - n} already listed)` : ''}`);
    after?.(n);
  });
}

function renderFamily(id) {
  const doc = store.current();
  const f = doc.families[id];
  if (!f || f.deleted) { main().innerHTML = '<section class="card"><p>That family is gone. <a href="#families">Back to the list</a></p></section>'; return; }
  const p = currentPlan();
  const a = p.all.find((x) => x.id === id);
  const history = (p.outreach.get(id) || []).slice().reverse();
  const field = (k, label, type = 'text', hint = '') => `<label>${label}${hint ? ` <span class="meta">${hint}</span>` : ''}<input name="${k}" type="${type}" value="${esc(f[k] || '')}"></label>`;
  main().innerHTML = `
    <section class="card">
      <p><a href="#families">← Families</a></p>
      <h2>${esc(f.name)}</h2>
      ${a.status === 'open' ? `<p class="meta">${esc(a.lastLine)} · next: ${CHANNEL_LABEL[a.next.channel]}</p><div class="acts">${stepButtons(a, 'invite', a.next.channel)}</div>` : ''}
      ${a.status === 'scheduled' ? `<p class="meta">Appointment ${esc(a.apptPretty)}${a.reminded ? ' · reminded' : ''}</p><div class="acts">${stepButtons(a, 'reminder', 'text')}</div>` : ''}
      <form id="fam" class="form">
        ${field('name', 'Family name')}
        ${field('first', 'First names', 'text', 'used in messages, e.g. "Owen & Marta"')}
        ${field('phone', 'Phone', 'tel')}
        ${field('phone2', 'Second phone', 'tel', 'texts go to both as a group')}
        ${field('email', 'Email', 'text', 'several allowed, separated by commas')}
        <label>Status<select name="status">${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Appointment<input name="appointment_at" type="datetime-local" value="${esc(f.appointment_at && f.appointment_at.length === 10 ? `${f.appointment_at}T00:00` : f.appointment_at || '')}"></label>
        <label>Other names they book under <span class="meta">one per line, for calendar matching</span><textarea name="aliases" rows="2">${esc(f.aliases || '')}</textarea></label>
        <label>Notes<textarea name="notes" rows="2">${esc(f.notes || '')}</textarea></label>
        <p><button class="btn primary">Save</button> <button type="button" class="btn danger" id="del">Remove family</button></p>
      </form>
    </section>
    <section class="card"><h2>History</h2>
      <ul class="plain">${history.map((o) => `<li>${esc(o.at.replace('T', ' '))} — ${o.purpose === 'reminder' ? 'reminder' : 'invite'} by ${esc(CHANNEL_LABEL[o.channel] || o.channel)}${o.note ? ` — ${esc(o.note)}` : ''} <button class="link" data-del-o="${esc(o.id)}">remove</button></li>`).join('') || '<li class="meta">No contact logged yet.</li>'}</ul>
      <p class="acts">${CHANNELS.map((c) => `<button class="btn" data-manual="${c}">Log ${CHANNEL_LABEL[c].toLowerCase()}</button>`).join('')}</p>
    </section>`;
  wireLogging(main());
  $('#fam').onsubmit = (e) => {
    e.preventDefault();
    attempt(async () => {
      const data = Object.fromEntries(new FormData(e.target));
      data.appointment_at = data.appointment_at ? data.appointment_at.replace(/T00:00$/, '') : null;
      if (data.appointment_at && data.status === 'open') data.status = 'scheduled';
      if (!data.appointment_at && data.status === 'scheduled') return toast('Add the appointment time, or set the status back.');
      if (data.appointment_at !== f.appointment_at) { data.appointment_source = 'manual'; data.calendar_event_id = null; }
      await store.updateFamily(id, data);
      toast('Saved');
    });
  };
  $('#del').onclick = () => {
    if (!window.confirm(`Remove ${f.name} and their history?`)) return; // eslint-disable-line no-alert
    attempt(async () => { await store.deleteFamily(id); go('families'); });
  };
  for (const b of main().querySelectorAll('[data-del-o]')) b.onclick = () => store.deleteOutreach(b.dataset.delO);
  for (const b of main().querySelectorAll('[data-manual]')) {
    b.onclick = () => store.logOutreach(id, { purpose: f.status === 'scheduled' ? 'reminder' : 'invite', channel: b.dataset.manual, appointment_at: f.status === 'scheduled' ? f.appointment_at : null });
  }
}

// ------------------------------------------------------------------ settings

export function providerButtons(kind) {
  const c = config();
  const btns = [];
  if (c.google.clientId) btns.push(`<button class="btn" data-${kind}="google">Google</button>`);
  if (c.microsoft.clientId) btns.push(`<button class="btn" data-${kind}="microsoft">Microsoft (Outlook / OneDrive)</button>`);
  return btns.length ? btns.join(' ') : '<p class="meta">Sign-in isn\'t set up on this copy of the app yet. See Settings → Advanced.</p>';
}

export async function connectSync(name, { join = false } = {}) {
  const p = sync.PROVIDERS[name];
  if (name === 'microsoft' && !p.hasToken()) {
    sessionStorage.setItem('td-after-ms', join ? 'join' : 'sync');
    return p.signIn(); // leaves the page; boot() finishes
  }
  if (name === 'google' && !p.hasToken()) await p.signIn();
  if (join) return joinShared(name);
  await sync.connect(name);
  toast(`Your list is now kept in your ${p.label}.`);
}

export async function joinShared(name) {
  const p = sync.PROVIDERS[name];
  let ref = null;
  if (name === 'google') ref = await p.pickShared();
  else {
    const lists = await p.sharedLists();
    if (!lists.length) throw new Error('Nothing has been shared with this Microsoft account yet. Ask the owner to share it, then try again.');
    ref = lists[0];
  }
  if (!ref) return;
  await sync.connect(name, ref);
  toast('Joined the shared list.');
}

export async function connectCalendar(name) {
  const p = sync.PROVIDERS[name];
  if (name === 'microsoft' && !p.hasToken()) { sessionStorage.setItem('td-after-ms', 'calendar'); return p.signIn(); }
  if (name === 'google' && !p.hasCalendar()) await p.signIn({ calendar: true });
  const cals = await p.calendars();
  const box = $('#cal-pick');
  box.innerHTML = `<label>Which calendar has the bookings?<select id="cal-select">${cals.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.primary ? ' (main)' : ''}</option>`).join('')}</select></label>
    <button class="btn primary" id="cal-use">Use this calendar</button>`;
  $('#cal-use').onclick = () => attempt(async () => {
    const sel = $('#cal-select');
    await calendar.choose(name, { id: sel.value, name: sel.selectedOptions[0].textContent });
    const r = await calendar.refresh();
    toast(`Read ${r.events} events; ${r.matched} matched families.`);
    render();
  });
}

function renderSettings() {
  const s = store.current().settings;
  const t = { ...DEFAULT_TEMPLATES, ...(s.templates || {}) };
  const st = sync.getState();
  const cal = calendar.getChosen();
  const c = config();
  const sample = { name: 'Fenn, Owen & Marta', appointment_at: `${localDay()}T11:15` };

  main().innerHTML = `
  <section class="card"><h2>Ward and you</h2><form id="basics" class="form">
    <label>Ward or branch<input name="wardName" value="${esc(s.wardName)}" placeholder="Maple Grove Ward"></label>
    <label>Your name <span class="meta">signs your messages</span><input name="senderName" value="${esc(s.senderName)}" placeholder="Brother Lee"></label>
    <label>Sign-up link <span class="meta">where families book a time</span><input name="signupLink" type="url" value="${esc(s.signupLink)}" placeholder="https://calendar.app.google/…"></label>
    <label>Sunday hours <span class="meta">for the open-times list</span><input name="slotWindow" value="${esc(s.slotWindow)}" placeholder="11:00-13:00"></label>
    <label>Minutes per appointment<input name="slotMinutes" type="number" min="5" max="120" value="${esc(s.slotMinutes)}"></label>
    <button class="btn primary">Save</button></form></section>

  <section class="card"><h2>Reaching out</h2><form id="steps" class="form">
    <p class="hint">When a family hasn't booked, the app suggests these in order, one per round.</p>
    ${[0, 1, 2].map((i) => `<label>Step ${i + 1}<select name="step${i}"><option value="">—</option>${['text', 'email', 'call', 'in_person'].map((ch) => `<option value="${ch}" ${s.steps[i] === ch ? 'selected' : ''}>${CHANNEL_LABEL[ch]}</option>`).join('')}</select></label>`).join('')}
    <label>Days between tries<input name="followupDays" type="number" min="1" max="60" value="${esc(s.followupDays)}"></label>
    <button class="btn primary">Save</button></form></section>

  <section class="card"><h2>Message templates</h2><form id="tpl" class="form">
    <p class="hint">Fill-ins: ${Object.entries(PLACEHOLDERS).map(([k, v]) => `<code>${k}</code> ${esc(v)}`).join(' · ')}</p>
    ${Object.keys(DEFAULT_TEMPLATES).map((k) => `<label>${esc(k.replace(/_/g, ' '))}<textarea name="${k}" rows="${k.endsWith('subject') ? 1 : 3}">${esc(t[k])}</textarea>
      <span class="preview">${esc(fill(t[k], sample, s))}</span></label>`).join('')}
    <button class="btn primary">Save</button> <button type="button" class="btn" id="tpl-reset">Back to defaults</button></form></section>

  <section class="card"><h2>Calendar</h2>
    <p class="hint">Bookings on your calendar are matched to families by name. Only events whose title contains the text below are read as appointments.</p>
    <form id="calf" class="form"><label>Appointment title contains<input name="titleFilter" value="${esc(s.titleFilter)}"></label><button class="btn">Save</button></form>
    ${cal ? `<p>Reading <b>${esc(cal.name)}</b>. <button class="btn" id="cal-refresh">Check now</button> <button class="link" id="cal-off">Stop</button></p>` : `<p>Connect a calendar: ${providerButtons('cal')}</p>`}
    <div id="cal-pick"></div>
    <p>Or import a calendar file (.ics) from any calendar app: <input type="file" id="ics" accept=".ics,text/calendar"></p>
  </section>

  <section class="card"><h2>Sync and sharing</h2>
    ${st ? `<p>Your list is kept in your <b>${esc(sync.provider().label)}</b> as “${esc(st.ref.name)}”.</p>
      <h3>Share with someone</h3>
      <p class="hint">They'll see and edit everything in this list, including notes. Share only with people who would see this anyway, such as the bishop or executive secretary.</p>
      <form id="sharef" class="inline"><input type="email" name="email" placeholder="their ${st.provider === 'google' ? 'Google' : 'Microsoft'} email" required><button class="btn primary">Share</button></form>
      <div id="people" class="meta">Loading who has access…</div>
      <p><button class="link" id="sync-off">Stop syncing on this device</button></p>`
    : `<p>Right now your list is only on this device. Keep it in your own cloud storage to use it on your phone and computer, or to share it.</p>
      <p>Keep it in: ${providerButtons('sync')}</p>
      <p>Someone shared a list with you? Join it: ${providerButtons('join')}</p>`}
  </section>

  <section class="card"><h2>Backup</h2>
    <p><button class="btn" id="export">Download a backup file</button> <label class="btn">Restore from a file<input type="file" id="restore" accept=".json,application/json" hidden></label></p>
    <p class="hint">A backup has everything in it, including contact details. Keep it somewhere private.</p>
  </section>

  <section class="card"><h2>Erase</h2>
    <p><button class="btn danger" id="erase">Erase everything on this device</button></p>
    <p class="hint">Removes the list, settings and sign-ins from this browser. A synced file in your Drive or OneDrive stays there until you delete it.</p>
  </section>

  <details class="card"><summary>Advanced: your own Google / Microsoft registration</summary>
    <p class="hint">Only needed if you run your own copy. These are public IDs, kept on this device only. See SETUP-WITH-AI.md.</p>
    <form id="adv" class="form">
      <label>Google client ID<input name="g_clientId" value="${esc(c.google.clientId)}"></label>
      <label>Google API key (for the shared-list picker)<input name="g_apiKey" value="${esc(c.google.apiKey)}"></label>
      <label>Google project number<input name="g_appId" value="${esc(c.google.appId)}"></label>
      <label>Microsoft client ID<input name="m_clientId" value="${esc(c.microsoft.clientId)}"></label>
      <button class="btn">Save</button></form>
  </details>
  <p class="meta center"><a href="#setup">Run setup again</a> · <a href="privacy.html">Privacy</a></p>`;

  const formData = (id) => Object.fromEntries(new FormData($(id)));
  $('#basics').onsubmit = (e) => { e.preventDefault(); attempt(async () => { await store.saveSettings(formData('#basics')); toast('Saved'); }); };
  $('#steps').onsubmit = (e) => {
    e.preventDefault();
    const d = formData('#steps');
    const steps = [d.step0, d.step1, d.step2].filter(Boolean);
    if (!steps.length) return toast('Pick at least one step.');
    attempt(async () => { await store.saveSettings({ steps, followupDays: Number(d.followupDays) || 7 }); toast('Saved'); });
  };
  $('#tpl').onsubmit = (e) => { e.preventDefault(); attempt(async () => { await store.saveSettings({ templates: formData('#tpl') }); toast('Saved'); }); };
  $('#tpl-reset').onclick = () => attempt(() => store.saveSettings({ templates: {} }));
  $('#calf').onsubmit = (e) => { e.preventDefault(); attempt(async () => { await store.saveSettings(formData('#calf')); await calendar.refresh(); toast('Saved'); }); };
  for (const b of main().querySelectorAll('[data-cal]')) b.onclick = () => attempt(() => connectCalendar(b.dataset.cal));
  for (const b of main().querySelectorAll('[data-sync]')) b.onclick = () => attempt(() => connectSync(b.dataset.sync));
  for (const b of main().querySelectorAll('[data-join]')) b.onclick = () => attempt(() => connectSync(b.dataset.join, { join: true }));
  $('#cal-refresh')?.addEventListener('click', () => attempt(async () => { const r = await calendar.refresh(); toast(`Read ${r.events} events; ${r.changes.length} changes.`); }));
  $('#cal-off')?.addEventListener('click', () => attempt(async () => { await calendar.choose(null); render(); }));
  $('#ics').onchange = (e) => attempt(async () => {
    const f = e.target.files[0];
    if (!f) return;
    const r = await calendar.importIcs(await f.text());
    toast(`Read ${r.events} events; ${r.matched} matched families.`);
  });
  $('#sync-off')?.addEventListener('click', () => attempt(async () => { await sync.disconnect(); toast('This device stopped syncing. Your list is still here.'); render(); }));
  if ($('#sharef')) {
    const p = sync.provider();
    const people = () => p.sharedWith(st.ref).then((list) => {
      $('#people').innerHTML = list.length
        ? `Shared with: ${list.map((x) => `${esc(x.name || x.email)} <button class="link" data-unshare="${esc(x.id)}">remove</button>`).join(', ')}`
        : 'Not shared with anyone yet.';
      for (const b of document.querySelectorAll('[data-unshare]')) b.onclick = () => attempt(async () => { await p.unshare(st.ref, b.dataset.unshare); people(); });
    }).catch(() => { $('#people').textContent = ''; });
    people();
    $('#sharef').onsubmit = (e) => {
      e.preventDefault();
      attempt(async () => {
        const email = formData('#sharef').email;
        await p.share(st.ref, email);
        e.target.reset();
        toast(`Shared with ${email}. They'll get an email with how to join.`);
        people();
      });
    };
  }
  $('#export').onclick = () => {
    const blob = new Blob([JSON.stringify(store.current(), null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tithing-declaration-backup-${localDay()}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#restore').onchange = (e) => attempt(async () => {
    const f = e.target.files[0];
    if (!f) return;
    await store.mergeIn(fromJson(await f.text()), { fromSync: false });
    toast('Restored. Anything already here was kept too.');
  });
  $('#erase').onclick = () => {
    if (!window.confirm('Erase the list, settings and sign-ins from this device? This cannot be undone.')) return; // eslint-disable-line no-alert
    attempt(async () => { await sync.disconnect().catch(() => {}); await store.eraseLocal(); location.replace(location.pathname); });
  };
  $('#adv').onsubmit = (e) => {
    e.preventDefault();
    const d = formData('#adv');
    saveLocalConfig({ google: { clientId: d.g_clientId.trim(), apiKey: d.g_apiKey.trim(), appId: d.g_appId.trim() }, microsoft: { clientId: d.m_clientId.trim() } });
    toast('Saved on this device');
    render();
  };
}

// ------------------------------------------------------------------ boot

async function boot() {
  await store.load();
  await sync.init();
  await calendar.init();

  // Returning from Microsoft's sign-in page.
  try {
    if (await sync.PROVIDERS.microsoft.finishSignIn()) {
      const next = sessionStorage.getItem('td-after-ms');
      sessionStorage.removeItem('td-after-ms');
      if (next === 'sync') await connectSync('microsoft');
      else if (next === 'join') await joinShared('microsoft');
      else if (next === 'calendar') { location.hash = 'settings'; render(); await connectCalendar('microsoft'); }
    }
  } catch (err) { toast(err.message); }

  store.onChange(() => render());
  sync.onStatus(() => renderSyncBar());
  window.addEventListener('hashchange', render);
  sync.startAuto();

  const setupDone = await store.getLocal('setup-done');
  if (!setupDone && !Object.keys(store.current().families).length && !sync.getState()) location.hash = 'setup';
  render();
  sync.syncNow();
  if (calendar.getChosen()) calendar.refresh().catch(() => {});

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot().catch((err) => { main().innerHTML = `<section class="card"><h2>Couldn't start</h2><p>${esc(err.message)}</p></section>`; });

export { emptyDoc };
