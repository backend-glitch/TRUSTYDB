export function freshnessFromTimestamp(timestamp, windowDays = 30, now = new Date()) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 0;
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
  return Math.max(0, Math.min(1, 1 - ageDays / windowDays));
}
