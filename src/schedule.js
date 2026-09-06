/* ---------------------------------------------------------------
   schedule.js — tee times, the calendar grid, and calendar export.

   A tee time is a plan, not a record. It never holds a score and it
   is never the source of truth for what happened — a round is. What
   connects the two is `groupId`, stamped onto every round started
   from the same tee time.

   THAT IS THE WHOLE MULTIPLAYER MECHANISM, and it is deliberate.
   Everyone still writes their own round and their own shots; nothing
   ever writes to a row somebody else owns. Rounds sharing a groupId
   can be joined afterwards into a leaderboard or a side-by-side
   comparison. A live in-round leaderboard would need concurrent
   appends to one shared record, which is exactly what a Google Sheet
   over patchy course signal cannot be trusted to do.

   DATES ARE LOCAL, AND STORED AS TEXT. A tee time is "the 14th at
   8:40", not an instant — storing it as an ISO timestamp means a
   round booked at 8:40 shows up on the 13th for anyone whose phone
   sits west of Greenwich, and means the app has to guess a timezone
   to read it back. So `date` is YYYY-MM-DD and `time` is HH:MM, both
   as the person entering them meant them, and a real instant is only
   constructed at the moment one is needed — which is calendar export
   and nowhere else.
--------------------------------------------------------------- */

export const KINDS = ['round', 'practice'];

export const KIND_LABELS = { round: 'Round', practice: 'Practice' };

export const PRACTICE_TYPES = ['Range', 'Short game', 'Putting', 'Lesson'];

export const STATUSES = ['scheduled', 'played', 'cancelled'];

/* --- Local date handling ----------------------------------------- */

function pad(n) {
  return String(n).padStart(2, '0');
}

/** A Date to the YYYY-MM-DD it falls on in the phone's own timezone. */
export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey() {
  return dateKey(new Date());
}

/**
 * Back to a Date at local midnight. Built from parts rather than
 * `new Date(string)`, which parses a bare YYYY-MM-DD as UTC and so
 * lands on the previous day for anybody west of Greenwich.
 */
export function parseDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isValidDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return false;
  const date = parseDateKey(key);
  return !isNaN(date.getTime()) && dateKey(date) === key;
}

/** HH:MM, 24 hour, or '' for a time still to be confirmed. */
export function isValidTime(time) {
  if (!time) return true;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time));
}

/** 08:40 as the phone would write it — 8:40 AM, or 08:40, per locale. */
export function fmtTime(time) {
  if (!time) return 'time TBD';
  const [h, m] = String(time).split(':').map(Number);
  return new Date(2000, 0, 1, h, m)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtDateKey(key) {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

/** Whole days from today, negative for the past. */
export function daysFromToday(key) {
  const today = parseDateKey(todayKey());
  const then = parseDateKey(key);
  return Math.round((then - today) / 86400000);
}

/* --- Tee times ---------------------------------------------------- */

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * `groupId` is generated here rather than when a round starts, so
 * everyone invited stamps the same one without having to agree on it
 * over the internet from a car park.
 */
export function newTeeTime({
  owner,
  invitees = [],
  date,
  time = '',
  courseId = null,
  courseName = '',
  teeName = null,
  layoutKey = null,
  holes = null,
  kind = 'round',
  practiceType = null,
  notes = '',
}) {
  const now = new Date().toISOString();
  return {
    id: randomId('tt'),
    schema: 1,
    owner,
    invitees: cleanInvitees(invitees, owner),
    date,
    time: time || '',
    courseId: courseId || null,
    courseName: courseName || '',
    teeName: teeName || null,
    // Which nine or pairing, so starting the round from the schedule
    // does not drop you back on the course picker to choose it again.
    layoutKey: layoutKey || null,
    holes: holes || null,
    kind: KINDS.includes(kind) ? kind : 'round',
    practiceType: practiceType || null,
    notes: notes || '',
    groupId: randomId('g'),
    status: 'scheduled',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

/**
 * The owner is always present and never listed twice, so "who is
 * playing" is `[owner, ...invitees]` with no de-duplication needed
 * at every call site.
 */
export function cleanInvitees(invitees, owner) {
  return (invitees || [])
    .map((n) => String(n).trim())
    .filter(Boolean)
    .filter((n) => n.toLowerCase() !== String(owner || '').toLowerCase())
    .filter((n, i, all) => all.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i);
}

export function playersOf(teeTime) {
  return [teeTime.owner, ...(teeTime.invitees || [])];
}

/**
 * Whether a tee time is any of this player's business. Not security —
 * everyone shares one sheet secret and could read the tab directly.
 * It is there so five people do not each see five people's calendars.
 */
export function visibleTo(teeTime, player) {
  if (!teeTime || teeTime.deletedAt) return false;
  const name = String(player || '').toLowerCase();
  return playersOf(teeTime).some((p) => String(p).toLowerCase() === name);
}

export function visibleTeeTimes(teeTimes, player) {
  return (teeTimes || []).filter((t) => visibleTo(t, player));
}

/** A short line describing what the tee time actually is. */
export function describeTeeTime(teeTime) {
  if (teeTime.kind === 'practice') return teeTime.practiceType || 'Practice';
  return teeTime.courseName || 'Round';
}

/** How long to block out, in minutes. */
export function durationMinutes(teeTime) {
  if (teeTime.kind === 'practice') return 90;
  return Number(teeTime.holes) === 9 ? 135 : 270;
}

/* --- The month grid ----------------------------------------------- */

export const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Six weeks of seven days covering the month, padded out with the
 * days either side so the grid never reflows between months. A fixed
 * height matters more than a tight one on a phone — a calendar that
 * changes size as you page through it is unpleasant to use.
 */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const today = todayKey();

  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(
        start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d
      );
      const key = dateKey(date);
      days.push({
        key,
        day: date.getDate(),
        inMonth: date.getMonth() === month,
        isToday: key === today,
      });
    }
    weeks.push(days);
  }
  return weeks;
}

export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long', year: 'numeric',
  });
}

