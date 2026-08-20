// Legt den Admin-Zugang an oder ändert das Passwort.
// Benutzung: npm run set-admin-password -- <benutzername> <passwort>
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { pool, ensureSchema } = require("../db");

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error("Benutzung: npm run set-admin-password -- <benutzername> <passwort>");
  process.exit(1);
}

if (password.length < 6) {
  console.error("Das Passwort sollte mindestens 6 Zeichen haben.");
  process.exit(1);
}

(async () => {
  try {
    await ensureSchema();
    const hash = bcrypt.hashSync(password, 12);
    await pool.query(
      `INSERT INTO admin (id, username, password_hash) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash`,
      [username, hash]
    );
    console.log(`Admin-Zugang gespeichert. Benutzername: "${username}"`);
    console.log("Du kannst dich jetzt unter /admin anmelden.");
  } catch (err) {
    console.error("Fehler beim Speichern des Admin-Zugangs:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
