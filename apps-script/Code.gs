/* ---------------------------------------------------------------
   Ledger — Google Apps Script backend.

   Deploy as a Web App (Execute as: me, Access: anyone) and paste the
   URL plus the shared secret into the app's Settings screen. Setup
   instructions are in apps-script/README.md.

   Requests arrive as text/plain so the browser treats them as simple
   requests and skips the CORS preflight that Apps Script cannot
   answer. The body is JSON regardless; only the Content-Type differs.

   The `shots` tab is the authoritative record. `category` and `sg`
   are mirrored there as a convenience for pivoting inside Sheets —
   the app never reads them back, it recomputes from the raw columns,
   so improving the baseline tables does not strand old rows.
--------------------------------------------------------------- */

var SECRET_PROPERTY = 'LEDGER_SECRET';

var SHEETS = {
  // group_id sits at the END, and every new column must. migrateHeaders
  // re-maps by name so a reorder would survive, but the archive tabs
  // below are built by concatenating onto this list, and the app reads
  // these rows by header too — appending is the change with no way to
  // go wrong. It is blank on every round logged before the calendar.
  rounds: [
    'round_id', 'player', 'date', 'finished_at', 'course_id', 'course_name',
    'tee_name', 'mode', 'holes_played', 'score', 'par', 'to_par',
    'sg_ott', 'sg_app', 'sg_arg', 'sg_putt', 'sg_total', 'updated_at',
    'group_id',
  ],
  /*
   * Scheduled tee times. Deletion is a `deleted_at` stamp in place
   * rather than a move to an archive tab: a tee time holds no shots,
   * so there is nothing to protect, but the tombstone still has to
   * outlive the deletion long enough to reach the other phones.
   *
   * `date` and `time` are plain text, not dates. A tee time is "the
   * 14th at 8:40", not an instant, and letting Sheets parse it into a
   * timestamp would attach a timezone nobody chose.
   */
  tee_times: [
    'tee_time_id', 'owner', 'invitees', 'date', 'time',
    'course_id', 'course_name', 'tee_name', 'kind', 'practice_type',
    'notes', 'group_id', 'status', 'created_at', 'updated_at', 'deleted_at',
    'layout_key', 'holes',
  ],
  /*
   * Who is allowed to sign in, shared by everyone.
   *
   * This used to live in each phone's own storage, which meant adding
   * somebody on your phone did nothing at all on theirs — they reached
   * the gate, typed a name nothing had heard of, and were turned away.
   *
   * Adding a player is meant to be one row typed straight into this
   * tab: name in the first column, everything else blank. So `active`
   * is read as TRUE when it is empty, and the timestamps are filled in
   * by the app if it ever writes the row back. Nothing here needs a
   * code change or a redeploy.
   *
   * `active` is how access is revoked. Deleting the row would work
   * too, but it loses the record of who they were, and their rounds
   * are still on the sheet regardless.
   */
  players: ['player', 'active', 'created_at', 'updated_at'],
  // A score-only round has no shots, so it writes one row per hole
  // with shot_num 0 carrying just the score. Without that its
  // hole-by-hole detail existed nowhere but the phone that entered it.
  shots: [
    'round_id', 'player', 'date', 'course_name', 'tee_name',
    'hole', 'par', 'hole_yards', 'hole_score', 'shot_num',
    'start_lie', 'start_dist', 'start_unit',
    'end_lie', 'end_dist', 'end_unit',
    'holed', 'penalty', 'miss', 'club', 'category', 'sg',
  ],
  // One row per hole per tee per nine. A course is a facility made of
  // nines, so the nine is part of the key, not the 18-hole block.
  courses: [
    'course_id', 'course_name', 'city', 'nine_id', 'nine_name',
    'tee_name', 'hole', 'par', 'yards', 'verified', 'combos', 'updated_at',
  ],
};

/*
 * Deleting moves rows here rather than dropping them. Nothing reads
 * these tabs, so archived rounds stay out of the app and out of any
 * pivot built on `rounds` or `shots` — but the data is still sitting
 * there if a delete turns out to have been a mistake.
 */
