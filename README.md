# Ledger

Shot-by-shot strokes gained tracking for golf rounds, shared between a few
players through a Google Sheet.

Every shot is measured against the strokes a tour player would expect to need
from the same lie and distance. Beat that number and you gain a fraction of a
stroke; fall short and you lose one. Totals break down into tee shots,
approaches, short game and putting, so a bad round points at the part of the
game that caused it.

## Running it

No build step and no dependencies. It does need a real HTTP origin — ES modules
and the service worker are both blocked on `file://` URLs.

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8000>. Pass `-Port 8080` if 8000 is taken.

For phone use it is deployed to GitHub Pages and added to the home screen. On
iOS the home-screen app has **its own storage, separate from Safari** — same URL,
different data. Pick one and treat the other as a second device.

## Tests

Open `tests.html` in the browser. Same idea as the app: no install, no build. It
only reads, so it cannot touch stored rounds or the sheet.

Run it before pushing. It covers the strokes-gained maths, shot editing and
relinking, the sync round trip for both round modes, course building, duplicate
detection, import parsing, the records rules, club distances and gapping, and
the handicap model against the two real rounds it was calibrated on. It also
covers the export briefing — that the conventions are stated, that the numbers
in the prose match the ones the model computes, and that the CSV shows its own
working — and the benchmark family's calibration and monotonicity, the
implied-handicap solve and its thin-sample guards, tee times and their sheet
round trip, the calendar grid, the `.ics` export down to line folding, the
roster's matching rules, and the scorecard repair — including that it is
idempotent, and that the course warnings stay silent on every seeded card.

## How it is put together

| File | Responsibility |
| --- | --- |
| `src/baseline.js` | Expected-strokes tables, shot classification, miss and club vocabulary |
| `src/model.js` | Round/hole/shot structures and every derived number |
| `src/storage.js` | localStorage persistence, sync queue, preferences, roster |
| `src/courses.js` | Course records, nines, pairings, validation, duplicate detection |
| `src/seed.js` | Scorecards transcribed from the paper cards |
| `src/import.js` | Bringing a scorecard in from pasted text |
| `src/handicap.js` | Turning strokes gained into a handicap level |
| `src/schedule.js` | Tee times, the calendar grid, and calendar export |
| `src/charts.js` | Inline SVG chart primitives |
| `src/repair.js` | Bringing rounds back in step with a corrected scorecard |
| `src/brief.js` | Writing a round out as a briefing or a shots CSV |
| `src/recap.js` | One round drawn as one image, and the share sheet |
| `src/monthly.js` | A player's month worked out as one plain object (`buildRecap`) |
| `src/monthcards.js` | That month drawn as 1080×1350 cards |
| `src/sync.js` | Google Sheet sync — push, pull, delete, archive, setup links |
| `src/app.js` | Screens, state, event wiring |
| `sw.js` | Offline app shell |
| `tests.html` | The test suite |
| `apps-script/Code.gs` | The Sheet backend. Setup: [`apps-script/README.md`](apps-script/README.md) |

### The rules the code is built around

**Raw shots are the source of truth; every strokes-gained figure is computed on
read.** Nothing derived is ever written to storage. The baseline tables are
approximations and will get better — when they do, every round already logged
improves with them. Storing computed SG values would freeze history at whatever
the tables said the day it was played.

**Nothing blocks on the network.** Phone signal on a golf course is bad. Writes
go to localStorage; the sheet is a sync target behind `storage.js`, not a save
button. Syncs retry once on a network failure, because the common causes are
transient.

**A course is a facility made of nines, not an 18-hole block.** Gardner is one
nine played twice, St Andrews is two nines, Sykes/Lady is three nines played as
any of three pairings. Eighteen as the unit could not represent Gardner at all.
It also makes a nine after work a round in its own right rather than an eighteen
somebody abandoned — which is why stats normalise to *per 18 holes*.

**A round either has shots or it does not.** A score-only round counts for
scoring, the trend and best-round, and is excluded from every strokes-gained
figure. There is deliberately no middle tier — partial shot data is where
statistics quietly go wrong.

**Nobody ever writes to anybody else's record.** Playing together is a
`group_id` stamped on each player's own round by the tee time they all started
from. The group card is assembled on read, afterwards, from rounds that arrived
separately. A live shared scorecard would need concurrent appends to one row
over a sheet and a bad signal, which is the one thing this backend cannot be
trusted to do — so the diary is deliberately a plan, and a round is the record.

**A benchmark is how the data is read, never a change to it.** Strokes gained
can be recomputed against a tour player or against a handicap level; only the
tour table is measured data, and the rest are derived from it. The setting lives
on the device, not on the round, so two people can look at the same card against
different standards. Nothing recomputed is written back.

