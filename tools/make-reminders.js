/*
 * make-reminders.js — writes the static calendar files under /reminders/.
 *
 * iPhone won't import a calendar file the app builds in the browser (a data
 * link does nothing in an installed web app), but Safari hands a real .ics
 * link from the website straight to Calendar's "Add" sheet. So the site
 * carries one small file per kind of debt, due day and alert lead time, and
 * the app links to the ones a person needs. They hold no personal data: a
 * general title, a day of the month and an alert.
 *
 *   node tools/make-reminders.js      -> reminders/<kind>-<day>-<lead>.ics + checkin.ics
 *
 * Must match _calRrule() and buildReminderIcs() in app/dashboard.html.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'reminders');
const APP = 'https://mydebtdashboard.com/app/dashboard.html';
const KINDS = { card: 'Card payment due', loan: 'Loan payment due', mortgage: 'Mortgage payment due' };
const LEADS = [1, 3, 7];
const STAMP = '20261113T000000Z';

const rrule = day => {
  if (day <= 28) return 'FREQ=MONTHLY;BYMONTHDAY=' + day;
  const days = []; for (let i = 28; i <= day; i++) days.push(i);
  return 'FREQ=MONTHLY;BYMONTHDAY=' + days.join(',') + ';BYSETPOS=-1';
};
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
const fold = line => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
const dd = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + dd(d.getMonth() + 1) + dd(d.getDate());

function ics(uid, title, day, desc, lead) {
  // January has 31 days, so every day of the month has a real first occurrence.
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DebtFree Dashboard//Payment reminders//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + STAMP,
    'DTSTART;VALUE=DATE:' + ymd(new Date(2026, 0, day)), 'DTEND;VALUE=DATE:' + ymd(new Date(2026, 0, day + 1)),
    'RRULE:' + rrule(day), 'SUMMARY:' + esc(title), 'DESCRIPTION:' + esc(desc), 'TRANSP:TRANSPARENT'];
  if (lead) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(title), 'TRIGGER:-PT' + (24 * lead - 9) + 'H', 'END:VALARM');
  L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(title), 'TRIGGER:PT9H', 'END:VALARM');
  L.push('END:VEVENT', 'END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const kind of Object.keys(KINDS)) {
  for (let day = 1; day <= 31; day++) {
    for (const lead of LEADS) {
      const body = ics('debtfree-' + kind + '-' + day + '@mydebtdashboard.com', KINDS[kind], day,
        'Open DebtFree to log it: ' + APP, lead);
      fs.writeFileSync(path.join(OUT, kind + '-' + day + '-' + lead + '.ics'), body);
      n++;
    }
  }
}
fs.writeFileSync(path.join(OUT, 'checkin.ics'), ics('debtfree-checkin@mydebtdashboard.com', 'DebtFree check-in', 1,
  'Log last month\u2019s payments and see where your debt-free date landed: ' + APP, 0));
n++;
console.log('wrote ' + n + ' files to reminders/');
