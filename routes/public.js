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
    // Die Adresse steht bewusst NICHT hier drin — sie soll nicht öffentlich
    // auf der Website erscheinen, sondern nur in der Bestätigungsmail (siehe
    // POST /bookings unten, das sie direkt aus der DB lädt).
    const { rows } = await pool.query(
      "SELECT key, value FROM site_content WHERE key IN ('hero_title', 'hero_text', 'about_text')"
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json({
      heroTitle: byKey.hero_title || "",
      heroText: byKey.hero_text || "",
      aboutText: byKey.about_text || "",
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

    // Die Adresse steht bewusst nicht auf der Website, sondern nur in der
    // Bestätigungsmail (Kalender-Eintrag + Textzeile) — wird nur für den
    // Mailversand gebraucht, nicht in der API-Antwort.
    let location = "";
    try {
      const { rows: addrRows } = await pool.query(
        "SELECT key, value FROM site_content WHERE key IN ('address_line1', 'address_line2')"
      );
      const byKey = Object.fromEntries(addrRows.map((r) => [r.key, r.value]));
      location = [byKey.address_line1, byKey.address_line2].filter(Boolean).join(", ");
    } catch (_) {
      // Adresse ist rein kosmetisch für die Mail — bei Problemen einfach weglassen.
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

// Warteliste: Kund*innen können sich für einen ausgebuchten Tag eintragen
// und werden benachrichtigt, sobald durch eine Stornierung ein Platz frei wird.
router.post(
  "/waitlist",
  asyncHandler(async (req, res) => {
    const { serviceId, date, name, phone, email, note } = req.body || {};

    if (!date || !name || !phone) {
      return res.status(400).json({ error: "Bitte Datum, Name und Telefonnummer angeben." });
    }
    if (String(name).trim().length < 2) {
      return res.status(400).json({ error: "Bitte einen gültigen Namen angeben." });
    }
    if (String(phone).trim().length < 5) {
      return res.status(400).json({ error: "Bitte eine gültige Telefonnummer angeben." });
    }

    let serviceName = null;
    if (serviceId) {
      const { rows } = await pool.query("SELECT name FROM services WHERE id = $1", [serviceId]);
      serviceName = rows[0]?.name || null;
    }

    const { rows: insertRows } = await pool.query(
      `INSERT INTO waitlist (service_id, date, customer_name, customer_phone, customer_email, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        serviceId || null,
        date,
        String(name).trim(),
        String(phone).trim(),
        email ? String(email).trim() : null,
        note ? String(note).trim() : null,
      ]
    );

    const entry = {
      id: insertRows[0].id,
      date,
      serviceName,
      customer_name: String(name).trim(),
      customer_phone: String(phone).trim(),
      customer_email: email ? String(email).trim() : null,
    };

    await Promise.all([
      mailer.sendWaitlistJoined(entry).catch((err) => console.error("Warteliste-Bestätigung fehlgeschlagen:", err.message)),
      mailer.sendAdminWaitlistNotice(entry).catch((err) => console.error("Admin-Warteliste-Benachrichtigung fehlgeschlagen:", err.message)),
    ]);

    res.status(201).json({ id: entry.id });
  })
);

// Erkennt wiederkehrende Kund*innen anhand der Telefonnummer und schlägt die
// zuletzt gebuchte Leistung vor ("wie letztes Mal?"). Gibt bewusst nur den
// Namen der Leistung zurück, keine weiteren Kundendaten.
router.get(
  "/customer-lookup",
  asyncHandler(async (req, res) => {
    const phone = String(req.query.phone || "").trim();
    const normalized = phone.replace(/\D/g, "");
    if (normalized.length < 5) return res.json({ found: false });

    const { rows } = await pool.query(
      `SELECT s.id AS service_id, s.name AS service_name
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE regexp_replace(b.customer_phone, '\\D', '', 'g') = $1
       ORDER BY b.created_at DESC
       LIMIT 1`,
      [normalized]
    );

    if (!rows[0]) return res.json({ found: false });
    res.json({ found: true, serviceId: rows[0].service_id, serviceName: rows[0].service_name });
  })
);

module.exports = router;
