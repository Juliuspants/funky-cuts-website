process.env.TZ = process.env.TZ || "Europe/Berlin";

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
require("dotenv").config();

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET fehlt. Bitte .env anlegen (siehe .env.example).");
  process.exit(1);
}

const publicRoutes = require("./routes/public");
const adminRoutes = require("./routes/admin");

const app = express();

app.use(express.json());
app.use(cookieParser());

app.get("/api/config", (req, res) => {
  res.json({ salonName: process.env.SALON_NAME || "Friseursalon" });
});

app.use("/api", publicRoutes);
app.use("/api/admin", adminRoutes);

app.use(express.static(path.join(__dirname, "public")));

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "index.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Funky Cuts läuft auf http://localhost:${PORT}`);
});
