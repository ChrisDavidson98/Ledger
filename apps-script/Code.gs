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
    'tee_name', 'holes_played', 'score', 'par', 'to_par',
    'sg_ott', 'sg_app', 'sg_arg', 'sg_putt', 'sg_total', 'updated_at',
  ],
  shots: [
    'round_id', 'player', 'date', 'course_name', 'tee_name',
    'hole', 'par', 'hole_yards', 'shot_num',
    'start_lie', 'start_dist', 'start_unit',
    'end_lie', 'end_dist', 'end_unit',
    'holed', 'penalty', 'miss', 'category', 'sg',
  ],
  courses: [
    'course_id', 'course_name', 'tee_name', 'hole', 'par', 'yards',
    'verified', 'updated_at',
  ],
};

/* --- Entry points ------------------------------------------------ */

function doGet(e) {
  return respond({ ok: true, service: 'ledger', version: 1 });
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
  }
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

/** Delete every row whose `column` matches one of `values`, bottom-up. */
function deleteRowsWhere(name, column, values) {
  if (!values.length) return;
  var wanted = {};
  values.forEach(function (v) { wanted[String(v)] = true; });

  var sheet = sheetFor(name);
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  var colIdx = data[0].indexOf(column);
  if (colIdx === -1) return;

  for (var r = data.length - 1; r >= 1; r--) {
    if (wanted[String(data[r][colIdx])]) sheet.deleteRow(r + 1);
  }
}

function appendRows(name, rows) {
  if (!rows.length) return;
  var sheet = sheetFor(name);
  var headers = SHEETS[name];
  var matrix = rows.map(function (row) {
    return headers.map(function (h) {
      var v = row[h];
      return v === undefined || v === null ? '' : v;
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, matrix.length, headers.length).setValues(matrix);
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
  deleteRowsWhere('rounds', 'round_id', ids);
  deleteRowsWhere('shots', 'round_id', ids);

  var summaryRows = [];
  var shotRows = [];
  var now = new Date().toISOString();

  rounds.forEach(function (payload) {
    var summary = payload.summary;
    summary.updated_at = now;
    summaryRows.push(summary);
    (payload.shots || []).forEach(function (shot) { shotRows.push(shot); });
  });

  appendRows('rounds', summaryRows);
  appendRows('shots', shotRows);

  return { ok: true, written: summaryRows.length, shots: shotRows.length };
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
  deleteRowsWhere('courses', 'course_id', ids);

  var rows = [];
  var now = new Date().toISOString();
  courses.forEach(function (course) {
    (course.tees || []).forEach(function (tee) {
      (tee.holes || []).forEach(function (hole) {
        rows.push({
          course_id: course.id,
          course_name: course.name,
          tee_name: tee.name,
          hole: hole.hole,
          par: hole.par,
          yards: hole.yards,
          verified: course.verified ? 'yes' : 'no',
          updated_at: now,
        });
      });
    });
  });

  appendRows('courses', rows);
  return { ok: true, written: rows.length };
}

/** Flat hole rows reassembled into the nested course shape the app uses. */
function pullCourses() {
  var rows = readAll('courses');
  var byCourse = {};

  rows.forEach(function (row) {
    var id = String(row.course_id);
    if (!id) return;
    if (!byCourse[id]) {
      byCourse[id] = {
        id: id,
        name: row.course_name,
        verified: row.verified === 'yes',
        source: 'sheet',
        tees: {},
      };
    }
    var course = byCourse[id];
    var teeName = String(row.tee_name);
    if (!course.tees[teeName]) course.tees[teeName] = [];
    course.tees[teeName].push({
      hole: Number(row.hole),
      par: Number(row.par),
      yards: Number(row.yards),
    });
  });

  var courses = Object.keys(byCourse).map(function (id) {
    var course = byCourse[id];
    return {
      id: course.id,
      name: course.name,
      verified: course.verified,
      source: 'sheet',
      tees: Object.keys(course.tees).map(function (teeName) {
        return {
          name: teeName,
          holes: course.tees[teeName].sort(function (a, b) { return a.hole - b.hole; }),
        };
      }),
    };
  });

  return { ok: true, courses: courses };
}
