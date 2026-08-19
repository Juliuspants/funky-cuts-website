const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAdmin, issueToken, clearToken } = require("../middleware/auth");

const router = express.Router();

// --- Auth ---------------------------------------------------------------

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Benutzername und Passwort erforderlich." });
  }

  const admin = db.prepare("SELECT * FROM admin WHERE id = 1").get();
  if (!admin) {
    return res.status(500).json({
      error:
        "Es ist noch kein Admin-Zugang eingerichtet. Auf dem Server ausführen: npm run set-admin-password -- <benutzername> <passwort>",
    });
  }

  const ok = admin.username === username && bcrypt.compareSync(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: "Benutzername oder Passwort falsch." });

  issueToken(res, { username: admin.username });
  res.json({ ok: true, username: admin.username });
});

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

router.get("/bookings", (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    rows = db
      .prepare(
        `SELECT b.*, s.name AS service_name FROM bookings b
         JOIN services s ON s.id = b.service_id
         WHERE b.date BETWEEN ? AND ? AND b.status = 'confirmed'
         ORDER BY b.date, b.start_time`
      )
      .all(from, to);
  } else {
    rows = db
      .prepare(
        `SELECT b.*, s.name AS service_name FROM bookings b
         JOIN services s ON s.id = b.service_id
         WHERE b.status = 'confirmed' AND b.date >= date('now')
         ORDER BY b.date, b.start_time`
      )
      .all();
  }
  res.json(rows);
});

router.delete("/bookings/:id", (req, res) => {
  const info = db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Termin nicht gefunden." });
  res.json({ ok: true });
});

// --- Öffnungszeiten ---------------------------------------------------------

router.get("/working-hours", (req, res) => {
  const rows = db.prepare("SELECT * FROM working_hours ORDER BY weekday").all();
  res.json(rows);
});

router.put("/working-hours", (req, res) => {
  const days = req.body?.days;
  if (!Array.isArray(days)) return res.status(400).json({ error: "Ungültige Daten." });

  const stmt = db.prepare(
    "UPDATE working_hours SET closed = ?, start_time = ?, end_time = ? WHERE weekday = ?"
  );
  const tx = db.transaction((rows) => {
    for (const d of rows) {
      stmt.run(d.closed ? 1 : 0, d.start_time, d.end_time, d.weekday);
    }
  });
  tx(days);
  res.json({ ok: true });
});

// --- Blockierte Zeiten (Urlaub, Pause, Feiertag) ---------------------------

router.get("/blocked-slots", (req, res) => {
  const rows = db.prepare("SELECT * FROM blocked_slots WHERE date >= date('now') ORDER BY date").all();
  res.json(rows);
});

router.post("/blocked-slots", (req, res) => {
  const { date, wholeDay, startTime, endTime, reason } = req.body || {};
  if (!date) return res.status(400).json({ error: "Datum erforderlich." });
  const info = db
    .prepare(
      "INSERT INTO blocked_slots (date, whole_day, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?)"
    )
    .run(date, wholeDay ? 1 : 0, wholeDay ? null : startTime, wholeDay ? null : endTime, reason || null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete("/blocked-slots/:id", (req, res) => {
  const info = db.prepare("DELETE FROM blocked_slots WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Eintrag nicht gefunden." });
  res.json({ ok: true });
});

// --- Dienstleistungen -------------------------------------------------------

router.get("/services", (req, res) => {
  const rows = db.prepare("SELECT * FROM services ORDER BY sort_order, id").all();
  res.json(rows);
});

router.post("/services", (req, res) => {
  const { name, durationMinutes, priceCents } = req.body || {};
  if (!name || !durationMinutes) return res.status(400).json({ error: "Name und Dauer erforderlich." });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM services").get().m;
  const info = db
    .prepare("INSERT INTO services (name, duration_minutes, price_cents, active, sort_order) VALUES (?, ?, ?, 1, ?)")
    .run(name, durationMinutes, priceCents ?? null, maxOrder + 1);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put("/services/:id", (req, res) => {
  const { name, durationMinutes, priceCents, active } = req.body || {};
  const existing = db.prepare("SELECT * FROM services WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Dienstleistung nicht gefunden." });
  db.prepare(
    "UPDATE services SET name = ?, duration_minutes = ?, price_cents = ?, active = ? WHERE id = ?"
  ).run(
    name ?? existing.name,
    durationMinutes ?? existing.duration_minutes,
    priceCents !== undefined ? priceCents : existing.price_cents,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete("/services/:id", (req, res) => {
  db.prepare("UPDATE services SET active = 0 WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
