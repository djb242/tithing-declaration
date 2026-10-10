// Templates and the links that open a prepared message. Nothing is ever sent
// from here: a link opens the person's own Messages, email or phone app with
// the words filled in, and they press send.

import { prettyDay, prettyTime, dayOf } from './dates.js';

export const DEFAULT_TEMPLATES = {
  invite_text: 'Hi {first}, this is {sender} from the {ward} bishopric. Tithing declaration is coming up — could you pick a time that works for your family? {link}',
  invite_email_subject: 'Tithing declaration — {ward}',
  invite_email: 'Hi {first},\n\nTithing declaration is coming up, and the bishop would love to meet with your family. You can pick a time here: {link}\n\nThanks,\n{sender}',
  reminder_text: 'Hi {first}, a reminder that your tithing declaration with the bishop is {when}. See you then! — {sender}',
  reminder_email_subject: 'Reminder: tithing declaration {when}',
  reminder_email: 'Hi {first},\n\nA reminder that your tithing declaration with the bishop is {when}.\n\nThanks,\n{sender}',
};

export const PLACEHOLDERS = {
  '{name}': 'family name as listed',
  '{first}': 'first name(s) if the family has them, otherwise the family name',
  '{ward}': 'your ward or branch',
  '{sender}': 'your name',
  '{link}': 'your sign-up link',
  '{when}': 'appointment day and time',
};

/** "Hi Owen & Marta" from "Fenn, Owen & Marta"; the family name otherwise. */
export function firstNames(name) {
  const m = String(name || '').match(/,\s*(.+)$/);
  return m ? m[1].trim() : String(name || '').trim();
}

export function whenText(appt) {
  if (!appt) return '';
  const t = prettyTime(appt);
  return `${prettyDay(dayOf(appt), { weekday: true })}${t ? ` at ${t}` : ''}`;
}

export function fill(template, family, settings) {
  const vals = {
    '{name}': family.name || '',
    '{first}': family.first || firstNames(family.name),
    '{ward}': settings.wardName || 'ward',
    '{sender}': settings.senderName || '',
    '{link}': settings.signupLink || '',
    '{when}': whenText(family.appointment_at),
  };
  return String(template || '')
    .replace(/\{(name|first|ward|sender|link|when)\}/g, (k) => vals[k])
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

const digits = (p) => String(p || '').replace(/[^\d+]/g, '');
export const phonesOf = (f) => [f.phone, f.phone2].map(digits).filter(Boolean);
export const emailsOf = (f) => String(f.email || '').split(/[\s,;]+/).filter((e) => e.includes('@'));

/** sms: link to every phone on the family (a group thread), body prefilled.
 *  "?&body=" is the form both iOS and Android accept. */
export function smsLink(f, body) {
  const nums = phonesOf(f);
  if (!nums.length) return null;
  return `sms:${nums.join(',')}?&body=${encodeURIComponent(body)}`;
}

export function mailLink(f, subject, body) {
  const to = emailsOf(f);
  if (!to.length) return null;
  return `mailto:${to.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function telLink(f) {
  const [n] = phonesOf(f);
  return n ? `tel:${n}` : null;
}

/** The link for one step. purpose: 'invite' | 'reminder'. */
export function linkFor(channel, purpose, f, settings) {
  const t = { ...DEFAULT_TEMPLATES, ...(settings.templates || {}) };
  if (channel === 'text') return smsLink(f, fill(t[`${purpose}_text`], f, settings));
  if (channel === 'email') return mailLink(f, fill(t[`${purpose}_email_subject`], f, settings), fill(t[`${purpose}_email`], f, settings));
  if (channel === 'call') return telLink(f);
  return null;
}
