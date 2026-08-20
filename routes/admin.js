const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { requireAdmin, issueToken, clearToken } = require("../middleware/auth");
const mailer = require("../lib/mailer");
const { timeToMinutes } = require("../lib/availability");
const asyncHandler = require("../lib/asyncHandler");

const router = express.Router();

// --- Auth ---------------------------------------------------------------

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Benutzername und Passwort erforderlich." });
    }

    const { rows } = await pool.query("SELECT * FROM admin WHERE id = 1");
    const admin = rows[0];
    if (!admin) {
      return res.status(500).json({
        error:
          "Es ist noch kein Admin-Zugang eingerichtet. Lokal ausführen: npm run set-admin-password -- <benutzername> <passwort>",
      });
    }

    const ok = admin.username === username && bcrypt.compareSync(password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: "Benutzername oder Passwort falsch." });

    issueToken(res, { username: admin.username });
    res.json({ ok: true, username: admin.username });
  })
);

router.post("/logout", (req, res) => {
  clearToken(res);
  res.json({ ok: true });
});

router.get("/me", requireAdmin, (req, res) => {
  res.json({ username: req.admin.username });
});

// Ab hier: alles erfordert Login
router.use(requireAdmin);

// --- Buchungen ------------------------------------------------------------

router.get(
  "/bookings",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    let rows;
    if (from && to) {
      ({ rows } = await pool.query(
        `SELECT b.*, s.name AS service_name FROM bookings b
         JOIN services s ON s.id = b.service_id
         WHERE b.date BETWEEN $1 AND $2 AND b.status = 'confirmed'
         ORDER BY b.date, b.start_time`,
        [from, to]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT b.*, s.name AS service_name FROM bookings b
         JOIN services s ON s.id = b.service_id
         WHERE b.status = 'confirmed' AND b.date >= to_char(CURRENT_DATE, 'YYYY-MM-DD')
         ORDER BY b.date, b.start_time`
      ));
    }
    res.json(rows);
  })
);

router.delete(
  "/bookings/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT b.*, s.name AS service_name FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    const booking = rows[0];
    if (!booking) return res.status(404).json({ error: "Termin nicht gefunden." });

    await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [req.params.id]);

    // Wird vor der Antwort abgewartet (siehe Kommentar bei POST /bookings) —
    // ein Mail-Fehler lässt die Stornierung selbst trotzdem nie fehlschlagen.
    await mailer.sendCancellationEmail(booking).catch((err) => {
      console.error("Storno-E-Mail konnte nicht gesendet werden:", err.message);
    });

    res.json({ ok: true });
  })
);

// --- Terminplanungs-Einstellungen (Zeitraster, Pufferzeit) ------------------

router.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM settings WHERE id = 1");
    res.json(rows[0]);
  })
);

router.put(
  "/settings",
  asyncHandler(async (req, res) => {
    const { slotIntervalMinutes, bufferMinutes } = req.body || {};
    const interval = Number(slotIntervalMinutes);
    const buffer = Number(bufferMinutes);
    if (!Number.isInteger(interval) || interval < 5 || interval > 240) {
      return res.status(400).json({ error: "Zeitraster muss zwischen 5 und 240 Minuten liegen." });
    }
    if (!Number.isInteger(buffer) || buffer < 0 || buffer > 120) {
      return res.status(400).json({ error: "Pufferzeit muss zwischen 0 und 120 Minuten liegen." });
    }
    await pool.query(
      "UPDATE settings SET slot_interval_minutes = $1, buffer_minutes = $2 WHERE id = 1",
      [interval, buffer]
    );
    res.json({ ok: true });
  })
);

// --- Öffnungszeiten ---------------------------------------------------------

router.get(
  "/working-hours",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM working_hours ORDER BY weekday");
    res.json(rows);
  })
);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

router.put(
  "/working-hours",
  asyncHandler(async (req, res) => {
    const days = req.body?.days;
    if (!Array.isArray(days) || days.length === 0) {
      return res.status(400).json({ error: "Ungültige Daten." });
    }
    for (const d of days) {
      if (!Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6) {
        return res.status(400).json({ error: "Ungültiger Wochentag." });
      }
      if (!TIME_RE.test(d.start_time) || !TIME_RE.test(d.end_time)) {
        return res.status(400).json({ error: "Uhrzeiten müssen im Format HH:MM vorliegen." });
      }
      if (timeToMinutes(d.start_time) >= timeToMinutes(d.end_time)) {
        return res.status(400).json({ error: "Die Startzeit muss vor der Endzeit liegen." });
      }
    }

    for (const d of days) {
      await pool.query(
        "UPDATE working_hours SET closed = $1, start_time = $2, end_time = $3 WHERE weekday = $4",
        [d.closed ? 1 : 0, d.start_time, d.end_time, d.weekday]
      );
    }
    res.json({ ok: true });
  })
);

// --- Blockierte Zeiten (Urlaub, Pause, Feiertag) ---------------------------

router.get(
  "/blocked-slots",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM blocked_slots WHERE date >= to_char(CURRENT_DATE, 'YYYY-MM-DD') ORDER BY date"
    );
    res.json(rows);
  })
);

router.post(
  "/blocked-slots",
  asyncHandler(async (req, res) => {
    const { date, wholeDay, startTime, endTime, reason } = req.body || {};
    if (!date) return res.status(400).json({ error: "Datum erforderlich." });
    const { rows } = await pool.query(
      "INSERT INTO blocked_slots (date, whole_day, start_time, end_time, reason) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [date, wholeDay ? 1 : 0, wholeDay ? null : startTime, wholeDay ? null : endTime, reason || null]
    );
    res.status(201).json({ id: rows[0].id });
  })
);

router.delete(
  "/blocked-slots/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM blocked_slots WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Eintrag nicht gefunden." });
    res.json({ ok: true });
  })
);

// --- Dienstleistungen -------------------------------------------------------

router.get(
  "/services",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM services ORDER BY sort_order, id");
    res.json(rows);
  })
);

router.post(
  "/services",
  asyncHandler(async (req, res) => {
    const { name, durationMinutes, priceCents } = req.body || {};
    if (!name || !durationMinutes) return res.status(400).json({ error: "Name und Dauer erforderlich." });
    const { rows: maxRows } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) AS m FROM services");
    const { rows } = await pool.query(
      "INSERT INTO services (name, duration_minutes, price_cents, active, sort_order) VALUES ($1, $2, $3, 1, $4) RETURNING id",
      [name, durationMinutes, priceCents ?? null, maxRows[0].m + 1]
    );
    res.status(201).json({ id: rows[0].id });
  })
);

router.put(
  "/services/:id",
  asyncHandler(async (req, res) => {
    const { name, durationMinutes, priceCents, active } = req.body || {};
    const { rows } = await pool.query("SELECT * FROM services WHERE id = $1", [req.params.id]);
    const existing = rows[0];
    if (!existing) return res.status(404).json({ error: "Dienstleistung nicht gefunden." });
    await pool.query(
      "UPDATE services SET name = $1, duration_minutes = $2, price_cents = $3, active = $4 WHERE id = $5",
      [
        name ?? existing.name,
        durationMinutes ?? existing.duration_minutes,
        priceCents !== undefined ? priceCents : existing.price_cents,
        active !== undefined ? (active ? 1 : 0) : existing.active,
        req.params.id,
      ]
    );
    res.json({ ok: true });
  })
);

router.delete(
  "/services/:id",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT id FROM services WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Dienstleistung nicht gefunden." });

    const { rows: bookingRows } = await pool.query(
      "SELECT COUNT(*)::int AS c FROM bookings WHERE service_id = $1",
      [req.params.id]
    );
    if (bookingRows[0].c > 0) {
      return res.status(409).json({
        error:
          "Diese Leistung hat bereits Termine (auch vergangene/stornierte) und kann deshalb nicht endgültig gelöscht werden — bitte stattdessen deaktivieren.",
      });
    }

    await pool.query("DELETE FROM services WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  })
);

// --- Startseiten-Inhalte (Texte) --------------------------------------------

const CONTENT_KEYS = {
  heroTitle: "hero_title",
  heroText: "hero_text",
  aboutText: "about_text",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
};

router.get(
  "/content",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query("SELECT key, value FROM site_content");
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const out = {};
    for (const [camel, dbKey] of Object.entries(CONTENT_KEYS)) out[camel] = byKey[dbKey] || "";
    res.json(out);
  })
);

router.put(
  "/content",
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    for (const [camel, dbKey] of Object.entries(CONTENT_KEYS)) {
      if (body[camel] === undefined) continue;
      await pool.query(
        `INSERT INTO site_content (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [dbKey, String(body[camel])]
      );
    }
    res.json({ ok: true });
  })
);