SHEETS.rounds_archive = SHEETS.rounds.concat(['deleted_at']);
SHEETS.shots_archive = SHEETS.shots.slice();

/* --- Entry points ------------------------------------------------ */

/*
 * Bump CONTRACT whenever the actions or the column layout change.
 * doGet needs no secret, so this is the one thing that can be checked
 * from outside to see WHICH version of the script a URL is actually
 * serving — the difference between "the deployment is broken" and
 * "that phone is pointed at an older deployment" is otherwise
 * invisible from the client.
 */
var CONTRACT = 8;

/*
 * The oldest client this deployment will accept WRITES from.
 *
 * A PWA is cached, so a phone left closed since before a schema
 * change will run old code against a new sheet whenever it is next
 * opened. Reads from such a client are harmless — it sees columns it
 * ignores. Writes are not: it would push rows in the shape it still
 * believes in, and those land as real data nobody notices is wrong.
 *
 * So writes carry the client's contract number and anything below
 * this is refused with an error telling the person to reload, which
 * is a far better outcome than a silently malformed row. Reads stay
 * open, deliberately: an old phone that can still SEE everyone's
 * rounds while it waits to be reloaded is much less alarming than one
 * that appears to have lost them.
 *
 * Set to 0 today, which accepts everything — and that is correct, not
 * an oversight. No client that exists writes a shape this sheet
 * cannot take: the ones predating the calendar simply omit group_id,
 * which the header remap fills in as blank, and blank is exactly what
 * a round with no tee time behind it should have. Refusing them would
 * mean redeploying the backend knocked every phone offline until each
 * one happened to be reopened, which is a real harm traded for no
 * protection at all.
 *
 * What this is, is armed. The version now travels with every write,
 * so the day a write shape genuinely stops being safe, raising this
 * number is the whole fix — and the phone that has not been reopened
 * since gets told to reload instead of quietly writing a bad row.
 *
 * Note that clients predating the field send nothing, which reads as
 * 0. Raising MIN_CLIENT above 0 therefore turns those away too, which
 * is the intended behaviour but worth knowing before you do it.
 */
var MIN_CLIENT = 0;

var WRITE_ACTIONS = {
  pushRounds: true, deleteRounds: true, restoreRounds: true,
  cleanup: true, pushCourses: true, pushTeeTimes: true, pushPlayers: true,
};

