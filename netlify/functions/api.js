process.env.TZ = process.env.TZ || "Europe/Berlin";

const express = require("express");
const cookieParser = require("cookie-parser");
const serverless = require("serverless-http");
require("dotenv").config();

const { ensureSchema } = require("../../db");
const publicRoutes = require("../../routes/public");
const adminRoutes = require("../../routes/admin");

const app = express();
app.use(express.json());
app.use(cookieParser());

app.get("/config", (req, res) => {
  res.json({
    salonName: process.env.SALON_NAME || "Friseursalon",
    contactEmail: process.env.CONTACT_EMAIL || null,
  });
});

// Kein "/api"-Präfix hier — das übernimmt der Netlify-Redirect (siehe netlify.toml),
// der /api/* auf diese Function umleitet und dabei den Präfix abschneidet.
app.use("/", publicRoutes);
app.use("/admin", adminRoutes);

app.use((err, req, res, next) => {
  console.error("Unerwarteter Fehler:", err);
  res.status(500).json({ error: "Interner Serverfehler." });
});

const serverlessHandler = serverless(app);

// Tabellen/Standarddaten nur beim ersten Kaltstart einer Function-Instanz anlegen,
// nicht bei jedem Aufruf.
let ready = null;

module.exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  if (!ready) ready = ensureSchema();
  await ready;
  return serverlessHandler(event, context);
};