// --- Galerie -----------------------------------------------------------------

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const DATA_URL_RE = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

router.get(
  "/gallery",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, mime_type, data_base64, sort_order FROM gallery_images ORDER BY sort_order, id"
    );
    res.json(rows.map((r) => ({ id: r.id, url: `data:${r.mime_type};base64,${r.data_base64}` })));
  })
);

router.post(
  "/gallery",
  asyncHandler(async (req, res) => {
    const { image } = req.body || {};
    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "Kein Bild übermittelt." });
    }
    const match = image.match(DATA_URL_RE);
    if (!match) return res.status(400).json({ error: "Ungültiges Bildformat." });
    const [, mimeType, base64] = match;
    if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
      return res.status(400).json({ error: "Nur JPEG, PNG oder WebP erlaubt." });
    }
    if (base64.length > 4_500_000) {
      return res.status(413).json({ error: "Bild ist zu groß. Bitte ein kleineres Bild wählen." });
    }
    const { rows: maxRows } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) AS m FROM gallery_images");
    const { rows } = await pool.query(
      "INSERT INTO gallery_images (mime_type, data_base64, sort_order) VALUES ($1, $2, $3) RETURNING id",
      [mimeType, base64, maxRows[0].m + 1]
    );
    res.status(201).json({ id: rows[0].id });
  })
);

router.put(
  "/gallery/:id/move",
  asyncHandler(async (req, res) => {
    const { direction } = req.body || {};
    if (direction !== "left" && direction !== "right") {
      return res.status(400).json({ error: "Ungültige Richtung." });
    }
    const { rows } = await pool.query("SELECT id, sort_order FROM gallery_images ORDER BY sort_order, id");
    const idx = rows.findIndex((r) => String(r.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: "Bild nicht gefunden." });
    const swapIdx = direction === "left" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) return res.json({ ok: true });
    const a = rows[idx];
    const b = rows[swapIdx];
    await pool.query("UPDATE gallery_images SET sort_order = $1 WHERE id = $2", [b.sort_order, a.id]);
    await pool.query("UPDATE gallery_images SET sort_order = $1 WHERE id = $2", [a.sort_order, b.id]);
    res.json({ ok: true });
  })
);

router.delete(
  "/gallery/:id",
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM gallery_images WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Bild nicht gefunden." });
    res.json({ ok: true });
  })
);

module.exports = router;