**A round keeps its own copy of the card it was played against.** Hole yardages
are snapshotted into the round when it starts, which is normally right — it is
the record of what the card said that day. The consequence, which is not
obvious: correcting a course does **not** reach back into rounds already played
on it. `relinkHole` derives the first shot's starting distance from the hole
yardage, so a wrong number is wrong for the tee shot and nothing else; every
later shot started where the previous one finished, and those were typed in.
**Settings → Scorecard Repair** is how a round catches up, and it corrects
yardages only — strokes gained then comes out right on its own, because it was
never stored in the first place.

### Conventions worth knowing

- Distances are in **yards for every lie except the green**, which is in feet.
  `unitForLie()` enforces this so a caller cannot mismatch them.
- **Par-3 tee shots count as approach shots**, not off-the-tee. Off-the-tee is
  par 4s and 5s only, which is what makes the number comparable to published
  figures.
- **Penalty strokes count toward both score and strokes gained.**
- Miss direction and club are **optional and never affect strokes gained**. SG
  cannot see left from right, or know what was in your hands. They are a
  diagnostic layer: SG says how much a shot cost, they say why.
- Holes are aggregated on the **physical hole**, so a nine played twice is one
  piece of ground played twice rather than two holes with half the evidence.
- **Drive distance is yardage advanced, not carry**, and only counts shots that
  stayed in play. A dogleg reads long; nothing in the data says which holes bend.

## The screens

**Play** — shot entry. Lie, distance, optional miss grid, optional club on
approaches, penalties. The hole number is a picker: jump to any hole, tap any
shot to edit or delete it, and everything after it re-links itself.

**Rounds** — history for one player or everyone, and any round opens to the full
breakdown: its own handicap read, greens and fairways, approach and putting by
distance, miss grids, and a hole-by-hole card that expands to every shot.

**Stats** — the career view. Handicap level per part of the game with the upside
of fixing the weakest, a trend line by round, the basics, club distributions and
gapping, holes that cost you, and career bests.

**Stats › Monthly recap** — one player's month as up to seven cards to save or
post: a cover, strokes gained per 18, the biggest leak and the strength opened
up by distance, penalties, the change since the last month played, and a focus
for next month in the player's own words. The leak and the strength are picked
by the data, never from a category with fewer than five shots. Shots that look
like mis-entries are left out. The cards come light or dark. Everything is computed
on read against the benchmark in force; the focus note is the only thing
stored, in the `recap_notes` tab.

**Diary** — a month of what is booked and what has already been played. Tee
times, invitees, calendar export, and on the morning of a round a button that
starts it with the course already chosen.

**Clubhouse** — everyone side by side, and the holes with a grudge.

**Courses** — scorecards, by photo import or by hand. The editor warns on
yardages that look wrong for their par, and on a par 4 measuring longer than a
par 5, which is the shape a transposition leaves. It never blocks a save.

## Adding a course

**Courses → Import from a Photo** is the fast path. Photograph the scorecard,
hand the photo to any chat along with the prompt the screen gives you, and paste
back what it returns. It is checked and shown as per-nine totals before anything
is written, and lands *unverified* until somebody marks it checked in the editor.

There was going to be an in-app AI course lookup. It was dropped: Gardner's
published hole-by-hole yardages turned out wrong on all nine holes, and an app
that quietly starts a round on bad numbers is worse than one that asks for a
card. The photo route gets the same convenience with the numbers on screen
first, and needs no API key, proxy or rate limiting.

## Talking a round over

The app answers "how bad was it and where". It cannot answer "why did 14 fall
apart" or "what am I playing to without the two blow-ups", because that is a
conversation and not a screen. So a round exports as something you can hand to
a chat.

**Round detail → Talk this round over** writes the whole round as Markdown:
every shot with what it cost, the holes that did the damage, the round against
the same player's usual, and a table of what the pace looks like with the worst
one, two and three holes removed. **Stats → Talk your game over** does the same
for everything logged. Both offer **Copy for Chat** and **Save as File** — copy
is the shorter path on a phone, where saving to Files and finding it again is
three screens of detour; the file is the one to drag into a chat on a desktop.

There is also a shots CSV, one row per shot, for a spreadsheet or for anything
that would rather count than read. It carries expected strokes before and after
alongside the strokes-gained figure, so `sg = before - after - strokes` can be
checked rather than taken on faith.

The most important part of both briefings is the preamble. A model handed a
table of numbers with no conventions guesses at them, and the guesses are wrong
in specific ways: that green distances are yards, that a par-3 tee shot is a
drive, that a negative number is an error. Stating the rules costs a paragraph
and removes a whole class of confident nonsense. A closing section says what the
data cannot see — no wind, no lie quality, no pin position, and a dogleg that
reads long — so the conversation stays on what was actually recorded.

