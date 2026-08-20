const nodemailer = require("nodemailer");

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

async function send({ to, subject, text }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[mailer] SMTP nicht konfiguriert — Mail an ${to} ("${subject}") wird übersprungen.`);
    return;
  }
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await t.sendMail({ from, to, subject, text });
}

async function sendBookingConfirmation(booking) {
  if (!booking.customer_email) return;
  const salon = process.env.SALON_NAME || "Funky Cuts";
  await send({
    to: booking.customer_email,
    subject: `Terminbestätigung — ${salon}`,
    text: `Hallo ${booking.customer_name},

dein Termin bei ${salon} ist bestätigt:

Leistung: ${booking.service}
Datum: ${formatDateHuman(booking.date)}
Uhrzeit: ${booking.startTime} Uhr

Bis bald!
${salon}`,
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

module.exports = { sendBookingConfirmation, sendCancellationEmail, sendAdminNewBookingNotice, isConfigured: () => configured };
