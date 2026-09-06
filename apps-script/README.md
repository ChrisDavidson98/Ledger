# Google Sheet backend — setup

One-time setup, about ten minutes. Do it once for the three of you; everyone
else just pastes the same URL and secret into the app's Settings screen.

## 1. Make the spreadsheet

Create a new Google Sheet. Name it something like **Ledger Data**. Leave the
default tab alone — the script creates `rounds`, `shots`, `courses`, `players` and
`tee_times` itself.

## 2. Add the script

In the sheet: **Extensions → Apps Script**. Delete whatever is in `Code.gs`,
paste in the contents of [`Code.gs`](Code.gs), and save.

## 3. Set the shared secret

Still in the Apps Script editor: **Project Settings** (the gear), scroll to
**Script Properties**, **Add script property**.

| Property | Value |
| --- | --- |
| `LEDGER_SECRET` | a long random string you invent |

Make it long and random — 30+ characters. This is the only thing standing
between a stranger who finds your URL and your data. Do **not** commit it
anywhere; you will paste it into each phone once.

## 4. Deploy

**Deploy → New deployment → Web app**, then:

| Setting | Value |
| --- | --- |
| Execute as | **Me** |
| Who has access | **Anyone** |

"Anyone" sounds alarming but is required — the app calls this from a browser
with no Google login. The secret is what actually gates access. Google will
warn you about permissions on first deploy; that is expected.

Copy the **Web app URL**. It ends in `/exec`.

## 5. Point the app at it

In Ledger: **Rounds → Settings**. Paste the URL and the secret, hit **Save**,
then **Test Connection**, then **Create Tabs**.

Repeat on each phone with the same two values.

## What lands in the sheet

**`shots`** is the real record — one row per shot, with the raw lie and
distance for each. `category` and `sg` are mirrored here so you can pivot in
Sheets directly, but the app never reads them back; it recomputes from the raw
columns. That is deliberate: when the baseline tables improve, every round
already logged improves with them.

**`rounds`** is one row per round with the score and the four strokes-gained
totals. Entirely derived from `shots` — handy for charts, not authoritative.

**`courses`** is one row per hole per tee set.

**`players`** is who is allowed to sign in — **the one to know about**, because
it is the only tab you are ever expected to edit by hand.

To add somebody: type their name in the first column of a new row and leave
everything else blank. That is the whole procedure. No redeploy, no code change,
and no need to touch each phone. `active` is read as TRUE when empty, so a bare
name works; set it to `FALSE` to block someone at the gate while leaving every
round they logged exactly where it is.

The app writes this tab too, from **Settings → Who can sign in**, and its writes
only ever touch the rows they name — so a player you typed in by hand is never
clobbered by a phone that had not synced.

This used to be a list in each phone's own storage, which is why a new player
could not get in: adding him on your phone did precisely nothing on his.

**`tee_times`** is one row per scheduled round or practice session. `date` and
`time` are held as plain **text**, not as date values — a tee time is "the 14th
at 8:40", not an instant, and letting Sheets parse it attaches a timezone nobody
chose, which is how a Saturday morning round shows up on Friday night for one
person in the group. Deleting one stamps `deleted_at` in place rather than
moving it to an archive tab: there are no shots to protect, but the tombstone
still has to reach the other phones to stop the entry reappearing.

## The CORS approach is confirmed working

Verified against a live deployment, not just in theory. A browser `POST` with
`Content-Type: text/plain` reaches `doPost`, and the JSON reply is readable
cross-origin — which is what makes the whole sync layer viable, since Apps
Script cannot answer the preflight a normal JSON POST would trigger.

A quick way to check any deployment without revealing the secret: open the
`/exec` URL in a browser. A healthy one answers
`{"ok":true,"service":"ledger","contract":7,...}`. Posting a deliberately wrong
secret should come back `{"ok":false,"error":"Bad or missing secret."}` — that
response proves transport, parsing and the secret check are all wired up.

## Things worth knowing

**Editing the sheet by hand is risky.** The app pushes a whole round at a time,
deleting that round's rows and rewriting them. Hand edits to a round that later
gets re-pushed will be overwritten. Read from it, chart from it, but treat it as
output.

**A push replaces, it does not merge.** Two phones editing the same round is not
a case this handles; last push wins. In practice each person only ever writes
their own rounds, so it does not come up.

**Cold starts are slow.** The first request after a quiet spell takes a few
seconds. That is why nothing in the app waits on sync.

**Quotas are not a concern.** Roughly 300 rows a round, three players. The
limits are in the tens of thousands per day.

## If something breaks

| Symptom | Cause |
| --- | --- |
| `Bad or missing secret` | The secret in Settings does not match `LEDGER_SECRET`. Watch for a trailing space. |
| `Script property LEDGER_SECRET is not set` | Step 3 was skipped, or the property was set on the wrong project. |
| `Failed to fetch` | The deployment is not set to "Anyone", or the URL is not the `/exec` one. |
| Changes to `Code.gs` do nothing | Apps Script serves the last *deployed* version. **Deploy → Manage deployments → Edit → New version**. |
| `This copy of Ledger is older than the sheet expects` | That phone is running a cached build older than `MIN_CLIENT`. Close the app fully and reopen it. Nothing was written, and its rounds are still safe on the device. |
| A tee time on the wrong day for one person | The `date` column on `tee_times` has been turned back into a date value — most often by editing it by hand. Reformat the column as plain text; **Create Tabs** does it too. |
| A new player is told they are not on the roster | Their name is not in the `players` tab, or is there with `active` set to FALSE. Add the row, then have them try again — no reload needed, the gate reads it fresh every time. |
| A new player is told the player list could not be reached | Their phone got no answer from the sheet, so it fell back to the last roster it saw — on a brand-new phone, that is the three built-in names. Almost always signal, or a passphrase that has not been accepted yet. |