function doGet(e) {
  return respond({
    ok: true,
    service: 'ledger',
    contract: CONTRACT,
    minClient: MIN_CLIENT,
    actions: ['ping', 'setup', 'pushRounds', 'deleteRounds', 'listArchive',
      'restoreRounds', 'cleanup', 'pullRounds', 'pushCourses', 'pullCourses',
      'pushTeeTimes', 'pullTeeTimes', 'pushPlayers', 'pullPlayers'],
  });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return respond({ ok: false, error: 'Body was not valid JSON.' });
  }

  if (!checkSecret(body.secret)) {
    return respond({ ok: false, error: 'Bad or missing secret.' });
  }

  // A client too old to write the current row shape is turned away
  // before it can write anything, rather than after. Reads are never
  // gated — see the note on MIN_CLIENT.
  if (WRITE_ACTIONS[body.action] && Number(body.client || 0) < MIN_CLIENT) {
    return respond({
      ok: false,
      error: 'This copy of Ledger is older than the sheet expects, so it has not '
        + 'written anything. Close it completely and reopen it to pick up the '
        + 'current version — your rounds are safe on this phone until you do.',
    });
  }

  var lock = LockService.getScriptLock();
  try {
    // Two phones finishing a round at once must not interleave writes.
    lock.waitLock(20000);
  } catch (err) {
    return respond({ ok: false, error: 'Backend busy, try again.' });
  }

  try {
    switch (body.action) {
      case 'ping':         return respond({ ok: true, pong: true });
      case 'setup':        return respond(setupSheets());
      case 'pushRounds':   return respond(pushRounds(body.rounds || []));
      case 'deleteRounds': return respond(deleteRounds(body.ids || []));
      case 'listArchive':  return respond(listArchive());
      case 'cleanup':      return respond(cleanupSheet());
      case 'restoreRounds':return respond(restoreRounds(body.ids || []));
      case 'pullRounds':   return respond(pullRounds(body.since || null));
      case 'pushCourses':  return respond(pushCourses(body.courses || []));
      case 'pullCourses':  return respond(pullCourses());
      case 'pushTeeTimes': return respond(pushTeeTimes(body.teeTimes || []));
      case 'pullTeeTimes': return respond(pullTeeTimes());
      case 'pushPlayers':  return respond(pushPlayers(body.players || []));
      case 'pullPlayers':  return respond(pullPlayers());
      default:
        return respond({ ok: false, error: 'Unknown action: ' + body.action });
    }
  } catch (err) {
    return respond({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function respond(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Length-independent comparison so a wrong secret does not leak its
 * length through response timing. Not a serious threat for a family
 * golf app, but it costs three lines.
 */
function checkSecret(provided) {
  var expected = PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY);
  if (!expected) throw new Error('Script property ' + SECRET_PROPERTY + ' is not set.');
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/* --- Sheet helpers ----------------------------------------------- */

function book() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheetFor(name) {
  var ss = book();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(SHEETS[name]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  return migrateHeaders(sheet, name);
}

/**
 * Bring an existing tab up to the current column list.
 *
 * Adding a column to SHEETS would otherwise silently corrupt a live
 * sheet: writes use the new column count while the stored rows are
 * still in the old order, so every value lands one cell out. This
 * re-maps existing rows BY HEADER NAME into the new layout, so columns
 * can be added or reordered safely and old data keeps its meaning.
 */
function migrateHeaders(sheet, name) {
  var wanted = SHEETS[name];
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var current = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function (h) { return String(h || ''); });

  var same = current.length === wanted.length && wanted.every(function (h, i) {
    return current[i] === h;
  });
  if (same) return sheet;

  var lastRow = sheet.getLastRow();
  var rows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
    : [];

  var remapped = rows.map(function (row) {
    return wanted.map(function (header) {
      var idx = current.indexOf(header);
      if (idx === -1) return '';
      var v = row[idx];
      return v === undefined || v === null ? '' : v;
    });
  }).filter(function (row) {
    // Drop rows that were entirely blank padding.
    return row.some(function (c) { return c !== ''; });
  });

  sheet.clear();
  sheet.getRange(1, 1, 1, wanted.length).setValues([wanted]);
  if (remapped.length) {
    sheet.getRange(2, 1, remapped.length, wanted.length).setValues(remapped);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function setupSheets() {
  Object.keys(SHEETS).forEach(function (name) { sheetFor(name); });
  textColumns('tee_times', ['date', 'time']);
  return { ok: true, sheets: Object.keys(SHEETS) };
}

/** All data rows as objects keyed by header name. */
function readAll(name) {
  var sheet = sheetFor(name);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function toMatrix(name, rows) {
  var headers = SHEETS[name];
  return rows.map(function (row) {
    return headers.map(function (h) {
      var v = row[h];
      return v === undefined || v === null ? '' : v;
    });
  });
}

/**
 * Replace every row matching `values` in `column` with `newRows`, in
 * one read and one write.
 *
 * This used to call sheet.deleteRow() per matching row. With a few
 * hundred rows that is a few hundred API calls, it is visible to
 * anyone watching the sheet, and it risks hitting the six-minute
 * execution limit PART WAY THROUGH — rows deleted, replacements never
 * written. Reading everything, filtering in memory and writing once
 * removes both the slowness and that failure mode.
 */
function replaceRows(name, column, values, newRows) {
  var sheet = sheetFor(name);
  var headers = SHEETS[name];
  var width = headers.length;
  var colIdx = headers.indexOf(column);
  if (colIdx === -1) throw new Error('No ' + column + ' column on ' + name + '.');

  var wanted = {};
  (values || []).forEach(function (v) { wanted[String(v)] = true; });

  var lastRow = sheet.getLastRow();
  var survivors = [];
  if (lastRow > 1) {
    var data = sheet.getRange(2, 1, lastRow - 1, width).getValues();
    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      // Blank padding rows are dropped rather than carried forward.
      var blank = true;
      for (var c = 0; c < width; c++) {
        if (row[c] !== '' && row[c] !== null) { blank = false; break; }
      }
      if (blank) continue;
      if (!wanted[String(row[colIdx])]) survivors.push(row);
    }
  }

  var all = survivors.concat(toMatrix(name, newRows || []));

  // Clear only what was there, then write the result in one go.
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, width).clearContent();
  }
  if (all.length) {
    sheet.getRange(2, 1, all.length, width).setValues(all);
  }
  return all.length;
}

/* --- Rounds ------------------------------------------------------ */

/**
 * Replace-then-append upsert. A round is normally pushed once, when
 * it is finished; re-pushes only happen after an edit or a retry, so
 * the delete path is the rare one.
 */
function pushRounds(rounds) {
  if (!rounds.length) return { ok: true, written: 0 };

  var ids = rounds.map(function (r) { return r.summary.round_id; });

  var summaryRows = [];
  var shotRows = [];
  var now = new Date().toISOString();

  rounds.forEach(function (payload) {
    var summary = payload.summary;
    summary.updated_at = now;
    summaryRows.push(summary);
    (payload.shots || []).forEach(function (shot) { shotRows.push(shot); });
  });

  replaceRows('rounds', 'round_id', ids, summaryRows);
  replaceRows('shots', 'round_id', ids, shotRows);

  // Pushing a round un-archives it. A round cannot be both live and
  // deleted, and leaving a stale archive copy behind was letting the
  // same round exist in two contradictory states at once.
  replaceRows('rounds_archive', 'round_id', ids, []);
  replaceRows('shots_archive', 'round_id', ids, []);

  return { ok: true, written: summaryRows.length, shots: shotRows.length };
}

/** Rows matching `ids`, as objects keyed by header name. */
function rowsFor(name, column, ids) {
  var wanted = {};
  ids.forEach(function (v) { wanted[String(v)] = true; });
  return readAll(name).filter(function (row) { return wanted[String(row[column])]; });
}

/** Append without disturbing what is already there. */
function appendRows(name, rows) {
  if (!rows.length) return;
  var sheet = sheetFor(name);
  var matrix = toMatrix(name, rows);
  sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, SHEETS[name].length)
    .setValues(matrix);
}

/**
 * Deleting a round moves it to the archive tabs rather than dropping
 * it. Without any removal at all a deleted round came back on the next
 * pull, since the sheet is what everyone reads from — but a hard
 * delete is the wrong default for the one copy of the data that lives
 * anywhere but a phone.
 */
function deleteRounds(ids) {
  if (!ids.length) return { ok: true, deleted: 0 };

  var now = new Date().toISOString();
  var summaries = rowsFor('rounds', 'round_id', ids).map(function (row) {
    row.deleted_at = now;
    return row;
  });
  var shots = rowsFor('shots', 'round_id', ids);

  appendRows('rounds_archive', summaries);
  appendRows('shots_archive', shots);

  replaceRows('rounds', 'round_id', ids, []);
  replaceRows('shots', 'round_id', ids, []);

  return { ok: true, deleted: summaries.length, archivedShots: shots.length };
}

/**
 * Reconcile the sheet after the states got out of step.
 *
 * Fixes two things it should not be possible to reach any more, but
 * which older versions of the sync could produce: the same round
 * appearing twice, and a round sitting in both the live tabs and the
 * archive at once. Where a round is in both, the archive wins —
 * somebody pressed delete, and that is the more recent intent.
 */
function cleanupSheet() {
  var report = { ok: true, duplicateRounds: 0, duplicateShots: 0, unarchivedGhosts: 0 };

  var archivedIds = {};
  readAll('rounds_archive').forEach(function (row) {
    archivedIds[String(row.round_id)] = true;
  });

  // Live rounds: drop anything archived, and keep only the last copy
  // of any duplicated id.
  var seen = {};
  var keptRounds = [];
  readAll('rounds').forEach(function (row) {
    var id = String(row.round_id);
    if (!id) return;
    if (archivedIds[id]) { report.unarchivedGhosts++; return; }
    if (seen[id] !== undefined) {
      report.duplicateRounds++;
      keptRounds[seen[id]] = row; // later row wins
      return;
    }
    seen[id] = keptRounds.length;
    keptRounds.push(row);
  });

  var keptIds = {};
  keptRounds.forEach(function (row) { keptIds[String(row.round_id)] = true; });

  var shotSeen = {};
  var keptShots = [];
  readAll('shots').forEach(function (row) {
    var id = String(row.round_id);
    if (!id || !keptIds[id]) return;
    var key = id + '|' + row.hole + '|' + row.shot_num;
    if (shotSeen[key] !== undefined) {
      report.duplicateShots++;
      keptShots[shotSeen[key]] = row;
      return;
    }
    shotSeen[key] = keptShots.length;
    keptShots.push(row);
  });

  writeAll('rounds', keptRounds);
  writeAll('shots', keptShots);

  report.rounds = keptRounds.length;
  report.shots = keptShots.length;
  return report;
}

/** Replace a tab's entire contents in one write. */
function writeAll(name, rows) {
  var sheet = sheetFor(name);
  var width = SHEETS[name].length;
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, width).clearContent();
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, width).setValues(toMatrix(name, rows));
  }
}

