# Tithing Declaration: the spec

What every version should do, whether it's this web app, a native app, an
AI-built artifact or a spreadsheet. Build it however you like. If you keep
these behaviors, someone moving between versions will find the same app.
The reference code is in `src/`. Where they disagree, the code is a bug
or this file is out of date.

## Privacy rules (not optional)

1. Member data lives only on the user's device and in storage the user owns
   (their Drive, their OneDrive, a file they keep). Never a server you run.
2. No member data goes to any AI model, analytics or third party. If your
   version uses AI for anything (it shouldn't need to), only placeholders like
   `{first}` may reach it, never a filled-in message.
3. Nothing is sent automatically. The app prepares a message and a person
   sends it.
4. Sharing is explicit, per person, and the UI says the recipient sees
   everything.
5. Deleting a family removes its details everywhere it syncs to, not just
   from view.
6. Say plainly that it isn't an official Church tool.

## Data

One document per list (JSON in the reference app):

```
settings   wardName, senderName, signupLink,
           slotWindow "HH:MM-HH:MM", slotMinutes,
           steps   ordered channels, default ["text","email","call"],
           followupDays  default 7,
           titleFilter   default "Tithing Declaration",
           templates     overrides of the six defaults below
families   id, name, first, aliases (one per line), phone, phone2, email,
           notes, status, appointment_at, appointment_source
           ("manual" | "calendar"), calendar_event_id
outreach   id, family_id, purpose ("invite" | "reminder"), channel
           ("text" | "email" | "call" | "in_person"), at, appointment_at,
           note
```

- `status` is one of `open` (not scheduled), `scheduled`, `declared` or `skip`
  (not this year).
- Times are local strings: `YYYY-MM-DD` (all day) or `YYYY-MM-DDTHH:MM`.
- Every record carries `updated` (ms) and `by` (device id) for merging.

## Daily rules

- **Remind**: `scheduled` with an appointment tomorrow or today, and no
  reminder logged for *that* appointment time. Sort by appointment time.
- **Close out**: `scheduled` whose appointment day has passed. The actions are
  Declared, or Didn't come (back to `open` with the appointment cleared).
- **Reach out**: `open` families due today. Due means never contacted, or
  `followupDays` since the last invite. Most overdue first, then most
  attempts, then name.
- **Next step**: the step after the *furthest* step reached so far (by
  position in `steps`), not after the last one used. After the last step,
  repeat the last step ("call again"). `in_person` counts as the last step.
- **Waiting**: `open`, contacted, not due yet.
- **Progress**: (scheduled + declared) ÷ (all − skip).
- **Open Sunday times**: the coming Sunday (today if Sunday), slots of
  `slotMinutes` within `slotWindow`, minus any booked time that day. On Sunday,
  slots already past are dropped.

## Calendar matching

Bookings arrive as `{ id, summary, description, start }` from Google, Outlook,
`.ics`, or any other source.

- Only events whose title contains `titleFilter` (case-insensitive) count.
- Name tokens: lowercase, accents stripped, split on anything that isn't a
  letter or digit, tokens of 2+ characters, ignoring
  `family the and tithing declaration settlement appointment with`.
- A family matches if **all** tokens of its name, or of any alias, are in the
  title (a plural in the title also counts as the singular). If none match
  there, try the description. Score is tokens × 10, plus 1 for a title match.
  The highest score wins. **A tie matches nobody**, and a person links it.
- Several bookings for one family: the soonest still ahead wins, otherwise
  the most recent.
- A match sets `scheduled`, the time, `source=calendar` and the event id. If
  the description says "Booked by NAME EMAIL" and the family has no email,
  keep that email.
- A family scheduled *by the calendar* whose booking disappeared while still
  ahead goes back to `open`. Manual appointments are never touched, and
  neither are `declared` or `skip` families.
- **Bookings to check**: upcoming bookings that matched nobody, or matched a
  `declared` or `skip` family. Skip obvious ward business (meeting, council,
  activity, fireside…). Linking one by hand adds the booker's name as an
  alias.

## Messages

| Template | Default |
|---|---|
| invite_text | Hi {first}, this is {sender} from the {ward} bishopric. Tithing declaration is coming up — could you pick a time that works for your family? {link} |
| invite_email_subject | Tithing declaration — {ward} |
| invite_email | Hi {first},⏎⏎Tithing declaration is coming up, and the bishop would love to meet with your family. You can pick a time here: {link}⏎⏎Thanks,⏎{sender} |
| reminder_text | Hi {first}, a reminder that your tithing declaration with the bishop is {when}. See you then! — {sender} |
| reminder_email_subject | Reminder: tithing declaration {when} |
| reminder_email | Hi {first},⏎⏎A reminder that your tithing declaration with the bishop is {when}.⏎⏎Thanks,⏎{sender} |

- `{first}` is the `first` field if set, otherwise the text after a comma in
  the name ("Fenn, Owen & Marta" → "Owen & Marta"), otherwise the name.
- `{when}` is written like "Sun Nov 1 at 11:15 am".
- **Text** opens `sms:` to every phone on the family as one group thread, using
  `sms:NUM1,NUM2?&body=…`. **Email** opens `mailto:` to every address. **Call**
  opens `tel:` to the first phone.
- Tapping a channel logs the outreach right away and offers Undo.

## Sync and sharing

- One file per list in the owner's cloud storage. Others get edit access
  through the provider's own sharing.
- Merge two copies record by record: each family and outreach entry keeps the
  version with the newer `updated` (ties broken by `by`), so no edit is lost.
  Removed records are kept as tombstones with no details, so the removal
  syncs. Settings: newest wins as a whole.
- Sync is read → merge → write if changed. Run it shortly after each edit, when
  the app comes to the front, and every few minutes.

## Setup flow

Welcome (privacy promise) → about you → where the list lives (or join a
shared one) → families → bookings → messages → sharing → done. Every step
except the welcome can be skipped. Setup can be rerun from Settings.
