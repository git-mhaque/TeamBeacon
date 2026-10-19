export function formatDisplayTimestamp(value: string | null | undefined, fallback = "Not available"): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;

  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(parsed);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return `${byType.get("day")}-${byType.get("month")}-${byType.get("year")}, ${byType.get("hour")}:${byType.get("minute")} ${byType.get("dayPeriod")}`;
}

export function formatRelativeTimestamp(value: string | null | undefined, now = Date.now()): string {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "time unavailable";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes === 0) return "just now";
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? formatter.format(-hours, "hour") : formatter.format(-Math.floor(hours / 24), "day");
}
