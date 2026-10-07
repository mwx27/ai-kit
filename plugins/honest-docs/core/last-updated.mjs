// Rewrites the `**Last Updated:**` line of every changed doc to the file's own mtime, so the date
// never depends on someone remembering it. Called by the guard gate on the files it is about to
// check — the ones that changed since their last check — so a branch switch that only touches mtime
// stamps nothing.
//
// The date comes from the file, not the clock, and the mtime is put back after the write: a second
// session in the same repo, whose gate also sees the doc as changed, then computes the same line and
// writes nothing. Stamping with the clock made two sessions rewrite each other's date on every stop.
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const LAST_UPDATED_LINE = /^\*\*Last Updated:\*\* .*$/m;

// en-GB is what yields CET / CEST rather than GMT+1 / GMT+2 for a European zone.
const formatter = (timeZone) =>
  new Intl.DateTimeFormat('en-GB', {
    ...(timeZone ? { timeZone } : {}),
    timeZoneName: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

function stampTime(format, date) {
  const part = Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute} ${part.timeZoneName}`;
}

/**
 * Stamps the `.md` files among `files` that carry the line, in `timeZone` (null = the system's);
 * returns the ones whose content changed.
 */
export function stampLastUpdated(root, files, timeZone) {
  const format = formatter(timeZone);
  const stamped = [];
  for (const file of files.filter((name) => name.endsWith('.md'))) {
    const abs = path.join(root, file);
    const text = readFileSync(abs, 'utf8');
    const match = text.match(LAST_UPDATED_LINE);
    if (!match) continue;

    const { atime, mtime } = statSync(abs);
    const stamp = `**Last Updated:** ${stampTime(format, mtime)}`;
    if (match[0] === stamp) continue;

    writeFileSync(abs, text.replace(LAST_UPDATED_LINE, stamp));
    utimesSync(abs, atime, mtime);
    stamped.push(file);
  }
  return stamped;
}
