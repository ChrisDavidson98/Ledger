# Ledger — Design Brief

**What it is:** A strokes-gained golf tracker for a small group of friends (about 3–6 players). It covers shot-by-shot round logging, a stats breakdown, a shared diary of tee times, and group comparisons.
**Platform:** A mobile web app (PWA) that people add to their home screen. It's phone-first, used one-handed on the course, and must work offline because signal on a course is poor. A shared Google Sheet is the backend. There are no user accounts, just a name picked from a roster.
**Design priorities:** Fast taps between shots. Readable in sunlight. Numbers first. No clutter.
**Look:** "Yardage Book": a course planner's notebook, with a faint grid, serif headings, every figure in monospace, and ruled rows instead of cards.

## 1. Screens

The bottom tab bar has five tabs: **Play · Diary · Rounds · Stats · Club**. They're line icons (a flag, a calendar, a scorecard, bars and a trophy), and the current tab opens into a filled pill with its name. The bar is hidden during shot entry.

| Tab | Screen | Purpose | Design state |
|---|---|---|---|
| — | **Sign in** | Pick your name from the roster; enter the group passphrase on first use. | Restyled only |
| Play | **Home** | Invite alerts, today's tee time, "The book on you", "In the diary", and a docked "Start a round →" or "Continue · Hole N →" button. | Redesigned |
| Play | **Choose course / tees** | Pick a saved course (with "+ Add course" and "Edit" per course), then the tees, then 18 holes, a nine, or score-only. | Restyled only |
| Play | **Shot entry** | The core screen. One hole at a time, drawn as a ruler from tee to pin. | Redesigned |
| Play | **Scorecard** | Score-only entry: the whole card on one screen, every hole starts at par, tap +/−. | Restyled only |
| Play | **Round complete** | Share Recap, strokes-gained chart, round breakdown, hole by hole. | Restyled only |
| Diary | **Calendar** | Month grid of booked tee times, practice sessions, and rounds played. | Restyled only |
| Diary | **Tee time detail / edit** | Date, time, course, tees, kind (round or practice), invitees, notes; group leaderboard once played. | Restyled only |
| Rounds | **History** | List of rounds (mine or everyone's) → **Round detail** (same content as Round complete). | Restyled only |
| Rounds | **Settings** | Courses, sheet connection, benchmark, light/dark theme, deleted rounds, repair of rounds logged against a wrong scorecard. | Restyled only |
| Rounds › Settings | **Courses / edit / import** | Saved scorecards (nines, tees, par, yards); import from a photo of a card. Also reached from Choose course. | Restyled only |
| Stats | **Stats** | Averages per 18 holes, strokes gained by category, "plays like" handicap per category, trends, approach by distance, putting, tee outcomes, misses, club distances. | Restyled only |
| Club | **Clubhouse** | Two views: **Field** (season standings, "Who plays what", holes with a grudge) and **Head to head** (you against one other player). | Redesigned |

"Restyled only" screens have the new colors, fonts and ruled rows but keep their old layouts. They're the natural next candidates for a redesign.

## 2. What the redesigned screens show (example values)

- **Home:**
  - Header: "CHRIS · SAT, SEP 26".
  - **The book on you** ("THE BOOK ON YOU · 7 ROUNDS · VS TOUR"):
    - A headline, "Plays like *a ten*."
    - A scratch-to-30 scale with a dot per part of the game (green at or better than your level, orange worse) and a "YOU 10" marker.
    - Ruled rows per part showing SG/18 and "plays like": Putting −3.86 · 26; Approach −6.56 · 12.
    - An italic line: "Putting is the leak. Bring it to your own level and save about 1.8 a round."
    - A suggested session, "Lag putting and short putts · 30 min … BOOK ›", or "Range booked Wed" if one is already booked.
  - **In the diary:** "WED 30 · Range · 5:00 PM · PR"; "SAT 3 · Sykes/Lady OP · 8:21 AM · GO"; "LAST · Gardner · White · +7 · −8.95".
- **Shot entry:**
  - Header: "No. 7 · PAR 5 · 512", with "+4 thru 6" on the right.
  - The hole ruler, ticked every 100 yds, with a dashed path per shot and a ring at the ball labelled "245".
  - The shot log: "1 DR TEE 512 → FWY 245 +0.41"; the shot in progress dimmed with "—".
  - "Shot 2 finished…", then a 3×2 lie grid (Fairway, Rough, Sand, Trouble, Green, Holed).
  - A − / 32 / + stepper labelled "FEET TO PIN".
  - CLUB and MISS fields that open bottom sheets, and a "+ Penalty" control.
  - Bottom buttons: "Undo" and "Log shot 2 →".
- **Clubhouse, Field:**
  - A 2026 / 30 days switch.
  - Standings rows: "1 · (K) Kaden · 6 RDS · +12/18 · BEST +12 · ▲1", with PLAYS LIKE **4** on the right.
  - "Who plays what": one scale per part with a marker for each player; the notes read "Kaden by 2" or "Level".
- **Clubhouse, Head to head:**
  - "CHRIS VS [Kaden] [Manny]".
  - A face-off: "Chris *vs* Kaden · PLAYS LIKE 6 / 4".
  - A summary line: "You lead two parts of the game to one. Manny owns the approach."
  - Five part rows with center-out bars.
  - Scoring rows: rounds, to par/18, best round, greens, fairways, putts/18, and career bests.
- **Share Recap image:** a light paper-and-ink image, 1080×1350. It shows the course, "84 *+12*", strokes gained, four ruled category rows with bars, and the best and toughest hole.

## 3. Data model

- **Player:** a name on a shared roster, with an active flag. There are no profiles or passwords per player. Everyone is effectively friends with everyone.
- **Course:** a name, one or more nines, tees per nine, and par and yards per hole.
- **Round:** the player, course, tees, layout (which nines), date, mode (**full** shot-by-shot, or **score only**), an optional group ID linking rounds played together, and a list of holes.
- **Hole:** hole number, par, yards, a list of shots, a score (score-only mode), and a done flag.
- **Shot:** start lie and distance, end lie and distance, holed, penalty strokes, miss direction, and club. Lies are Tee, Fairway, Rough, Sand, Trouble, Green. Distances are in yards, except on the green, where they're in feet.
- **Strokes gained:** each shot is scored against a **benchmark** (Tour, Scratch, or a 5/10/15/20 handicap, chosen by the user) and grouped into four categories: **Off the Tee, Approach, Short Game (inside 30 yards), Putting**. A hole's total is the sum of its shots; a round's total is the sum of its holes.
- **Plays like:** strokes gained per 18 against tour, converted into the handicap that normally plays that well, overall and per category. It's the headline number on Home and in the Clubhouse, where lower is better.
- **Tee time:** owner, invitees, date, time, course, tees, kind (**round** or **practice**, with a practice type), notes, status (scheduled or cancelled), and group ID. A tee time is only shown to its owner and invitees.

## 4. Current styling

All colors, fonts and spacing are CSS variables. The theme follows the phone's setting by default and can be overridden.

- **Fonts (Google Fonts):** **Instrument Serif** for headings and big numbers (its italic is for callout lines); **Martian Mono** for labels, figures and tab labels; **Public Sans** for body text. Small labels are 10–11px, uppercase, with 0.08em letter spacing.
- **Dark (default look):**
  - Background `#141816` with a faint 18px grid (`#181d1b`).
  - Header `#0f1311` with a 3px `#e8785a` rule under it. The wordmark is "Ledger." with an orange period.
  - Surfaces `#1c2220`; tab bar `#1a1f1d`.
  - Rules `#3a4540` (strong) and `#262e2a` (soft); control borders `#4a5550`.
  - Text `#e8eae7`; secondary text `#a4ada8`.
  - Gains `#7fc39b`; losses `#e8785a`.
  - Primary button `#7fc39b` with `#10201a` text.
- **Light:**
  - Background `#f7f4ec` with grid lines `#ece7da`, and a 2px ink rule under the header.
  - Text `#16150f`; secondary text `#5d5a50`.
  - Rules `#d9d3c3` (strong rules use the text color).
  - Gains `#1f5fbf`; losses `#b8431b`.
  - Primary button `#16150f` with `#f7f4ec` text.
- **Components:**
  - Hand-written CSS with no framework. Sections are ruled, not boxed: a strong rule above, no fill, no shadow.
  - Every tap target is at least 44px tall; primary buttons are 56px, with mono uppercase labels.
  - Joined grids with shared borders for the lie picker, miss grid, par toggles and segmented switches.
  - Pills for picking a player.
  - Player markers are circles holding an initial, told apart by fill as well as color: you solid gain color, then solid ink, then outline, then dashed outline.
  - Charts are inline SVG. Gains and losses use the two meaning colors, and negatives use a true minus sign (−).
- **Tone:** a yardage book: quiet, precise, serious about the numbers, with one italic serif line where the app has something to say.

## 5. Main user flows

1. **Logging a round:**
   - Play → Start a round → choose course → tees → 18 or a nine.
   - For each shot, tap where it finished, set the distance with − / + or type it, and optionally set the club, miss or a penalty. Then tap "Log shot N →", and the ruler and log update.
   - Logging "Holed" finishes the hole, which shows its strokes-gained split and "Hole N+1 →". Tap "No. 7" to jump to any hole.
   - You can also start from today's tee time on Home (this links the group's rounds), or enter a score-only card after the round.
2. **Viewing the strokes-gained breakdown:**
   - Home's "book on you" gives the headline and the leak.
   - A round shows the four-category chart, the benchmark switcher and hole by hole.
   - Stats gives the long view.
3. **Comparing with friends:**
   - Club › Field for the season table and where everyone sits on each part of the game.
   - Club › Head to head for you against one player.
   - A tee time played by several people shows a group leaderboard.
   - **Share Recap** turns any round into one image for the group chat.

**Open design questions:**
- Redesign the "restyled only" screens, especially Stats, Round complete and the Diary.
- Get the most from "plays like" on Stats, which still leads with raw strokes gained.
- Whether the scorecard entry should share shot entry's ruler and stepper language.
