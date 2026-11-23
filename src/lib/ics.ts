// Export calendrier (.ics) : fichier que l'utilisatrice ouvre elle-même dans l'app Calendrier.
// Aucune connexion à un compte de calendrier. Le rappel est géré ensuite par le calendrier du téléphone.

import type { Deadline } from '../db/schema';
import { addDays } from './dates';
import { fmtMoney } from './money';
import { TYPE_LABEL } from './deadlines';

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

const compact = (iso: string) => iso.replace(/-/g, '');

export function deadlinesToICS(list: Deadline[], reminderTime: string, stampDate = new Date()): string {
  const [h, m] = reminderTime.split(':').map(Number);
  // Événement « journée entière » : le rappel la veille à HH:MM = (24h − HH:MM) avant minuit.
  const minutesBefore = 24 * 60 - (h * 60 + (m || 0));
  const trigger = `-PT${Math.floor(minutesBefore / 60)}H${minutesBefore % 60 ? (minutesBefore % 60) + 'M' : ''}`;
  const stamp = stampDate.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chema//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const d of list) {
    const desc = [TYPE_LABEL[d.type], d.amount && d.currency ? fmtMoney(d.amount, d.currency) : '', d.note ?? ''].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.id}@chema`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(d.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(d.date, 1))}`,
      fold(`SUMMARY:${esc(d.title)}`),
      fold(`DESCRIPTION:${esc(desc)}`),
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${esc('Demain : ' + d.title)}`),
      `TRIGGER:${trigger}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
