// Shared source parser: browser and both workers use these exact rules.
const HEADER_MAP = {
    title: 'title',
    day: 'day',
    date: 'date',
    start: 'start',
    'start time': 'start',
    end: 'end',
    'end time': 'end',
    room: 'room',
    location: 'room',
    groups: 'groups',
    group: 'groups',
    tutor: 'tutor',
    tutors: 'tutor',
    subject: 'subject',
    link: 'link',
    url: 'link',
    moodle: 'link',
};
const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const SPECIALISM_RE = /^specialism\s*\d*\s*[-–—:]\s*(.+)$/i;
function cellText(cell) {
    if (!cell)
        return '';
    if (cell.f != null && cell.f !== '')
        return String(cell.f).trim();
    if (cell.v == null)
        return '';
    return String(cell.v).trim();
}
/** GViz serialises date values as the string "Date(2026,8,2)" (month is 0-based). */
function parseGvizDateString(s) {
    const m = s.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+)(?:,(\d+)(?:,(\d+))?)?)?\)$/);
    if (!m || (m[6] !== undefined && +m[6] > 59) || (m[7] !== undefined && +m[7] > 999))
        return null;
    return {
        y: Number(m[1]), m: Number(m[2]), d: Number(m[3]),
        h: m[4] !== undefined ? Number(m[4]) : undefined,
        min: m[5] !== undefined ? Number(m[5]) : undefined,
    };
}
export function toISODate(y, monthIndex, d) {
    return `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function checkedDate(y, m, d) {
    if (!Number.isInteger(y) || y < 1900 || y > 2200 || !Number.isInteger(m) || !Number.isInteger(d))
        return null;
    const test = new Date(Date.UTC(y, m, d));
    return test.getUTCFullYear() === y && test.getUTCMonth() === m && test.getUTCDate() === d ? toISODate(y, m, d) : null;
}
/** Reject impossible dates instead of letting Date normalise them into another month. */
export function parseDateCell(cell) {
    if (!cell)
        return null;
    if (typeof cell.v === 'string') {
        const g = parseGvizDateString(cell.v);
        if (g)
            return checkedDate(g.y, g.m, g.d);
    }
    const text = cellText(cell);
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso)
        return checkedDate(+iso[1], +iso[2] - 1, +iso[3]);
    const named = text.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})$/);
    if (named) {
        const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
        return month === undefined ? null : checkedDate(+named[3], month, +named[1]);
    }
    const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    return dmy ? checkedDate(+dmy[3], +dmy[2] - 1, +dmy[1]) : null;
}
function checkedTime(h, m) {
    return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h < 24 && m >= 0 && m < 60
        ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : '';
}
export function parseTimeCell(cell) {
    if (!cell)
        return '';
    if (Array.isArray(cell.v) && cell.v.length >= 2 && (cell.v[2] === undefined || Number.isInteger(cell.v[2]) && cell.v[2] >= 0 && cell.v[2] < 60))
        return checkedTime(cell.v[0], cell.v[1]);
    if (typeof cell.v === 'string') {
        const g = parseGvizDateString(cell.v);
        if (g && g.h !== undefined && g.min !== undefined)
            return checkedTime(g.h, g.min);
    }
    const match = cellText(cell).match(/^(\d{1,2})[:.](\d{2})(?::[0-5]\d)?\s*(am|pm)?$/i);
    if (!match)
        return '';
    let h = +match[1];
    if (match[3]) {
        if (h < 1 || h > 12)
            return '';
        h = h % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
    }
    return checkedTime(h, +match[2]);
}
function detectHeaderRow(table) {
    const limit = Math.min(table.rows.length, 10);
    for (let r = 0; r < limit; r++) {
        const cells = table.rows[r].c;
        const colMap = {};
        let matches = 0;
        cells.forEach((cell, i) => {
            const field = HEADER_MAP[cellText(cell).toLowerCase()];
            if (field !== undefined && colMap[field] === undefined) {
                colMap[field] = i;
                matches++;
            }
        });
        if (matches >= 3)
            return { headerIndex: r, colMap };
    }
    return null;
}
/**
 * Some sheets leave the Date/Start/End header cells blank (they come back empty from GViz).
 * Infer them from GViz's declared column types first, then by sniffing cell values.
 */
function inferMissingColumns(table, headerIndex, colMap) {
    const width = Math.max(table.cols.length, ...table.rows.map((r) => r.c.length), 0);
    const taken = new Set(Object.values(colMap));
    const sniff = (i, test) => {
        let hits = 0;
        let nonEmpty = 0;
        for (let r = headerIndex + 1; r < Math.min(table.rows.length, headerIndex + 40); r++) {
            const cell = table.rows[r].c[i] ?? null;
            if (!cell || cell.v == null)
                continue;
            nonEmpty++;
            if (test(cell))
                hits++;
        }
        return nonEmpty > 0 && hits / nonEmpty > 0.5;
    };
    const findColumn = (declaredTypes, test) => {
        for (let i = 0; i < width; i++) {
            if (taken.has(i))
                continue;
            if (declaredTypes.includes(table.cols[i]?.type ?? ''))
                return i;
        }
        for (let i = 0; i < width; i++) {
            if (taken.has(i))
                continue;
            if (sniff(i, test))
                return i;
        }
        return undefined;
    };
    if (colMap.date === undefined) {
        const i = findColumn(['date'], (cell) => parseDateCell(cell) !== null);
        if (i !== undefined) {
            colMap.date = i;
            taken.add(i);
        }
    }
    const isTime = (cell) => parseTimeCell(cell) !== '';
    if (colMap.start === undefined) {
        const i = findColumn(['datetime', 'timeofday'], isTime);
        if (i !== undefined) {
            colMap.start = i;
            taken.add(i);
        }
    }
    if (colMap.end === undefined) {
        const i = findColumn(['datetime', 'timeofday'], isTime);
        if (i !== undefined) {
            colMap.end = i;
            taken.add(i);
        }
    }
}
/** If no column was labelled as the link, find a column whose values are mostly URLs. */
function detectLinkColumn(table, headerIndex, taken) {
    const width = Math.max(...table.rows.map((r) => r.c.length), 0);
    for (let i = 0; i < width; i++) {
        if (taken.has(i))
            continue;
        let urls = 0;
        let nonEmpty = 0;
        for (let r = headerIndex + 1; r < table.rows.length; r++) {
            const text = cellText(table.rows[r].c[i] ?? null);
            if (!text)
                continue;
            nonEmpty++;
            if (/^https?:\/\//i.test(text))
                urls++;
        }
        if (nonEmpty > 0 && urls / nonEmpty > 0.5)
            return i;
    }
    return undefined;
}
export function parseTimetable(table) {
    const warnings = [];
    const detected = detectHeaderRow(table);
    if (!detected) {
        throw new Error('Could not find a header row. The sheet needs columns like Title, Day, Date, Start, End, Room, Tutor.');
    }
    const { headerIndex, colMap } = detected;
    inferMissingColumns(table, headerIndex, colMap);
    if (colMap.link === undefined) {
        colMap.link = detectLinkColumn(table, headerIndex, new Set(Object.values(colMap)));
    }
    if (colMap.title === undefined || colMap.date === undefined) {
        throw new Error('The sheet needs at least a Title column and a Date column.');
    }
    const sessions = [];
    let lastDateISO = null;
    let lastDay = '';
    for (let r = headerIndex + 1; r < table.rows.length; r++) {
        const cells = table.rows[r].c;
        const get = (f) => (colMap[f] !== undefined ? cellText(cells[colMap[f]] ?? null) : '');
        const title = get('title');
        let dateISO = parseDateCell(cells[colMap.date] ?? null);
        let day = get('day');
        // Forward-fill date/day across merged/blank cells
        if (dateISO) {
            lastDateISO = dateISO;
            lastDay = day;
        }
        else if (get('date')) {
            warnings.push(`Row ${r + 1}: invalid date '${get('date')}'. Row skipped.`);
            lastDateISO = null;
            lastDay = '';
            continue;
        }
        else {
            dateISO = lastDateISO;
            if (!day)
                day = lastDay;
        }
        if (!title)
            continue;
        if (!dateISO) {
            warnings.push(`Row ${r + 1}: missing valid date. Row skipped.`);
            continue;
        }
        const start = parseTimeCell(colMap.start !== undefined ? cells[colMap.start] ?? null : null);
        const end = parseTimeCell(colMap.end !== undefined ? cells[colMap.end] ?? null : null);
        // Zero-duration rows (end === start) are legitimate point-in-time markers —
        // the sheet uses them for PLT tasks, audit open/close dates and submission
        // deadlines (56 real rows as of Sep 2026). Only genuinely inverted times are bad.
        if ((get('start') && !start) || (get('end') && !end) || (start && end && end < start)) {
            warnings.push(`Row ${r + 1}: invalid time or end before start. Row skipped.`);
            continue;
        }
        const linkText = get('link');
        const specialismMatch = title.match(SPECIALISM_RE);
        sessions.push({
            id: `${dateISO}-${r}`,
            sourceId: (() => { const i = table.rows[headerIndex].c.findIndex(c => /^(event[ _-]?id|session[ _-]?id)$/i.test(cellText(c).trim())); return i < 0 ? undefined : cellText(cells[i]).trim() || undefined; })(),
            title,
            day,
            dateISO,
            start,
            end,
            room: get('room'),
            groups: get('groups'),
            tutor: get('tutor'),
            subject: get('subject'),
            link: /^https?:\/\//i.test(linkText) ? linkText : undefined,
            isSpecialism: !!specialismMatch,
            specialismName: specialismMatch ? specialismMatch[1].trim() : undefined,
            // Any title that says self study IS self study — e.g. "SE1a Briefing Self Study" (owner, 11 Sep 2026).
            isSelfStudy: /\bself[- ]?study\b/i.test(title) || /^self[- ]?study$/i.test(get('tutor')),
            isOptional: /\(optional\)/i.test(title),
        });
    }
    if (sessions.length === 0) {
        warnings.push('No sessions were found below the header row.');
    }
    sessions.sort((a, b) => (a.dateISO + (a.start || '99')).localeCompare(b.dateISO + (b.start || '99')));
    return { sessions, warnings };
}
