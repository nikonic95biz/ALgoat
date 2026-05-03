import { TickMarkType } from "lightweight-charts";
import type { Time } from "lightweight-charts";

export const CHART_TZ_CHOICE_KEY = "unt_chart_tz_choice_v1";

/** Stored value: follow the browser zone, or a fixed IANA name. */
export type ChartTimezoneChoice = "auto" | string;

export const CHART_TIMEZONE_SELECT_OPTIONS: { value: string; label: string }[] = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York" },
  { value: "America/Chicago", label: "Chicago" },
  { value: "America/Denver", label: "Denver" },
  { value: "America/Los_Angeles", label: "Los Angeles" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Bangkok", label: "Bangkok" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Shanghai", label: "Shanghai" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Pacific/Auckland", label: "Auckland" },
];

export function detectBrowserTimeZone(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return z && z.length > 0 ? z : "UTC";
  } catch {
    return "UTC";
  }
}

export function loadChartTimezoneChoice(): ChartTimezoneChoice {
  try {
    const raw = localStorage.getItem(CHART_TZ_CHOICE_KEY)?.trim();
    if (!raw || raw === "auto") return "auto";
    try {
      Intl.DateTimeFormat(undefined, { timeZone: raw }).format(new Date());
    } catch {
      return "auto";
    }
    return raw;
  } catch {
    return "auto";
  }
}

export function saveChartTimezoneChoice(choice: ChartTimezoneChoice): void {
  try {
    localStorage.setItem(CHART_TZ_CHOICE_KEY, choice === "auto" ? "auto" : choice);
  } catch {
    /* ignore */
  }
}

export function effectiveChartTimeZone(choice: ChartTimezoneChoice): string {
  if (choice === "auto") return detectBrowserTimeZone();
  return choice;
}

/** Bottom-right HUD: `18:42 GMT+7` style (TradingView-like). */
export function formatTimezoneHudLabel(timeZone: string, locale: string, now: Date): string {
  const hhmm = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(now);
  const offset =
    parts.find((p) => p.type === "timeZoneName")?.value?.replace(/\u2212/g, "-") ?? "";

  return offset ? `${hhmm} ${offset}` : hhmm;
}

/** Tick marks must stay short (library warns ~8 chars). */
function clipTickLabel(s: string): string {
  return s.length <= 10 ? s : `${s.slice(0, 9)}…`;
}

export function utcSecondsFromChartTime(time: Time): number {
  if (typeof time === "number") return time;
  if (typeof time === "string") return Math.floor(new Date(time).getTime() / 1000);
  if (time && typeof time === "object" && "year" in time) {
    const b = time as { year: number; month: number; day: number };
    return Math.floor(Date.UTC(b.year, b.month - 1, b.day) / 1000);
  }
  return 0;
}

export function formatChartCrosshairTime(
  time: Time,
  timeZone: string,
  locale: string,
  showSeconds: boolean,
): string {
  const sec = utcSecondsFromChartTime(time);
  const d = new Date(sec * 1000);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  }).format(d);
}

export function formatChartTickMark(
  time: Time,
  tickMarkType: TickMarkType,
  locale: string,
  timeZone: string,
): string | null {
  const sec = utcSecondsFromChartTime(time);
  const d = new Date(sec * 1000);

  switch (tickMarkType) {
    case TickMarkType.Year:
      return clipTickLabel(
        new Intl.DateTimeFormat(locale, { timeZone, year: "numeric" }).format(d),
      );
    case TickMarkType.Month:
      return clipTickLabel(
        new Intl.DateTimeFormat(locale, { timeZone, month: "short", year: "2-digit" }).format(d),
      );
    case TickMarkType.DayOfMonth:
      return clipTickLabel(
        new Intl.DateTimeFormat(locale, { timeZone, month: "numeric", day: "numeric" }).format(d),
      );
    case TickMarkType.TimeWithSeconds:
      return clipTickLabel(
        new Intl.DateTimeFormat(locale, {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(d),
      );
    case TickMarkType.Time:
      return clipTickLabel(
        new Intl.DateTimeFormat(locale, {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(d),
      );
    default:
      return null;
  }
}
