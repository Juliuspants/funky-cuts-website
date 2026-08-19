const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "booking.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// node:sqlite (DatabaseSync) hat kein eingebautes db.transaction() wie better-sqlite3 —
// einfacher Ersatz dafür, mit gleichem Aufruf-Muster: transaction(fn)(rows)
function transaction(fn) {
  return (rows) => {
    db.exec("BEGIN");
    try {
      fn(rows);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };
}
db.transaction = transaction;

db.exec(`
  CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price_cents INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  -- Eine Zeile pro Wochentag (0=Sonntag ... 6=Samstag)
  CREATE TABLE IF NOT EXISTS working_hours (
    weekday INTEGER PRIMARY KEY,
    closed INTEGER NOT NULL DEFAULT 0,
    start_time TEXT NOT NULL DEFAULT '09:00',
    end_time TEXT NOT NULL DEFAULT '18:00'
  );

  -- Einzelne blockierte Zeiträume (Urlaub, Pause, Feiertag...)
  CREATE TABLE IF NOT EXISTS blocked_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    whole_day INTEGER NOT NULL DEFAULT 1,
    reason TEXT
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL REFERENCES services(id),
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    note TEXT,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
  CREATE INDEX IF NOT EXISTS idx_blocked_date ON blocked_slots(date);

  -- Globale Terminplanungs-Einstellungen (eine Zeile)
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
    buffer_minutes INTEGER NOT NULL DEFAULT 5
  );
`);

const settingsCount = db.prepare("SELECT COUNT(*) AS c FROM settings").get().c;
if (settingsCount === 0) {
  db.prepare(
    "INSERT INTO settings (id, slot_interval_minutes, buffer_minutes) VALUES (1, 30, 5)"
  ).run();
}

// Standard-Öffnungszeiten anlegen, falls noch keine existieren (Mo-Fr 9-18, Sa 9-14, So zu)
const whCount = db.prepare("SELECT COUNT(*) AS c FROM working_hours").get().c;
if (whCount === 0) {
  const insert = db.prepare(
    "INSERT INTO working_hours (weekday, closed, start_time, end_time) VALUES (?, ?, ?, ?)"
  );
  const defaults = [
    [0, 1, "09:00", "18:00"], // Sonntag zu
    [1, 0, "09:00", "18:00"],
    [2, 0, "09:00", "18:00"],
    [3, 0, "09:00", "18:00"],
    [4, 0, "09:00", "18:00"],
    [5, 0, "09:00", "18:00"],
    [6, 0, "09:00", "14:00"],
  ];
  const tx = db.transaction((rows) => rows.forEach((r) => insert.run(...r)));
  tx(defaults);
}

// Beispiel-Dienstleistungen anlegen, falls noch keine existieren
const svcCount = db.prepare("SELECT COUNT(*) AS c FROM services").get().c;
if (svcCount === 0) {
  const insert = db.prepare(
    "INSERT INTO services (name, duration_minutes, price_cents, active, sort_order) VALUES (?, ?, ?, 1, ?)"
  );
  const defaults = [
    ["Herrenhaarschnitt", 30, 2500, 0],
    ["Waschen, Schneiden, Föhnen", 45, 3500, 1],
    ["Bart trimmen", 15, 1200, 2],
    ["Komplettpaket (Haare + Bart)", 60, 4200, 3],
  ];
  const tx = db.transaction((rows) => rows.forEach((r) => insert.run(...r)));
  tx(defaults);
}

module.exports = db;
