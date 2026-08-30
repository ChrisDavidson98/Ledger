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
  rounds: [
    'round_id', 'player', 'date', 'finished_at', 'course_id', 'course_name',
    'tee_name', 'mode', 'holes_played', 'score', 'par', 'to_par',
    'sg_ott', 'sg_app', 'sg_arg', 'sg_putt', 'sg_total', 'updated_at',
  ],
  // A score-only round has no shots, so it writes one row per hole
  // with shot_num 0 carrying just the score. Without that its
  // hole-by-hole detail existed nowhere but the phone that entered it.
  shots: [
    'round_id', 'player', 'date', 'course_name', 'tee_name',
    'hole', 'par', 'hole_yards', 'hole_score', 'shot_num',
    'start_lie', 'start_dist', 'start_unit',
    'end_lie', 'end_dist', 'end_unit',
    'holed', 'penalty', 'miss', 'category', 'sg',
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
var CONTRACT = 5;

function doGet(e) {
  return respond({
    ok: true,
    service: 'ledger',
    contract: CONTRACT,
    actions: ['ping', 'setup', 'pushRounds', 'deleteRounds', 'listArchive',
      'restoreRounds', 'cleanup', 'pullRounds', 'pushCourses', 'pullCourses'],
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