/** Everything sitting in the archive, newest deletion first. */
function listArchive() {
  var rows = readAll('rounds_archive').sort(function (a, b) {
    return String(b.deleted_at).localeCompare(String(a.deleted_at));
  });
  return { ok: true, rounds: rows };
}

/** Move rounds back out of the archive and into play. */
function restoreRounds(ids) {
  if (!ids.length) return { ok: true, restored: 0 };

  var summaries = rowsFor('rounds_archive', 'round_id', ids).map(function (row) {
    delete row.deleted_at;
    return row;
  });
  var shots = rowsFor('shots_archive', 'round_id', ids);
  if (!summaries.length) return { ok: true, restored: 0 };

  // Replace rather than append, so restoring twice cannot duplicate.
  replaceRows('rounds', 'round_id', ids, summaries);
  replaceRows('shots', 'round_id', ids, shots);

  replaceRows('rounds_archive', 'round_id', ids, []);
  replaceRows('shots_archive', 'round_id', ids, []);

  return { ok: true, restored: summaries.length };
}

/** Raw shot rows, so the client can rebuild rounds and recompute SG itself. */
function pullRounds(since) {
  var summaries = readAll('rounds');
  var shots = readAll('shots');

  if (since) {
    var cutoff = new Date(since).getTime();
    var keep = {};
    summaries = summaries.filter(function (r) {
      var stamp = new Date(r.updated_at).getTime();
      var fresh = !isNaN(stamp) && stamp > cutoff;
      if (fresh) keep[String(r.round_id)] = true;
      return fresh;
    });
    shots = shots.filter(function (s) { return keep[String(s.round_id)]; });
  }

  return { ok: true, rounds: summaries, shots: shots, serverTime: new Date().toISOString() };
}

