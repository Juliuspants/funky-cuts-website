const nodemailer = require("nodemailer");
const { buildCalendarLinks, buildIcs } = require("./calendar");

// E-Mail-Versand ist komplett optional. Solange SMTP_HOST nicht in der .env
// gesetzt ist, werden alle Mails übersprungen (nur Konsolen-Hinweis) — die
// App funktioniert auch ohne konfigurierten Mailserver einwandfrei.
let transporter = null;
let configured = false;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    // Großzügigere Timeouts als der Standard — in Serverless-Umgebungen
    // (Netlify Functions) kann der erste Verbindungsaufbau spürbar länger
    // dauern als in einer normalen Node-Umgebung.
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
  });
  configured = true;
  return transporter;
}

function formatDateHuman(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function send({ to, subject, text, html, attachments }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[mailer] SMTP nicht konfiguriert — Mail an ${to} ("${subject}") wird übersprungen.`);
    return;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await t.sendMail({ from, to, subject, text, html, attachments });
}

function calendarButton(href, label) {
  return `<tr><td style="padding-bottom:8px;">
    <a href="${href}" style="display:block; text-align:center; background:#c1815c; color:#ffffff; text-decoration:none; padding:12px 16px; border-radius:8px; font-size:14px; font-weight:600; font-family:Arial,sans-serif;">${label}</a>
  </td></tr>`;
}

async function sendBookingConfirmation(booking) {
  if (!booking.customer_email) return;
  const salon = process.env.SALON_NAME || "Funky Cuts";
  const title = `${booking.service} bei ${salon}`;
  const description = `Termin bei ${salon}\nLeistung: ${booking.service}`;
  const location = booking.location || "";

  const links = buildCalendarLinks({
    title,
    description,
    location,
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
  });
  const ics = buildIcs({
    uid: `booking-${booking.id}@funkycuts.de`,
    title,
    description,
    location,
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
  });

  const html = `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color:#2b2b2b;">
    <h2 style="color:#a86846; margin-bottom:4px;">Termin bestätigt ✂️</h2>
    <p>Hallo ${escapeHtml(booking.customer_name)},</p>
    <p>dein Termin bei <strong>${escapeHtml(salon)}</strong> ist bestätigt:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0; font-size:14px;">
      <tr><td style="padding:4px 0; color:#777;">Leistung</td><td style="padding:4px 0; font-weight:600;">${escapeHtml(booking.service)}</td></tr>
      <tr><td style="padding:4px 0; color:#777;">Datum</td><td style="padding:4px 0; font-weight:600;">${escapeHtml(formatDateHuman(booking.date))}</td></tr>
      <tr><td style="padding:4px 0; color:#777;">Uhrzeit</td><td style="padding:4px 0; font-weight:600;">${escapeHtml(booking.startTime)} Uhr</td></tr>
    </table>
    <p style="margin:0 0 8px; color:#777; font-size:13px;">Mit einem Klick zum Kalender hinzufügen:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">
      ${calendarButton(links.google, "📅 Zu Google Kalender hinzufügen")}
      ${calendarButton(links.outlook, "📅 Zu Outlook hinzufügen")}
      ${calendarButton(links.yahoo, "📅 Zu Yahoo Kalender hinzufügen")}
    </table>
    <p style="color:#999; font-size:12px; margin-top:0;">Apple Kalender oder ein anderes Programm? Einfach die angehängte Datei „termin.ics" öffnen.</p>
    <p style="margin-top:24px;">Bis bald!<br/>${escapeHtml(salon)}</p>
  </div>`;

  const text = `Hallo ${booking.customer_name},

dein Termin bei ${salon} ist bestätigt:

Leistung: ${booking.service}
Datum: ${formatDateHuman(booking.date)}
Uhrzeit: ${booking.startTime} Uhr

Zum Kalender hinzufügen:
Google: ${links.google}
Outlook: ${links.outlook}
Yahoo: ${links.yahoo}
(oder die angehängte Datei termin.ics öffnen)

Bis bald!
${salon}`;

  await send({
    to: booking.customer_email,
    subject: `Terminbestätigung — ${salon}`,
    text,
    html,
    attachments: [
      {
        filename: "termin.ics",
        content: ics,
        contentType: "text/calendar; charset=utf-8; method=PUBLISH",
      },
    ],
  });
}

async function sendCancellationEmail(booking) {
  if (!booking.customer_email) return;
  const salon = process.env.SALON_NAME || "Funky Cuts";
  await send({
    to: booking.customer_email,
    subject: `Dein Termin wurde storniert — ${salon}`,
    text: `Hallo ${booking.customer_name},

dein folgender Termin wurde leider storniert:

Leistung: ${booking.service_name}
Datum: ${formatDateHuman(booking.date)}
Uhrzeit: ${booking.start_time} Uhr

Bitte buche bei Bedarf einfach einen neuen Termin, oder melde dich direkt bei uns.

${salon}`,
  });
}

async function sendAdminNewBookingNotice(booking) {
  const notifyTo = process.env.ADMIN_NOTIFY_EMAIL;
  if (!notifyTo) return;
  const salon = process.env.SALON_NAME || "Funky Cuts";
  await send({
    to: notifyTo,
    subject: `Neue Buchung — ${salon}`,
    text: `Neue Terminbuchung:

Kunde: ${booking.customer_name}
Telefon: ${booking.customer_phone}
${booking.customer_email ? `E-Mail: ${booking.customer_email}\n` : ""}Leistung: ${booking.service}
Datum: ${formatDateHuman(booking.date)}
Uhrzeit: ${booking.startTime} Uhr`,
  });
}

async function sendWaitlistJoined(entry) {
  if (!entry.customer_email) return;
  const salon = process.env.SALON_NAME || "Funky Cuts";
  await send({
    to: entry.customer_email,
    subject: `Du stehst auf der Warteliste — ${salon}`,
    text: `Hallo ${entry.customer_name},

du stehst jetzt auf der Warteliste für den ${formatDateHuman(entry.date)}${entry.serviceName ? ` (${entry.serviceName})` : ""}.

Sobald ein Termin an diesem Tag frei wird, melden wir uns sofort per Mail bei dir.

${salon}`,
  });
}

async function sendAdminWaitlistNotice(entry) {
  const notifyTo = process.env.ADMIN_NOTIFY_EMAIL;
  if (!notifyTo) return;
  const salon = process.env.SALON_NAME || "Funky Cuts";
  await send({
    to: notifyTo,
    subject: `Neuer Warteliste-Eintrag — ${salon}`,
    text: `Neuer Warteliste-Eintrag:

Kunde: ${entry.customer_name}
Telefon: ${entry.customer_phone || "–"}
Datum: ${formatDateHuman(entry.date)}
${entry.serviceName ? `Leistung: ${entry.serviceName}\n` : ""}`,
  });
}

async function sendWaitlistSlotOpened(entry) {
  if (!entry.customer_email) return;
  const salon = process.env.SALON_NAME || "Funky Cuts";
  const bookingUrl = `${process.env.SITE_URL || "https://funkycuts.de"}/buchen/`;
  await send({
    to: entry.customer_email,
    subject: `Ein Termin ist frei geworden — ${salon}`,
    text: `Hallo ${entry.customer_name},

gute Nachrichten! Am ${formatDateHuman(entry.date)} ist gerade ein Termin bei ${salon} frei geworden.

Jetzt schnell buchen, solange der Platz noch frei ist:
${bookingUrl}

${salon}`,
  });
}

module.exports = {
  sendBookingConfirmation,
  sendCancellationEmail,
  sendAdminNewBookingNotice,
  sendWaitlistJoined,
  sendAdminWaitlistNotice,
  sendWaitlistSlotOpened,
  isConfigured: () => configured,
};
