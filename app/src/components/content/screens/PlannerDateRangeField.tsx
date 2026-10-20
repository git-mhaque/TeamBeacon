import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

type Dates = { startDate: string | null; endDate: string | null };
type Props = Dates & { onChange: (dates: Dates) => void };
const DAY = 86400000;
const parse = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const monthOf = (date: string) => parse(date).getUTCFullYear() * 12 + parse(date).getUTCMonth();
const monthDate = (month: number, day = 1) => {
  const date = new Date(0);
  date.setUTCFullYear(Math.floor(month / 12), month % 12, day);
  return date;
};
const formatDate = (date: string | null) => date
  ? parse(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  : "Not set";
const dayLabel = (date: string) => parse(date).toLocaleDateString("en-GB", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

function DateRangeCalendar({ startDate, endDate, onChange, onClose }: Props & { onClose: () => void }) {
  const [start, setStart] = useState(startDate);
  const [finish, setFinish] = useState(endDate);
  const [choosing, setChoosing] = useState<"start" | "finish">(startDate && !endDate ? "finish" : "start");
  const [focusedDay, setFocusedDay] = useState(startDate ?? endDate ?? today());
  const [month, setMonth] = useState(monthOf(focusedDay));
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const moveFocus = useRef(false);
  const heading = useId();
  const instructions = useId();
  const currentDay = today();
  const rangeEnd = choosing === "finish" && hoveredDay && start && hoveredDay >= start ? hoveredDay : finish;
  const duration = start && finish ? Math.round((parse(finish).getTime() - parse(start).getTime()) / DAY) + 1 : null;

  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    element.showModal();
    element.querySelector<HTMLButtonElement>('[data-day][tabindex="0"]')!.focus();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      opener.focus();
    };
  }, []);
  useEffect(() => {
    if (moveFocus.current) {
      dialog.current!.querySelector<HTMLButtonElement>('[data-day][tabindex="0"]')!.focus();
      moveFocus.current = false;
    }
  }, [focusedDay, month]);

  const choose = (date: string) => {
    setFocusedDay(date); setHoveredDay(null);
    if (choosing === "start" || (start && date < start)) {
      setStart(date); setFinish(null); setChoosing("finish");
    } else {
      setFinish(date); setChoosing("start");
    }
  };
  const navigate = (value: number) => {
    setMonth(value); setFocusedDay(iso(monthDate(value))); setHoveredDay(null);
  };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const weekday = (parse(date).getUTCDay() + 6) % 7;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = iso(new Date(parse(date).getTime() + offsets[event.key] * DAY));
    setHoveredDay(null);
    if (next === date) return;
    const nextMonth = monthOf(next);
    if (nextMonth < month || nextMonth > month + 1) setMonth(nextMonth);
    moveFocus.current = true;
    setFocusedDay(next);
  };

  return createPortal(<dialog ref={dialog} className="tb-modal tb-planner-date-calendar"
    aria-labelledby={heading} aria-describedby={instructions}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header className="tb-modal-head">
      <div><h3 id={heading}>Plan epic dates</h3><p className="tb-muted-note">Choose a start date, then a finish date.</p></div>
      <button type="button" className="tb-btn tb-btn-sm" onClick={onClose}>Close calendar</button>
    </header>
    <div className="tb-planner-date-endpoints">
      <button type="button" aria-label={`Planned start ${formatDate(start)}`} aria-pressed={choosing === "start"} onClick={() => { setChoosing("start"); setHoveredDay(null); }}>
        <span>Planned start</span><strong>{formatDate(start)}</strong>
      </button>
      <button type="button" aria-label={`Planned finish ${formatDate(finish)}`} aria-pressed={choosing === "finish"} onClick={() => { setChoosing("finish"); setHoveredDay(null); }}>
        <span>Planned finish</span><strong>{formatDate(finish)}</strong>
      </button>
    </div>
    <div className="tb-planner-calendar-navigation">
      <button type="button" className="tb-btn tb-btn-sm" aria-label="Previous month" onClick={() => navigate(month - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <button type="button" className="tb-btn tb-btn-sm" onClick={() => navigate(monthOf(currentDay))}>This month</button>
      <button type="button" className="tb-btn tb-btn-sm" aria-label="Next month" onClick={() => navigate(month + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
    </div>
    <div className="tb-planner-calendar-months" onMouseLeave={() => setHoveredDay(null)}>
      {[month, month + 1].map(value => {
        const first = monthDate(value);
        const name = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
        const offset = (first.getUTCDay() + 6) % 7;
        const length = monthDate(value + 1, 0).getUTCDate();
        return <section key={value} aria-label={name}>
          <h4>{name}</h4>
          <div className="tb-planner-calendar-grid">
            {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(weekday => <span key={weekday} aria-hidden="true" className="tb-planner-calendar-weekday">{weekday}</span>)}
            {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
            {Array.from({ length }, (_, index) => {
              const date = iso(monthDate(value, index + 1));
              const endpoint = date === start || date === finish;
              const inRange = Boolean(start && rangeEnd && date >= start && date <= rangeEnd);
              return <button key={date} type="button" data-day={date}
                className={`tb-planner-calendar-day${inRange ? " is-in-range" : ""}${endpoint ? " is-endpoint" : ""}`}
                tabIndex={date === focusedDay ? 0 : -1} aria-label={dayLabel(date)} aria-pressed={endpoint}
                aria-current={date === currentDay ? "date" : undefined}
                onClick={() => choose(date)} onMouseEnter={() => setHoveredDay(date)}
                onKeyDown={event => keyboard(event, date)}>{index + 1}</button>;
            })}
          </div>
        </section>;
      })}
    </div>
    <p id={instructions} className="tb-muted-note" role="status">
      {duration !== null ? `${duration} calendar day${duration === 1 ? "" : "s"} · Start and finish included.`
        : start ? "Choose a finish date, or apply a start-only schedule."
          : finish ? "Choose a start date, or apply a finish-only schedule." : "Select a start date to begin."}
    </p>
    <footer className="tb-modal-actions tb-modal-actions-split">
      <button type="button" className="tb-btn" onClick={() => { setStart(null); setFinish(null); setHoveredDay(null); setChoosing("start"); }}>Clear dates</button>
      <div className="tb-action-row">
        <button type="button" className="tb-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="tb-btn tb-btn-primary" onClick={() => { onChange({ startDate: start, endDate: finish }); onClose(); }}>Apply dates</button>
      </div>
    </footer>
  </dialog>, document.body);
}

export function PlannerDateRangeField({ startDate, endDate, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return <div className="tb-planner-date-field">
    <span className="tb-planner-date-field-label">Planned dates</span>
    <button type="button" className="tb-planner-date-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Planned dates: ${formatDate(startDate)} to ${formatDate(endDate)}`} onClick={() => setOpen(true)}>
      <span><small>Start</small><strong>{formatDate(startDate)}</strong></span>
      <span aria-hidden="true">→</span>
      <span><small>Finish</small><strong>{formatDate(endDate)}</strong></span>
      <CalendarDays size={18} aria-hidden="true" />
    </button>
    {open && <DateRangeCalendar startDate={startDate} endDate={endDate} onChange={onChange} onClose={() => setOpen(false)} />}
  </div>;
}
