export function formatLocalDateTime(utcIso: string): string {
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) {
    return utcIso;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function formatLocalTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startIso} - ${endIso}`;
  }

  const datePart = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(start);

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  const tzPart =
    new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(start)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';

  return `${datePart}, ${timeFmt.format(start)}–${timeFmt.format(end)} ${tzPart}`.trim();
}

export function formatUtcTimeOnly(utcIso: string): string {
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) {
    return utcIso;
  }
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

export function getDurationMinutes(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}
