# Tithing Declaration

A free, private helper for whoever schedules tithing declaration: the bishop,
an executive secretary, a clerk. Each day it tells you:

- **who to remind**: families with an appointment tomorrow (or today)
- **who to reach out to**: families who haven't booked, and the next step for
  each (text, then email, then a call, spaced a week apart, all adjustable)
- **what to close out**: appointments that have passed. Did they come?
- **bookings to check**: calendar bookings that didn't match exactly one family

Tap **Text** or **Email** and your phone's own Messages or mail app opens with
the message filled in. You read it, change anything you like, and press
send. The app never sends anything itself.

**Use it:** https://djb242.github.io/tithing-declaration/ on any phone or computer.
On a phone, choose "Add to Home Screen" to use it like an app.

> Not an official Church app. Please follow your leaders' guidance on handling
> member information.

## Your ward's information stays yours

- **No server.** The app is a set of files your browser downloads. Your list is
  stored in your browser and, if you choose, as one file in **your own** Google
  Drive or OneDrive.
- **Nobody else can see it**, including the people who made the app.
- **No AI.** Nothing in the app uses AI, and none of your data goes to any.
- **No tracking**, no ads and no analytics.

Full details: [privacy.html](privacy.html).

## Getting started

Open the app and the setup walks you through it, one screen at a time:

1. **About you**: ward name, how you sign messages, your sign-up link (if
   families book online), and your Sunday appointment hours.
2. **Where your list lives**: just this device, or your Google Drive or
   OneDrive so it's on your phone *and* computer. Someone already shared a list
   with you? Choose **Join a shared list** here.
3. **Your families**: paste names one per line, paste from a spreadsheet, or
   choose a CSV file. Names alone are enough to start.
4. **Bookings**: connect a Google or Outlook calendar and booked families are
   marked scheduled automatically. Another calendar app? Import its `.ics`
   file. No online booking? Type appointments in on each family.
5. **Messages**: see the invitation and reminder wording, and change it later
   in Settings.
6. **Working with others**: how to share the list.

You can rerun setup any time from Settings.

### Sharing with the bishop or a clerk

1. Keep your list in Google Drive or OneDrive.
2. **Settings → Sync and sharing**: type their email and tap **Share**.
3. They get an email. They open the app, choose **Join a shared list**, and sign
   in with that account.

Everyone you share with sees and edits the whole list, including notes. If two
of you work at the same time, the changes merge, and no contact log entry is
ever lost.

### Phone and computer

Turn on Google Drive or OneDrive sync, then open the app on your other device
and sign in with the same account. It keeps itself up to date. Without sync,
use **Settings → Backup** to move a file between devices.

## Want an AI to help you set up?

That works. Give it [SETUP-WITH-AI.md](SETUP-WITH-AI.md). It tells the AI how
to walk you through setup, and what it must never touch: your members' names,
phone numbers and emails. Those go into the app, not the chat.

## For people who build things

- **Run your own copy.** It's plain HTML and JavaScript with no build step.
  Host the folder anywhere that serves static files (GitHub Pages, Netlify,
  a USB stick with `npx serve`). To sign in with Google or Microsoft from your
  copy, register it yourself. [SETUP-WITH-AI.md](SETUP-WITH-AI.md#your-own-registration)
  has the steps.
- **Build it your own way** as a native app, an artifact or a spreadsheet.
  [SPEC.md](SPEC.md) is the behavior every version should share: the data, the
  daily rules, the message templates and the privacy rules.
- **Tests:** `node tests/test-logic.mjs && node tests/test-privacy.mjs`.
  The privacy test fails if any code mentions an AI service or talks to a host
  other than Google or Microsoft. It runs before every commit (`.githooks/`).

MIT licensed.
