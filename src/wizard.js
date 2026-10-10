// First-run setup, one question per screen. Every step can be skipped and
// changed later in Settings; "Run setup again" comes back here.

import * as calendar from './calendar.js';
import { config } from './config.js';
import { DEFAULT_TEMPLATES, fill } from './messages.js';
import { CHANNEL_LABEL } from './plan.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { attempt, connectCalendar, connectSync, esc, go, importBox, providerButtons, toast, wireImport } from './app.js';

const STEPS = ['welcome', 'you', 'storage', 'families', 'calendar', 'messages', 'sharing', 'done'];

const step = () => Math.max(0, STEPS.indexOf(sessionStorage.getItem('td-step') || 'welcome'));
function goStep(i) { sessionStorage.setItem('td-step', STEPS[Math.min(Math.max(i, 0), STEPS.length - 1)]); renderWizard(); }

const anyProvider = () => Boolean(config().google.clientId || config().microsoft.clientId);

export function renderWizard() {
  const i = step();
  const s = store.current().settings;
  const main = document.querySelector('#main');
  const nav = (next = 'Next', { skip = true } = {}) => `<p class="wiz-nav">
    ${i > 0 ? '<button class="btn" data-back>Back</button>' : ''}
    ${skip && i < STEPS.length - 1 ? '<button class="link" data-skip>Skip for now</button>' : ''}
    <button class="btn primary" data-next>${next}</button></p>`;

  const screens = {
    welcome: () => `<h2>Tithing declaration, organized</h2>
      <p>This helps whoever schedules tithing declaration keep track of every family: who has booked, who to remind the day before, and who to reach out to next.</p>
      <div class="promise"><h3>Your ward's information stays yours</h3><ul>
        <li>It's kept on this device, and in your own Google Drive or OneDrive if you choose. Nowhere else.</li>
        <li>There is no server and no account with us. Nobody who made this app can see your list.</li>
        <li>No AI is used, and nothing is ever sent for you. The app writes the message and you press send.</li>
        <li>Please follow your leaders' guidance on handling member information.</li></ul>
        <p class="meta">This is not an official Church app. <a href="privacy.html" target="_blank">Privacy details</a></p></div>
      ${nav('Get started', { skip: false })}`,

    you: () => `<h2>About you</h2><form id="w-you" class="form">
      <label>Ward or branch<input name="wardName" value="${esc(s.wardName)}" placeholder="Maple Grove Ward"></label>
      <label>Your name, as you sign messages<input name="senderName" value="${esc(s.senderName)}" placeholder="Brother Lee"></label>
      <label>Sign-up link <span class="meta">optional — a booking page families use to pick a time (Google Calendar appointment schedule, Microsoft Bookings, Calendly…)</span><input name="signupLink" type="url" value="${esc(s.signupLink)}" placeholder="https://…"></label>
      <label>Sunday hours for appointments<input name="slotWindow" value="${esc(s.slotWindow)}" placeholder="11:00-13:00"></label>
      <label>Minutes per appointment<input name="slotMinutes" type="number" min="5" max="120" value="${esc(s.slotMinutes)}"></label>
      </form>${nav()}`,

    storage: () => {
      const st = sync.getState();
      if (st) return `<h2>Where your list lives</h2><p>✓ Kept in your <b>${esc(sync.provider().label)}</b>. Open this app on your phone or computer, sign in with the same account, and it's there.</p>${nav()}`;
      return `<h2>Where should your list live?</h2>
      <p>To use it on both your phone and computer, keep it in your own cloud storage. The app saves one file there, and only this app's file — it can't see the rest of your Drive.</p>
      ${anyProvider() ? `<p>${providerButtons('sync')}</p>` : ''}
      ${anyProvider() ? `<p><b>Someone already shared their list with you?</b> Join it: ${providerButtons('join')}</p>` : ''}
      <p class="meta">Or skip this to keep the list on this device only. You can switch on syncing later in Settings.</p>${nav('Next')}`;
    },

    families: () => {
      const n = Object.values(store.current().families).filter((f) => !f.deleted).length;
      return `<h2>Your families</h2>
      ${n ? `<p>✓ ${n} families on the list. Add more below, or carry on.</p>` : '<p>Add the households in your ward. Names alone are enough to start; add phones and emails as you go so the app can prepare texts and emails.</p>'}
      <p class="hint">Tip: in your ward directory or clerk's tools, export the household list as a spreadsheet and paste it here. Do this inside the app — please don't paste member lists into an AI chat.</p>
      <div id="w-import">${importBox()}</div>${nav()}`;
    },

    calendar: () => {
      const cal = calendar.getChosen();
      return `<h2>Bookings</h2>
      <p>If families book through an online calendar, the app can read it and mark them scheduled automatically.</p>
      ${cal ? `<p>✓ Reading <b>${esc(cal.name)}</b>.</p>` : anyProvider() ? `<p>Connect your calendar: ${providerButtons('cal')}</p>` : ''}
      <div id="cal-pick"></div>
      <p>Other calendar (Apple, Yahoo, Proton…)? Export it as an .ics file and import it: <input type="file" id="w-ics" accept=".ics,text/calendar"></p>
      <p class="meta">Or skip this and enter appointments by hand on each family.</p>
      <form id="w-cal" class="form"><label>Appointment titles contain <span class="meta">so other events are ignored</span><input name="titleFilter" value="${esc(s.titleFilter)}"></label></form>
      ${nav()}`;
    },

    messages: () => {
      const t = { ...DEFAULT_TEMPLATES, ...(s.templates || {}) };
      const sample = { name: 'Fenn, Owen & Marta', appointment_at: '2026-11-01T11:15' };
      return `<h2>Messages</h2>
      <p>When you tap Text or Email, your phone's own app opens with this filled in. You review it and press send.</p>
      <div class="sample"><b>Invitation text</b><p>${esc(fill(t.invite_text, sample, s))}</p></div>
      <div class="sample"><b>Reminder text</b><p>${esc(fill(t.reminder_text, sample, s))}</p></div>
      <p>If a family doesn't book, the app suggests: ${s.steps.map((c) => CHANNEL_LABEL[c]).join(' → ')}, ${s.followupDays} days apart.</p>
      <p class="meta">Change the wording or the order any time in Settings.</p>${nav('Looks good', { skip: false })}`;
    },

    sharing: () => {
      const st = sync.getState();
      return `<h2>Working with others</h2>
      <p>The bishop, an executive secretary or a clerk can work from the same list.</p>
      <ol class="how">
        <li>Keep your list in Google Drive or OneDrive (the earlier step).</li>
        <li>In <b>Settings → Sync and sharing</b>, type their email and tap <b>Share</b>.</li>
        <li>They get an email. They open this app, choose <b>Join a shared list</b> during setup, and sign in with that same account.</li>
        <li>Everyone's changes merge — nobody's contact log is lost if you both work at once.</li>
      </ol>
      <p class="warn">Everyone you share with sees the whole list, including notes. Share only with people who would see this anyway.</p>
      ${st ? '' : '<p class="meta">Sharing needs Google Drive or OneDrive. You can turn that on later.</p>'}${nav('Next', { skip: false })}`;
    },

    done: () => `<h2>You're set</h2>
      <p>The <b>Today</b> screen shows who to remind, who to reach out to and which appointments to close out. Check it once a day.</p>
      <p class="meta">On a phone, add this page to your home screen to use it like an app.</p>
      <p class="wiz-nav"><button class="btn" data-back>Back</button><button class="btn primary" data-finish>Open Today</button></p>`,
  };

  main.innerHTML = `<section class="card wizard"><p class="meta">Step ${i + 1} of ${STEPS.length}</p>${screens[STEPS[i]]()}</section>`;

  const save = async () => {
    const f = main.querySelector('#w-you') || main.querySelector('#w-cal');
    if (f) await store.saveSettings(Object.fromEntries(new FormData(f)));
  };
  main.querySelector('[data-next]')?.addEventListener('click', () => attempt(async () => { await save(); goStep(i + 1); }));
  main.querySelector('[data-skip]')?.addEventListener('click', () => goStep(i + 1));
  main.querySelector('[data-back]')?.addEventListener('click', () => goStep(i - 1));
  main.querySelector('[data-finish]')?.addEventListener('click', () => attempt(async () => {
    await store.setLocal('setup-done', true);
    sessionStorage.removeItem('td-step');
    go('today');
  }));
  for (const b of main.querySelectorAll('[data-sync]')) b.onclick = () => attempt(async () => { await connectSync(b.dataset.sync); renderWizard(); });
  for (const b of main.querySelectorAll('[data-join]')) b.onclick = () => attempt(async () => { await connectSync(b.dataset.join, { join: true }); renderWizard(); });
  for (const b of main.querySelectorAll('[data-cal]')) b.onclick = () => attempt(() => connectCalendar(b.dataset.cal));
  if (main.querySelector('#w-import')) wireImport(main.querySelector('#w-import'), () => renderWizard());
  main.querySelector('#w-ics')?.addEventListener('change', (e) => attempt(async () => {
    const file = e.target.files[0];
    if (!file) return;
    await save();
    const r = await calendar.importIcs(await file.text());
    toast(`Read ${r.events} events; ${r.matched} matched families.`);
  }));
}
