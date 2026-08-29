# Google Sheet backend — setup

One-time setup, about ten minutes. Do it once for the three of you; everyone
else just pastes the same URL and secret into the app's Settings screen.

## 1. Make the spreadsheet

Create a new Google Sheet. Name it something like **Ledger Data**. Leave the
default tab alone — the script creates `rounds`, `shots` and `courses` itself.

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

## The CORS approach is confirmed working

Verified against a live deployment, not just in theory. A browser `POST` with
`Content-Type: text/plain` reaches `doPost`, and the JSON reply is readable
cross-origin — which is what makes the whole sync layer viable, since Apps
Script cannot answer the preflight a normal JSON POST would trigger.

A quick way to check any deployment without revealing the secret: open the
`/exec` URL in a browser. A healthy one answers
`{"ok":true,"service":"ledger","version":1}`. Posting a deliberately wrong
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
