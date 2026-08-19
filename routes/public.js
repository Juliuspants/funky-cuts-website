const express = require("express");
const db = require("../db");
const { getAvailableSlots, isSlotStillFree, timeToMinutes, minutesToTime } = require("../lib/availability");
const mailer = require("../lib/mailer");

const router = express.Router();

router.get("/services", (req, res) => {
  const services = db
    .prepare("SELECT id, name, duration_minutes, price_cents FROM services WHERE active = 1 ORDER BY sort_order, id")
    .all();
  res.json(services);
});

router.get("/working-hours", (req, res) => {
  const rows = db.prepare("SELECT weekday, closed FROM working_hours ORDER BY weekday").all();
  res.json(rows);
});

router.get("/availability", (req, res) => {
  const { date, serviceId } = req.query;
  if (!date || !serviceId) {
    return res.status(400).json({ error: "date und serviceId werden benötigt." });
  }
  const slots = getAvailableSlots(date, Number(serviceId));
  res.json({ date, serviceId: Number(serviceId), slots });
});

router.post("/bookings", (req, res) => {
  const { serviceId, date, startTime, name, phone, email, note } = req.body || {};

  if (!serviceId || !date || !startTime || !name || !phone) {
    return res.status(400).json({ error: "Bitte alle Pflichtfelder ausfüllen." });
  }
  if (String(name).trim().length < 2) {
    return res.status(400).json({ error: "Bitte einen gültigen Namen angeben." });
  }
  if (String(phone).trim().length < 5) {
    return res.status(400).json({ error: "Bitte eine gültige Telefonnummer angeben." });
  }

  const service = db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(serviceId);
  if (!service) return res.status(404).json({ error: "Dienstleistung nicht gefunden." });

  if (!isSlotStillFree(date, serviceId, startTime)) {
    return res.status(409).json({ error: "Dieser Termin ist leider gerade nicht mehr verfügbar. Bitte einen anderen wählen." });
  }

  const endTime = minutesToTime(timeToMinutes(startTime) + service.duration_minutes);

  const result = db
    .prepare(
      `INSERT INTO bookings (service_id, customer_name, customer_phone, customer_email, note, date, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(serviceId, String(name).trim(), String(phone).trim(), email ? String(email).trim() : null, note ? String(note).trim() : null, date, startTime, endTime);

  const booking = {
    id: result.lastInsertRowid,
    service: service.name,
    customer_name: String(name).trim(),
    customer_phone: String(phone).trim(),
    customer_email: email ? String(email).trim() : null,
    date,
    startTime,
    endTime,
  };

  res.status(201).json(booking);

  // Läuft nach der Antwort — ein langsamer/fehlender Mailserver darf die Buchung selbst nie verzögern oder blockieren.
  mailer.sendBookingConfirmation(booking).catch((err) => console.error("Bestätigungs-E-Mail fehlgeschlagen:", err.message));
  mailer.sendAdminNewBookingNotice(booking).catch((err) => console.error("Admin-Benachrichtigung fehlgeschlagen:", err.message));
});

module.exports = router;
