export type DateRange = { startDate: string; endDate: string };

export function validateDateRange({ startDate, endDate }: DateRange): string | null {
  if (!startDate || !endDate) return "Start and end date are required.";
  if (![startDate, endDate].every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value)) {
    return "Invalid reporting period date format.";
  }
  if (startDate > endDate) return "Start date cannot be after end date.";
  return null;
}

export function DateRangeFields({ startDate, endDate, onStartChange, onEndChange }: DateRange & {
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return <>
    <label className="tb-exec-period-field">
      <span>Start</span>
      <input type="date" value={startDate} onInput={(event) => onStartChange(event.currentTarget.value)} />
    </label>
    <label className="tb-exec-period-field">
      <span>End</span>
      <input type="date" value={endDate} onInput={(event) => onEndChange(event.currentTarget.value)} />
    </label>
  </>;
}