**An export is a read view, not a save.** It is built from raw shots on demand
and thrown away, like every other derived number here. Improve the baseline
tables and the next export improves with them.

## Signing in and sharing

A name typed into a box, matched against a roster **held on the sheet** and
pulled fresh at the gate. The passphrase is the sheet secret, so a wrong one
reaches no data at all — it is asked for once per device.

The order matters and is not the obvious one: the passphrase is checked *first*,
because the roster lives behind it, and only then is the name looked up. Adding
a player is one row in the `players` tab, or **Settings → Who can sign in** on
any phone. The roster is read network-first and cached, so a name added a minute
ago works immediately, and a clubhouse with no signal still lets in somebody who
has been playing for a year.

This was per-device until it bit: a new player was added on one phone, which did
nothing whatsoever on his, and the gate turned him away with a message blaming
his device. Every outcome at the gate now says which of the four things went
wrong, and the roster load logs its count and source to the console so the next
one is diagnosable from the phone it happened on.

To add a phone: **Settings → Copy Setup Link**. The link carries the sheet
address only, never the passphrase; send that separately. Open the link, add to
the home screen *first*, then sign in.

## Losing things, and getting them back

- **Deleting archives rather than destroys.** Deleted rounds move to
  `rounds_archive` / `shots_archive` and can be restored from
  **Settings → Deleted rounds**.
- **Export Backup** writes everything on the device to a JSON file.
- **Clean Up Sheet** reconciles duplicated rows and anything sitting in both the
  live tabs and the archive.
- **Check Which Version** asks the deployed script what it is serving, with no
  passphrase needed. Two phones reporting different contract numbers means one
  is on a stale deployment.

## Changing the backend

`apps-script/Code.gs` needs redeploying after any change to it — **Deploy →
Manage deployments → pencil → New version**, which keeps the same URL. Creating
a *new deployment* issues a different URL and strands every other phone.

Bump `BUILD` in `src/app.js` on any deploy that somebody else needs to be able to
tell apart from the one before — it shows at the bottom of the sign-in screen
and in Settings, which turns "are you on the new version" into a text message
rather than an evening.

Bump `CONTRACT` when the actions or columns change, and `CLIENT_CONTRACT` in
`src/sync.js` alongside it. Column changes are safe: `migrateHeaders` re-maps
existing rows by header name, so columns can be added or reordered without
corrupting what is already stored. Add new columns at the end anyway — the
archive tabs are built by concatenating onto the live column lists.

`MIN_CLIENT` is the oldest client the deployment accepts *writes* from. A PWA is
cached, so a phone that has not been opened since before a schema change will
run old code against the new sheet; reads from it are harmless, writes are not.
Anything below `MIN_CLIENT` is refused with a message telling the person to
reload, which is a much better outcome than a silently malformed row. Reads stay
open on purpose — an old phone that can still see everyone's rounds while it
waits to be reloaded is far less alarming than one that appears to have lost
them.

It sits at **0** today, which accepts everything, and that is deliberate. No
client that exists writes a shape the sheet cannot take — the ones predating the
calendar just omit `group_id`, which remaps to blank, which is what a round with
no tee time behind it should have. Refusing them would mean redeploying the
backend knocked every phone offline until somebody happened to reopen it: real
harm, no protection. What matters is that the version now travels with every
write, so on the day a write shape genuinely stops being safe, raising the
number is the entire fix.

## Benchmarks, and where the numbers come from

Only the tour table in `baseline.js` is data. Every handicap level is that table
plus a gap:

```
E_h(lie, dist) = E_tour(lie, dist) + gap(h) * shape(lie, dist)
```

`gap(h)` is the same `3.2 + 0.85h` the handicap model was already calibrated on
against two real rounds — no new numbers. `shape` spreads that total over the
positions a round passes through, and does not vary with `h`, so the levels are
one family and are monotonic by construction.

What makes it mean anything: summed over a hole the shape terms telescope, since
every shot's finish is the next shot's start, leaving only the value at the tee.
Total strokes gained against level `h` is therefore just *what an h handicap
would take on these holes, minus what you took* — and calibrating the whole
family reduces to making the tee row sum to `gap(h)` over eighteen holes.

`tests.html` asserts exactly that, per category. If the shape constants are ever
touched, that group of checks is the one that says whether the change survived.

The same relation is what makes the per-category **implied handicap** a real
solve rather than a lookup: strokes gained against level `h` is linear in `h`,
so setting it to zero and solving says at what standard that part of your game
would have come out level, given where your ball actually went. The total agrees
with the scoring-anchored figure by construction; only the split between
categories differs, and that is the point — it reflects your shots rather than
golfers in general. Under about twenty shots in the window a category falls back
to the fixed shares and is marked with a degree sign, so a modelled figure never
passes as a measured one.
