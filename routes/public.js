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
  "/content",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT key, value FROM site_content");
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({
      heroTitle: byKey.hero_title || "",
      heroText: byKey.hero_text || "",
      aboutText: byKey.about_text || "",
      addressLine1: byKey.address_line1 || "",
      addressLine2: byKey.address_line2 || "",
    });
  })
);

router.get(
  "/gallery",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, mime_type, data_base64 FROM gallery_images ORDER BY sort_order, id"
    );
    res.json(rows.map((r) => ({ id: r.id, url: `data:${r.mime_type};base64,${r.data_base64}` })));
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

    // Adresse für den Kalender-Eintrag (LOCATION) in der Bestätigungsmail —
    // wird nur für den Mailversand gebraucht, nicht in der API-Antwort.
    let location = "";
    try {
      const { rows: addrRows } = await pool.query(
        "SELECT key, value FROM site_content WHERE key IN ('address_line1', 'address_line2')"
      );
      const byKey = Object.fromEntries(addrRows.map((r) => [r.key, r.value]));
      location = [byKey.address_line1, byKey.address_line2].filter(Boolean).join(", ");
    } catch (_) {
      // Adresse ist rein kosmetisch für den Kalendereintrag — bei Problemen einfach weglassen.
    }

    // Wird vor der Antwort abgewartet (nicht "fire and forget") — in einer
    // Serverless-Function kann die Ausführungsumgebung direkt nach der
    // Antwort eingefroren werden, ein danach laufender Mail-Versand hätte
    // dann keine Garantie mehr, überhaupt fertig zu laufen. Ein Mail-Fehler
    // lässt die Buchung selbst trotzdem nie fehlschlagen.
    await Promise.all([
      mailer.sendBookingConfirmation({ ...booking, location }).catch((err) => console.error("Bestätigungs-E-Mail fehlgeschlagen:", err.message)),
      mailer.sendAdminNewBookingNotice(booking).catch((err) => console.error("Admin-Benachrichtigung fehlgeschlagen:", err.message)),
    ]);

    res.status(201).json(booking);
  })
);

module.exports = router;
