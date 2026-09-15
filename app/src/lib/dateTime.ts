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
