import type { IndustryEventSummary } from "../api/portalContracts";

type CalendarRange = {
  start: Date;
  end: Date;
};

function toMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUtcCalendarStamp(value: Date): string {
  const pad = (num: number) => String(num).padStart(2, "0");
  return [
    value.getUTCFullYear(),
    pad(value.getUTCMonth() + 1),
    pad(value.getUTCDate()),
    "T",
    pad(value.getUTCHours()),
    pad(value.getUTCMinutes()),
    pad(value.getUTCSeconds()),
    "Z",
  ].join("");
}

function resolveCalendarRange(
  event: Pick<IndustryEventSummary, "startAt" | "endAt">
): CalendarRange | null {
  const startMs = toMs(event.startAt);
  if (startMs === null) return null;
  const fallbackDurationMs = 2 * 60 * 60 * 1000;
  const endMs = Math.max(toMs(event.endAt) ?? startMs + fallbackDurationMs, startMs + 60_000);
  return {
    start: new Date(startMs),
    end: new Date(endMs),
  };
}

function escapeIcsField(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function buildIndustryEventGoogleCalendarUrl(
  event: Pick<IndustryEventSummary, "title" | "summary" | "location" | "timezone" | "startAt" | "endAt" | "sourceUrl">
): string | null {
  const range = resolveCalendarRange(event);
  if (!range) return null;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title || "Industry event",
    dates: `${formatUtcCalendarStamp(range.start)}/${formatUtcCalendarStamp(range.end)}`,
    details: [event.summary || "", event.sourceUrl ? `Source: ${event.sourceUrl}` : ""]
      .filter((entry) => entry.length > 0)
      .join("\n\n"),
    location: event.location || "Monsoon Fire industry event",
  });

  if (event.timezone) {
    params.set("ctz", event.timezone);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function buildIndustryEventIcsContent(
  event: Pick<
    IndustryEventSummary,
    "id" | "title" | "summary" | "location" | "timezone" | "startAt" | "endAt" | "sourceUrl"
  >
): string | null {
  const range = resolveCalendarRange(event);
  if (!range) return null;

  const nowUtc = formatUtcCalendarStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Monsoon Fire//Industry Events//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeIcsField(event.id || `${range.start.getTime()}`)}@monsoonfire.com`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${formatUtcCalendarStamp(range.start)}`,
    `DTEND:${formatUtcCalendarStamp(range.end)}`,
    `SUMMARY:${escapeIcsField(event.title || "Industry event")}`,
    `DESCRIPTION:${escapeIcsField(
      [event.summary || "", event.sourceUrl ? `Source: ${event.sourceUrl}` : ""]
        .filter((entry) => entry.length > 0)
        .join("\n\n")
    )}`,
    `LOCATION:${escapeIcsField(event.location || "Monsoon Fire industry event")}`,
  ];

  if (event.timezone) {
    lines.push(`X-WR-TIMEZONE:${escapeIcsField(event.timezone)}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function industryEventReminderCopy(
  event: Pick<IndustryEventSummary, "startAt" | "timezone">,
  nowMs = Date.now()
): string {
  const startMs = toMs(event.startAt);
  if (startMs === null) return "Schedule details pending verification.";
  const deltaMs = startMs - nowMs;
  if (deltaMs <= 0) return "Happening today.";
  if (deltaMs < 24 * 60 * 60 * 1000) return "Happening today.";
  const deltaDays = Math.ceil(deltaMs / (24 * 60 * 60 * 1000));
  if (deltaDays === 1) return "Starts tomorrow.";
  if (deltaDays <= 14) return `Starts in ${deltaDays} days.`;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: event.timezone || "UTC",
    });
    return `Starts ${formatter.format(new Date(startMs))}.`;
  } catch {
    return "Upcoming event.";
  }
}