/* --- Tee times ---------------------------------------------------- */

/**
 * Upsert by tee_time_id, same replace-then-append shape as rounds.
 *
 * A deleted tee time arrives here as an ordinary row carrying a
 * `deleted_at`, so nothing special happens to it — the tombstone is
 * just another field, and it is what stops the entry reappearing on
 * everyone else's calendar at the next pull.
 *
 * The day and the time columns are held as plain text; see
 * textColumns() for why that matters more than it sounds like it does.
 */
function pushTeeTimes(teeTimes) {
  if (!teeTimes.length) return { ok: true, written: 0 };

  var ids = teeTimes.map(function (t) { return t.tee_time_id; });
  var now = new Date().toISOString();

  var rows = teeTimes.map(function (t) {
    t.updated_at = t.updated_at || now;
    return t;
  });

  textColumns('tee_times', ['date', 'time']);
  replaceRows('tee_times', 'tee_time_id', ids, rows);
  return { ok: true, written: rows.length };
}

/**
 * Pin columns to plain text so Sheets stops interpreting them.
 *
 * Left to itself it parses "2026-09-14" into a date value and "08:40"
 * into a time in 1899, then hands both back through the spreadsheet's
 * timezone rather than the phone's. That is how a tee time booked for
 * Saturday morning shows up on Friday night for one person in the
 * group, and it is invisible until somebody misses a round over it.
 */
