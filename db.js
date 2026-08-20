const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL fehlt. In der .env die Supabase-Verbindungs-URL eintragen (siehe .env.example)."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase verlangt SSL; das System-Zertifikat wird hier nicht geprüft,
  // weil Supabase-Pooler-Endpunkte ein Zertifikat verwenden, das node-postgres
  // ohne zusätzliche CA-Konfiguration sonst ablehnt.
  ssl: { rejectUnauthorized: false },
});

let schemaReady = null;

/** Legt alle Tabellen an (falls nicht vorhanden) und füllt Standarddaten ein.
 *  Wird bei jedem Kaltstart einmal aufgerufen — idempotent, kann gefahrlos
 *  mehrfach laufen. */
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = runMigrations().catch((err) => {
      schemaReady = null; // beim nächsten Aufruf erneut versuchen
      throw err;
    });
  }
  return schemaReady;
}

async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      whole_day INTEGER NOT NULL DEFAULT 1,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES services(id),
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      note TEXT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
    CREATE INDEX IF NOT EXISTS idx_blocked_date ON blocked_slots(date);

    -- Globale Terminplanungs-Einstellungen (eine Zeile)
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
      buffer_minutes INTEGER NOT NULL DEFAULT 5
    );

    -- Bearbeitbare Texte der Startseite (Key-Value)
    CREATE TABLE IF NOT EXISTS site_content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    -- Galerie-Bilder für die Startseite (als Base64 in der DB abgelegt,
    -- da Netlify Functions kein persistentes Dateisystem haben)
    CREATE TABLE IF NOT EXISTS gallery_images (
      id SERIAL PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Standard-Öffnungszeiten anlegen, falls noch keine existieren (Mo-Fr 9-18, Sa 9-14, So zu)
  const { rows: whRows } = await pool.query("SELECT COUNT(*)::int AS c FROM working_hours");
  if (whRows[0].c === 0) {
    const defaults = [
      [0, 1, "09:00", "18:00"], // Sonntag zu
      [1, 0, "09:00", "18:00"],
      [2, 0, "09:00", "18:00"],
      [3, 0, "09:00", "18:00"],
      [4, 0, "09:00", "18:00"],
      [5, 0, "09:00", "18:00"],
      [6, 0, "09:00", "14:00"],
    ];
    for (const [weekday, closed, start, end] of defaults) {
      await pool.query(
        "INSERT INTO working_hours (weekday, closed, start_time, end_time) VALUES ($1, $2, $3, $4)",
        [weekday, closed, start, end]
      );
    }
  }

  // Beispiel-Dienstleistungen anlegen, falls noch keine existieren
  const { rows: svcRows } = await pool.query("SELECT COUNT(*)::int AS c FROM services");
  if (svcRows[0].c === 0) {
    const defaults = [
      ["Herrenhaarschnitt", 30, 2500, 0],
      ["Waschen, Schneiden, Föhnen", 45, 3500, 1],
      ["Bart trimmen", 15, 1200, 2],
      ["Komplettpaket (Haare + Bart)", 60, 4200, 3],
    ];
    for (const [name, duration, price, order] of defaults) {
      await pool.query(
        "INSERT INTO services (name, duration_minutes, price_cents, active, sort_order) VALUES ($1, $2, $3, 1, $4)",
        [name, duration, price, order]
      );
    }
  }

  // Terminplanungs-Einstellungen mit Standardwerten anlegen, falls noch keine existieren
  const { rows: settingsRows } = await pool.query("SELECT COUNT(*)::int AS c FROM settings");
  if (settingsRows[0].c === 0) {
    await pool.query(
      "INSERT INTO settings (id, slot_interval_minutes, buffer_minutes) VALUES (1, 30, 5)"
    );
  }

  // Standard-Platzhaltertexte für die Startseite anlegen, falls noch keine existieren
  const { rows: contentRows } = await pool.query("SELECT COUNT(*)::int AS c FROM site_content");
  if (contentRows[0].c === 0) {
    const defaults = [
      ["hero_title", "Frischer Schnitt,\ngute Laune."],
      [
        "hero_text",
        "Funky Cuts ist dein Barbershop für Haarschnitt, Bart und alles dazwischen. Entspannte Atmosphäre, ehrliche Beratung, sauberes Handwerk.",
      ],
      [
        "about_text",
        "[Platzhalter: kurzer Text über Funky Cuts — wer steckt dahinter, seit wann gibt's den Laden, was macht euch besonders?]",
      ],
      ["address_line1", "[Platzhalter-Straße 1]"],
      ["address_line2", "[PLZ] [Ort]"],
    ];
    for (const [key, value] of defaults) {
      await pool.query("INSERT INTO site_content (key, value) VALUES ($1, $2)", [key, value]);
    }
  }
}

module.exports = { pool, ensureSchema };
