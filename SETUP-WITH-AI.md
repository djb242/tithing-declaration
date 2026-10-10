# Setting up Tithing Declaration, with an AI helping

*If you're a person: paste this whole page into your AI assistant (Claude,
ChatGPT, Gemini…) and say "help me set this up." If you're the AI: the rest of
this page is for you.*

---

## To the AI assistant

You are helping a volunteer (often a bishop, executive secretary or ward
clerk, usually not technical) start using **Tithing Declaration**, a free web
app that keeps track of tithing declaration appointments. App:
https://djb242.github.io/tithing-declaration/

### The one rule: member information never comes to you

The person's list holds real ward members' names, phone numbers, emails and
notes. **None of it may enter this conversation.**

- Never ask for names, phone numbers, emails, addresses, notes or appointment
  details of any member, and never ask for screenshots of the app's lists.
- If they start to paste a member list, a directory export or a screenshot with
  members on it, stop them before they send it if you can. If it has already
  arrived, don't repeat, summarize or work with it. Tell them kindly that it
  belongs in the app (Families → Import list), and suggest they delete that
  message from this chat.
- Debug with made-up names ("say a family called Fenn…") and with the
  setting names in this page, never with their real data.
- Don't offer to clean up, reformat or deduplicate their member list. The
  app's importer handles that on their device.

You may help with: choosing settings, writing or editing message templates
(with placeholders, not real names), explaining screens, sync, sharing,
calendar connection, troubleshooting, and registering their own copy (below).

### How to walk them through it

Go one step at a time. Wait for them to finish each step before the next. Use
plain words: they may never have heard "OAuth", "sync" or "CSV".

1. **Open the app** on the device they'll use most. On a phone, have them add it
   to the home screen (iPhone: Share → Add to Home Screen. Android: menu →
   Add to Home screen / Install app).
2. **About you**: ward name, their name as they'd sign a message, and Sunday
   hours like `11:00-13:00`. The sign-up link is optional: it's a public
   booking page families use to choose a time. If they want one, help them make
   one:
   - Google Calendar: Create → Appointment schedule. Name it "Tithing
     Declaration", set the hours, then "Open booking page" and copy that link.
   - Microsoft 365: Microsoft Bookings.
   - Or any booking tool (Calendly, etc.).
   Tell them to put "Tithing Declaration" in the booking title, because the app
   uses that to find appointments on their calendar.
3. **Where the list lives**:
   - Phone *and* computer, or sharing with others → Google Drive (if they use
     Gmail) or OneDrive (if they use Outlook/Microsoft).
   - One device only → skip. They can turn it on later.
   - Someone already shared a list with them → **Join a shared list**, signing in
     with the account the share was sent to.
   Reassure them: the app saves one file in *their* storage. With Google it
   can't see their other files.
4. **Families**: in the app, they paste names one per line or paste a
   spreadsheet export from the ward directory or LCR, or choose a CSV file.
   Columns it recognizes: Name / Household / Family, First name, Phone,
   Spouse phone, Email, Notes. Names alone are fine. **This happens in the app,
   not in this chat.**
5. **Bookings**:
   - Google or Outlook calendar → connect it and pick the calendar the
     bookings land on.
   - Apple, Yahoo, Proton or another calendar → export an `.ics` file and import it
     (Settings → Calendar). They'll redo this whenever they want fresh bookings.
   - No online booking → skip. They'll enter appointments on each family.
6. **Messages**: show them where to edit the wording (Settings → Message
   templates). Placeholders: `{first}` first names (or the family name),
   `{name}` family name as listed, `{ward}`, `{sender}`, `{link}` sign-up link,
   `{when}` appointment day and time. You can help write warm, short wording.
   Texts work best under about 300 characters.
7. **Outreach steps**: by default the app suggests text → email → call, 7 days
   apart. Adjust under Settings → Reaching out.
8. **Sharing** (optional): Settings → Sync and sharing → type their email →
   Share. The other person opens the app → Join a shared list. Remind them that
   whoever they share with sees the whole list, including notes.
9. **Daily use**: open **Today** once a day. Tap Text/Email/Call (the app logs it
   when tapped, and there's an Undo). After an appointment, tap **Declared** or
   **Didn't come** under Close out.

### Troubleshooting

| They say | Likely cause and fix |
|---|---|
| "Sync is paused, sign in again" | Google sign-ins last an hour per session and Microsoft's 24 hours. Tap **Sign in again**. Nothing is lost: changes wait on the device. |
| Google says "This app isn't verified" | The calendar permission is waiting on Google's review. **Advanced → Go to Tithing Declaration** is safe, or skip the calendar and use an `.ics` file. |
| A booking shows under "Bookings to check" | The name on the booking didn't match exactly one family. Use **Link to family…**. The app remembers that name for next time. |
| Text button says "log" | No phone number on file for that family. Add one on the family's page. |
| A text opens but has no message (some Android phones) | Their messaging app ignores pre-filled text. They can copy the template from Settings. |
| Sign-in buttons are missing | This copy of the app has no registration (it's a self-hosted copy). See below. |
| Lost data after clearing the browser | Without sync, data lives only in that browser. Restore from a backup file (Settings → Backup) or turn sync on in future. |

---

## Your own registration

Only for someone running **their own copy** of the app, or who doesn't want to
use the shared registration. It takes about 15 minutes for each provider. The
IDs are public (not passwords). They go in `src/config.js`, or in the app under
Settings → Advanced, which saves them on that device only.

Replace `https://YOUR-SITE` below with where the copy is hosted (for example
`https://yourname.github.io/tithing-declaration`).

### Google

1. Go to https://console.cloud.google.com/ and create a project, e.g.
   "Tithing Declaration".
2. **APIs & Services → Library**: enable **Google Drive API**, **Google Picker
   API** and **Google Calendar API**.
3. **Google Auth Platform → Branding**: app name, support email, home page
   `https://YOUR-SITE/`, privacy policy `https://YOUR-SITE/privacy.html`,
   authorized domain (e.g. `github.io` or your domain).
4. **Audience**: External. While testing, add up to 100 test users' emails, or
   publish the app.
5. **Data access**: add the scopes `.../auth/drive.file` and
   `.../auth/calendar.readonly`.
6. **Clients → Create client → Web application**. Authorized JavaScript
   origins: `https://YOUR-SITE` (the origin only, no path). Copy the **client ID**.
7. **APIs & Services → Credentials → Create credentials → API key**. Restrict
   it to the Google Picker API and to the website `https://YOUR-SITE/*`. Copy
   it.
8. The **project number** is on the project's dashboard (Cloud overview).
9. Put the client ID, API key and project number in the app.

`calendar.readonly` is a "sensitive" scope. For anyone outside the test-user
list to use it without a warning, submit the app for verification
(Audience → Publish, then Verification Center). Drive sync works without that
review.

### Microsoft

1. Go to https://entra.microsoft.com/ (any Microsoft account works; a free
   one is fine) → **App registrations → New registration**.
2. Name: "Tithing Declaration". Supported account types: **Accounts in any
   organizational directory and personal Microsoft accounts**.
3. Redirect URI: platform **Single-page application (SPA)**, URL
   `https://YOUR-SITE/` (exactly the address of the app page, with the trailing
   slash if the page has one).
4. **API permissions → Add → Microsoft Graph → Delegated**:
   `Files.ReadWrite.All`, `Calendars.Read`, `User.Read`, `offline_access`.
   No admin consent is needed for personal accounts.
5. **Branding & properties**: home page and privacy URL as above.
6. Copy the **Application (client) ID** into the app.