function textColumns(name, columns) {
  var sheet = sheetFor(name);
  var headers = SHEETS[name];
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  columns.forEach(function (column) {
    var idx = headers.indexOf(column);
    if (idx === -1) return;
    sheet.getRange(2, idx + 1, rows, 1).setNumberFormat('@');
  });
}

/**
 * Every tee time, tombstones included.
 *
 * Deleted ones are NOT filtered out here. A phone that has not synced
 * since before a deletion has to be told about it, and the only way
 * to say "this is gone" over a pull is to hand back the row saying so.
 * The app drops them on the way in.
 */
function pullTeeTimes() {
  var zone = book().getSpreadsheetTimeZone();

  var rows = readAll('tee_times').filter(function (row) {
    return String(row.tee_time_id || '') !== '';
  }).map(function (row) {
    // A row written before the text format was applied, or typed into
    // the sheet by hand, can still come back as a real Date. Format it
    // to the day and time the sheet was SHOWING rather than letting
    // the client re-parse a stringified Date and land a day out.
    row.date = asText(row.date, zone, 'yyyy-MM-dd');
    row.time = asText(row.time, zone, 'HH:mm');
    return row;
  });
  return { ok: true, teeTimes: rows, serverTime: new Date().toISOString() };
}

function asText(value, zone, pattern) {
  if (value instanceof Date) return Utilities.formatDate(value, zone, pattern);
  return String(value == null ? '' : value).replace(/^'/, '');
}

/* --- Players ------------------------------------------------------ */

/**
 * Everyone allowed to sign in.
 *
 * A blank `active` reads as TRUE on purpose: the documented way to add
 * somebody is to type their name into the first column and nothing
 * else, and a row that then failed to let them in would defeat the
 * entire point of moving this off the phones.
 *
 * Names are handed back exactly as typed here. The client matches
 * case-insensitively but stores and displays THIS spelling, so the
 * sheet is what decides whether he is Dakota or dakota.
 */
function pullPlayers() {
  var rows = readAll('players')
    .filter(function (row) { return String(row.player || '').trim() !== ''; })
    .map(function (row) {
      return {
        player: String(row.player).trim(),
        active: isActive(row.active),
        created_at: row.created_at ? String(row.created_at) : '',
        updated_at: row.updated_at ? String(row.updated_at) : '',
      };
    });
  return { ok: true, players: rows, serverTime: new Date().toISOString() };
}

/** Blank means active. Anything obviously negative means inactive. */
function isActive(value) {
  if (value === '' || value === null || value === undefined) return true;
  if (value === true) return true;
  if (value === false) return false;
  var text = String(value).trim().toLowerCase();
  if (text === '') return true;
  return ['false', 'no', 'n', '0', 'inactive'].indexOf(text) === -1;
}

/**
 * Upsert by name, touching ONLY the rows named in the payload.
 *
 * Deliberately not a whole-tab rewrite. Somebody typing a name
 * straight into the sheet is the documented path, and a phone that
 * had not synced since would otherwise wipe them out on its next
 * write. Removing a player is done by setting active to FALSE, not by
 * dropping the row.
 */
function pushPlayers(players) {
  if (!players.length) return { ok: true, written: 0 };

  var now = new Date().toISOString();
  var existing = {};
  readAll('players').forEach(function (row) {
    var key = String(row.player || '').trim().toLowerCase();
    if (key) existing[key] = row;
  });

  var names = [];
  var rows = players.map(function (entry) {
    var name = String(entry.player || '').trim();
    var was = existing[name.toLowerCase()] || {};
    names.push(name);
    // Match on the stored spelling too, so an upsert replaces the row
    // rather than leaving a second one differing only in case.
    if (was.player && String(was.player) !== name) names.push(String(was.player));
    return {
      player: name,
      active: entry.active === false ? 'FALSE' : 'TRUE',
      created_at: was.created_at ? String(was.created_at) : now,
      updated_at: now,
    };
  }).filter(function (row) { return row.player !== ''; });

  replaceRows('players', 'player', names, rows);
  return { ok: true, written: rows.length };
}

/* --- Courses ----------------------------------------------------- */

function pushCourses(courses) {
  if (!courses.length) return { ok: true, written: 0 };

  var ids = courses.map(function (c) { return c.id; });
  var rows = [];
  var now = new Date().toISOString();
  courses.forEach(function (course) {
    // Pairings are course-level, so they ride along on every row
    // rather than needing a tab of their own.
    var combos = JSON.stringify(course.combos || []);
    (course.nines || []).forEach(function (nine) {
      (nine.holes || []).forEach(function (hole) {
        (course.teeNames || []).forEach(function (teeName) {
          var yards = hole.yards ? hole.yards[teeName] : '';
          if (yards === '' || yards === undefined || yards === null) return;
          rows.push({
            course_id: course.id,
            course_name: course.name,
            city: course.city || '',
            nine_id: nine.id,
            nine_name: nine.name,
            tee_name: teeName,
            hole: hole.hole,
            par: hole.par,
            yards: yards,
            verified: course.verified ? 'yes' : 'no',
            combos: combos,
            updated_at: now,
          });
        });
      });
    });
  });

  replaceRows('courses', 'course_id', ids, rows);
  return { ok: true, written: rows.length };
}

/** Flat rows reassembled into the nested course shape the app uses. */
function pullCourses() {
  var rows = readAll('courses');
  var byCourse = {};

  rows.forEach(function (row) {
    var id = String(row.course_id);
    if (!id) return;

    if (!byCourse[id]) {
      var combos = [];
      try { combos = JSON.parse(row.combos || '[]'); } catch (err) { combos = []; }
      byCourse[id] = {
        id: id,
        name: row.course_name,
        city: row.city || '',
        verified: row.verified === 'yes',
        source: 'sheet',
        combos: combos,
        teeNames: [],
        nines: {},
      };
    }

    var course = byCourse[id];
    var teeName = String(row.tee_name);
    if (course.teeNames.indexOf(teeName) === -1) course.teeNames.push(teeName);

    var nineId = String(row.nine_id);
    if (!course.nines[nineId]) {
      course.nines[nineId] = { id: nineId, name: row.nine_name, holes: {} };
    }

    var nine = course.nines[nineId];
    var holeNum = Number(row.hole);
    if (!nine.holes[holeNum]) {
      nine.holes[holeNum] = { hole: holeNum, par: Number(row.par), yards: {} };
    }
    nine.holes[holeNum].yards[teeName] = Number(row.yards);
  });

  var courses = Object.keys(byCourse).map(function (id) {
    var course = byCourse[id];
    return {
      id: course.id,
      name: course.name,
      city: course.city,
      verified: course.verified,
      source: 'sheet',
      teeNames: course.teeNames,
      combos: course.combos,
      nines: Object.keys(course.nines).map(function (nineId) {
        var nine = course.nines[nineId];
        return {
          id: nine.id,
          name: nine.name,
          holes: Object.keys(nine.holes)
            .map(function (h) { return nine.holes[h]; })
            .sort(function (a, b) { return a.hole - b.hole; }),
        };
      }),
    };
  });

  return { ok: true, courses: courses };
}
