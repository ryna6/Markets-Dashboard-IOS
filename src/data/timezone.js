// src/data/timezone.js
const EST_TIMEZONE = 'America/New_York';

export function toEstIso(date) {
  const estString = date.toLocaleString('en-US', { timeZone: EST_TIMEZONE });
  return new Date(estString).toISOString();
}

export function formatEstTime(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  const opts = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: EST_TIMEZONE,
    hour12: false
  };
  const time = new Intl.DateTimeFormat('en-US', opts).format(d);
  return `${time} EST`;
}

export function isOlderThanMinutes(iso, minutes, tz = EST_TIMEZONE) {
  if (!iso) return true;
  const now = new Date();
  const nowTz = new Date(
    now.toLocaleString('en-US', { timeZone: tz })
  );
  const then = new Date(iso);
  const diffMs = nowTz - then;
  return diffMs > minutes * 60 * 1000;
}

// For earnings-week calculation (Mon–Fri in EST)
export function getCurrentWeekRangeEst(now = new Date()) {
  const estNow = new Date(
    now.toLocaleString('en-US', { timeZone: EST_TIMEZONE })
  );
  const day = estNow.getDay(); // 0 Sun ... 6 Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(estNow);
  monday.setDate(estNow.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);

  return { monday, friday };
}
