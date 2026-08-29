# Ledger

Shot-by-shot strokes gained tracking for golf rounds.

Every shot is measured against the strokes a tour player would expect to need from
the same lie and distance. Beat that number and you gain a fraction of a stroke;
fall short and you lose one. Totals break down into tee shots, approaches, short
game and putting, so a bad round points at the part of the game that caused it.

## Running it

No build step and no dependencies. It does need a real HTTP origin — ES modules
and the service worker are both blocked on `file://` URLs.

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8000>. Pass `-Port 8080` if 8000 is taken.

For phone use, deploy to GitHub Pages and add it to your home screen.

## How it is put together

| File | Responsibility |
| --- | --- |
| `src/baseline.js` | Expected-strokes tables, shot classification, miss-direction vocabulary |
| `src/model.js` | Round/hole/shot structures and every derived number |
| `src/storage.js` | localStorage persistence and the sync queue |
| `src/courses.js` | Course records, nines, pairings, scorecard validation |
| `src/seed.js` | Scorecards transcribed from the paper cards |
| `src/sync.js` | Google Sheet sync — push, pull, shape conversion |
| `src/app.js` | Screens, state, event wiring |
| `sw.js` | Offline app shell |
| `apps-script/Code.gs` | The Sheet backend. Setup: [`apps-script/README.md`](apps-script/README.md) |

### Two rules the code is built around

**Raw shots are the source of truth; every strokes-gained figure is computed on
read.** Nothing derived is ever written to storage. The baseline tables are
approximations and will get better — when they do, every round already logged
improves with them. Storing computed SG values would freeze your history at
whatever the tables said the day you played.

**Nothing blocks on the network.** Phone signal on a golf course is bad. Writes
go to localStorage; the Google Sheet backend arriving in Phase 2 is a sync
target behind `storage.js`, not a save button.

**A course is a facility made of nines, not an 18-hole block.** That is what
the courses here actually are: Gardner is one nine played twice, St Andrews is
two nines, Sykes/Lady is three nines played as any of three pairings. Eighteen
as the unit could not represent Gardner at all. It also makes a nine after work
a round in its own right rather than an eighteen somebody abandoned — which is
why the stats screen normalises to *per 18 holes* instead of per round.

### Conventions worth knowing

- Distances are in **yards for every lie except the green**, which is in feet.
  `unitForLie()` enforces this so a caller cannot mismatch them.
- **Par-3 tee shots count as approach shots**, not off-the-tee. Off-the-tee is
  par 4s and 5s only. This is the standard convention and it is what makes the
  number comparable to published SG figures.
- **Penalty strokes count toward both your score and your strokes gained.**
- Miss direction is recorded for tee shots and approaches only, and is always
  optional. It does not affect strokes gained at all — SG cannot see left from
  right. It is a separate diagnostic layer: SG says how much a shot cost, the
  miss grid says why.

## Status

Phase 1 is done: offline, single device, manual scorecards.

- **Phase 2** — Google Sheet backend, sync queue, shared rounds across players
- **Phase 3** — course lookup through a server-side proxy, cached and rate limited
- **Phase 4** — handicap-level baselines, trends over time, head-to-head

Until Phase 2 lands, all data lives in one browser on one device. Use
**Rounds → Export All Data** for a backup.
