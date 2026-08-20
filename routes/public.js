const express = require("express");
const { pool } = require("../db");
const { getAvailableSlots, isSlotStillFree, timeToMinutes, minutesToTime } = require("../lib/availability");
const mailer = require("../lib/mailer");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

router.get(
  "/services",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, name, duration_minutes, price_cents FROM services WHERE active = 1 ORDER BY sort_order, id"
    );
    res.json(rows);
  })
);

router.get(
  "/working-hours",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT weekday, closed FROM working_hours ORDER BY weekday");
    res.json(rows);
  })
);

router.get(
  "/availability",
  asyncHandler(async (req, res) => {
    const { date, serviceId } = req.query;
    if (!date || !serviceId) {
      return res.status(400).json({ error: "date und serviceId werden benötigt." });
    }
    const slots = await getAvailableSlots(date, Number(serviceId));
    res.json({ date, serviceId: Number(serviceId), slots });
  })
);

router.post(
  "/bookings",
  asyncHandler(async (req, res) => {
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

    const { rows: svcRows } = await pool.query(
      "SELECT * FROM services WHERE id = $1 AND active = 1",
      [serviceId]
    );
    const service = svcRows[0];
    if (!service) return res.status(404).json({ error: "Dienstleistung nicht gefunden." });

    if (!(await isSlotStillFree(date, serviceId, startTime))) {
      return res
        .status(409)
        .json({ error: "Dieser Termin ist leider gerade nicht mehr verfügbar. Bitte einen anderen wählen." });
    }

    const endTime = minutesToTime(timeToMinutes(startTime) + service.duration_minutes);

    const { rows: insertRows } = await pool.query(
      `INSERT INTO bookings (service_id, customer_name, customer_phone, customer_email, note, date, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        serviceId,
        String(name).trim(),
        String(phone).trim(),
        email ? String(email).trim() : null,
        note ? String(note).trim() : null,
        date,
        startTime,
        endTime,
      ]
    );

    const booking = {
      id: insertRows[0].id,
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
  })
);

module.exports = router;
