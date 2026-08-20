// Baut "Zum Kalender hinzufügen"-Links (Google, Outlook, Yahoo) und eine
// .ics-Datei (für Apple Kalender, Outlook Desktop, Thunderbird, etc.) aus
// einer Buchung. Alle Uhrzeiten werden über die lokale Zeitzone des Prozesses
// (Europe/Berlin, siehe TZ in server.js / netlify/functions/api.js) korrekt
// nach UTC umgerechnet.

function pad(n) {
  return String(n).padStart(2, "0");
}

function localDate(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0);
}

// Kompaktes UTC-Format für iCalendar/Google/Yahoo: YYYYMMDDTHHMMSSZ
function toIcsUtc(date) {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// ISO-Format mit Doppelpunkten für Outlook: YYYY-MM-DDTHH:MM:SSZ
function toIsoUtcSeconds(date) {
  return date.toISOString().split(".")[0] + "Z";
}

function buildQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
}

function buildCalendarLinks({ title, description, location, date, startTime, endTime }) {
  const start = localDate(date, startTime);
  const end = localDate(date, endTime);
  const icsStart = toIcsUtc(start);
  const icsEnd = toIcsUtc(end);
  const isoStart = toIsoUtcSeconds(start);
  const isoEnd = toIsoUtcSeconds(end);
  const durationMinutes = Math.max(0, Math.round((end - start) / 60000));
  const dur = `${pad(Math.floor(durationMinutes / 60))}${pad(durationMinutes % 60)}`;

  const google = `https://calendar.google.com/calendar/render?${buildQuery({
    action: "TEMPLATE",
    text: title,
    dates: `${icsStart}/${icsEnd}`,
    details: description,
    location,
  })}`;

  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?${buildQuery({
    path: "/calendar/action/compose",
    rru: "addevent",
    startdt: isoStart,
    enddt: isoEnd,
    subject: title,
    body: description,
    location,
  })}`;

  const yahoo = `https://calendar.yahoo.com/?${buildQuery({
    v: 60,
    view: "d",
    type: 20,
    title,
    st: icsStart,
    dur,
    desc: description,
    in_loc: location,
  })}`;

  return { google, outlook, yahoo };
}

function escapeIcsText(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function buildIcs({ uid, title, description, location, date, startTime, endTime }) {
  const start = localDate(date, startTime);
  const end = localDate(date, endTime);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Funky Cuts//Terminbuchung//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    description ? `DESCRIPTION:${escapeIcsText(description)}` : null,
    location ? `LOCATION:${escapeIcsText(location)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

module.exports = { buildCalendarLinks, buildIcs };