/** Tee times and finished rounds indexed by the day they fall on. */
export function calendarIndex(teeTimes, rounds) {
  const index = new Map();
  const bucket = (key) => {
    if (!index.has(key)) index.set(key, { teeTimes: [], rounds: [] });
    return index.get(key);
  };

  (teeTimes || []).forEach((t) => {
    if (t.deletedAt) return;
    bucket(t.date).teeTimes.push(t);
  });

  (rounds || []).forEach((r) => {
    // A round's date IS an instant, unlike a tee time's, so it has to
    // be converted to the local day it happened on.
    bucket(dateKey(new Date(r.date))).rounds.push(r);
  });

  return index;
}

/* --- Calendar export ---------------------------------------------- */

/**
 * Fold to 75 octets, as iCalendar requires. A long note on a course
 * with a long name will otherwise produce a line some parsers reject
 * outright — and that failure looks, on a phone, like nothing at all
 * having happened.
 */
function fold(line) {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) {
    parts.push(' ' + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  if (rest) parts.push(' ' + rest);
  return parts.join('\r\n');
}

function escapeText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function stampUTC(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * DTSTART is written in UTC rather than as a local time with a TZID.
 *
 * A TZID is only meaningful alongside a VTIMEZONE block defining that
 * zone's offsets and daylight-saving rules, and generating a correct
 * one in the browser is a project of its own. A UTC instant needs no
 * such definition, is unambiguous, and every calendar renders it back
 * in the reader's own local time — which, for a tee time booked on
 * the same phone, is the time that was typed in.
 */
function eventTimes(teeTime) {
  if (!teeTime.time) {
    // No time yet: an all-day entry, which is what TBD means to a
    // calendar. DTEND on an all-day event is exclusive.
    const start = parseDateKey(teeTime.date);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return {
      allDay: true,
      start: dateKey(start).replace(/-/g, ''),
      end: dateKey(end).replace(/-/g, ''),
    };
  }
  const [h, m] = teeTime.time.split(':').map(Number);
  const base = parseDateKey(teeTime.date);
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
  const end = new Date(start.getTime() + durationMinutes(teeTime) * 60000);
  return { allDay: false, start: stampUTC(start), end: stampUTC(end) };
}

function summaryFor(teeTime) {
  if (teeTime.kind === 'practice') return teeTime.practiceType || 'Practice';
  return `Golf — ${teeTime.courseName || 'TBD'}`;
}

/**
 * One VEVENT per tee time. UID is the tee time's own id, so exporting
 * the same one twice updates the calendar entry rather than leaving
 * two copies of a round nobody is playing twice.
 *
 * Export only goes one way. A web app cannot read the iOS calendar,
 * so Ledger is the source of truth and the phone calendar is a
 * mirror — editing the entry on the phone changes nothing here.
 */
export function toICS(teeTimes, { productId = '-//Ledger//Golf//EN' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  const now = stampUTC(new Date());

  teeTimes.forEach((teeTime) => {
    const times = eventTimes(teeTime);
    const detail = [
      teeTime.teeName ? `${teeTime.teeName} tees` : '',
      playersOf(teeTime).join(', '),
      teeTime.notes || '',
    ].filter(Boolean).join('\n');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${teeTime.id}@ledger`);
    lines.push(`DTSTAMP:${now}`);
    if (times.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${times.start}`);
      lines.push(`DTEND;VALUE=DATE:${times.end}`);
    } else {
      lines.push(`DTSTART:${times.start}`);
      lines.push(`DTEND:${times.end}`);
    }
    lines.push(`SUMMARY:${escapeText(summaryFor(teeTime))}`);
    if (teeTime.courseName) lines.push(`LOCATION:${escapeText(teeTime.courseName)}`);
    if (detail) lines.push(`DESCRIPTION:${escapeText(detail)}`);
    if (teeTime.status === 'cancelled') lines.push('STATUS:CANCELLED');

    // One alarm, an hour out. Enough time to leave the house; not so
    // much that it becomes something to dismiss and forget.
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-PT60M');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${escapeText(summaryFor(teeTime))}`);
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/* --- Sheet shape --------------------------------------------------- */

/** One tee time as the flat row the sheet stores. */
export function flattenTeeTime(teeTime) {
  return {
    tee_time_id: teeTime.id,
    owner: teeTime.owner,
    invitees: (teeTime.invitees || []).join(','),
    date: teeTime.date,
    time: teeTime.time || '',
    course_id: teeTime.courseId || '',
    course_name: teeTime.courseName || '',
    tee_name: teeTime.teeName || '',
    kind: teeTime.kind,
    practice_type: teeTime.practiceType || '',
    notes: teeTime.notes || '',
    group_id: teeTime.groupId,
    status: teeTime.status,
    created_at: teeTime.createdAt,
    updated_at: teeTime.updatedAt,
    deleted_at: teeTime.deletedAt || '',
    layout_key: teeTime.layoutKey || '',
    holes: teeTime.holes == null ? '' : teeTime.holes,
  };
}

/**
 * Back from a sheet row. The day and the time are read as text on
 * purpose — Sheets hands back a Date object for anything it decided
 * was a date, and converting that to a day string runs it through a
 * timezone the spreadsheet chose rather than the one the tee time
 * was booked in.
 */
export function rebuildTeeTime(row) {
  const owner = String(row.owner || '');
  return {
    id: String(row.tee_time_id),
    schema: 1,
    owner,
    invitees: cleanInvitees(String(row.invitees || '').split(','), owner),
    date: sheetDateKey(row.date),
    time: sheetTime(row.time),
    courseId: row.course_id ? String(row.course_id) : null,
    courseName: String(row.course_name || ''),
    teeName: row.tee_name ? String(row.tee_name) : null,
    layoutKey: row.layout_key ? String(row.layout_key) : null,
    holes: row.holes === '' || row.holes == null ? null : Number(row.holes),
    kind: String(row.kind) === 'practice' ? 'practice' : 'round',
    practiceType: row.practice_type ? String(row.practice_type) : null,
    notes: String(row.notes || ''),
    groupId: String(row.group_id || ''),
    status: STATUSES.includes(String(row.status)) ? String(row.status) : 'scheduled',
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

/** A cell that may have arrived as text or as a Date, either way a day. */
function sheetDateKey(value) {
  if (value instanceof Date) return dateKey(value);
  const text = String(value || '').trim();
  if (isValidDateKey(text)) return text;
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? todayKey() : dateKey(parsed);
}

/** Likewise a time, which Sheets may have turned into a Date in 1899. */
function sheetTime(value) {
  if (value instanceof Date) return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${pad(Number(match[1]))}:${match[2]}` : '';
}
