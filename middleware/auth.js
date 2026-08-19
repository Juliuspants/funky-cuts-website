const jwt = require("jsonwebtoken");

const COOKIE_NAME = "admin_session";

function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Nicht angemeldet." });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Sitzung abgelaufen. Bitte erneut anmelden." });
  }
}

function issueToken(res, payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "12h" });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function clearToken(res) {
  res.clearCookie(COOKIE_NAME);
}

module.exports = { requireAdmin, issueToken, clearToken, COOKIE_NAME };
