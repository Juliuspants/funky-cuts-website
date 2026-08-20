const { pool } = require("../db");

async function getSchedulingSettings() {
  const { rows } = await pool.query(
    "SELECT slot_interval_minutes, buffer_minutes FROM settings WHERE id = 1"
  );
  // Fallback, falls die Tabelle aus irgendeinem Grund leer sein sollte
  return rows[0] || { slot_interval_minutes: 30, buffer_minutes: 5 };
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function todayStr() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
}

function isPastDate(dateStr) {
  return dateStr < todayStr();
}

/**
 * Liefert freie Startzeiten (["HH:MM", ...]) für einen Tag und eine Dienstleistung.
 */
async function getAvailableSlots(dateStr, serviceId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return [];
  if (isPastDate(dateStr)) return [];

  const { rows: svcRows } = await pool.query(
    "SELECT * FROM services WHERE id = $1 AND active = 1",
    [serviceId]
  );
  const service = svcRows[0];
  if (!service) return [];

  const weekday = weekdayOf(dateStr);
  const { rows: hoursRows } = await pool.query(
    "SELECT * FROM working_hours WHERE weekday = $1",
    [weekday]
  );
  const hours = hoursRows[0];
  if (!hours || hours.closed) return [];

  const { rows: dayBlocks } = await pool.query(
    "SELECT * FROM blocked_slots WHERE date = $1",
    [dateStr]
  );
  if (dayBlocks.some((b) => b.whole_day)) return [];

  const { rows: existingBookings } = await pool.query(
    "SELECT start_time, end_time FROM bookings WHERE date = $1 AND status = 'confirmed'",
    [dateStr]
  );

  const { slot_interval_minutes: slotInterval, buffer_minutes: buffer } = await getSchedulingSettings();

  const dayStart = timeToMinutes(hours.start_time);
  const dayEnd = timeToMinutes(hours.end_time);
  const duration = service.duration_minutes;

  const busyRanges = [
    // Pufferzeit (Aufräumen/Vorbereitung) wird nach jedem bestehenden Termin dazugerechnet,
    // damit der nächste Termin nicht direkt nahtlos anschließt.
    ...existingBookings.map((b) => [timeToMinutes(b.start_time), timeToMinutes(b.end_time) + buffer]),
    ...dayBlocks
      .filter((b) => !b.whole_day && b.start_time && b.end_time)
      .map((b) => [timeToMinutes(b.start_time), timeToMinutes(b.end_time)]),
  ];

  const nowMinutes = (() => {
    const now = new Date();
    if (dateStr !== todayStr()) return null;
    return now.getHours() * 60 + now.getMinutes();
  })();

  const slots = [];
  for (let start = dayStart; start + duration <= dayEnd; start += slotInterval) {
    const end = start + duration;
    if (nowMinutes !== null && start <= nowMinutes) continue; // vergangene Zeiten heute überspringen
    const overlaps = busyRanges.some(([bs, be]) => start < be && end > bs);
    if (!overlaps) slots.push(minutesToTime(start));
  }
  return slots;
}

/** Prüft, ob ein konkreter Slot (noch) frei ist, bevor eine Buchung final gespeichert wird. */
async function isSlotStillFree(dateStr, serviceId, startTime) {
  const slots = await getAvailableSlots(dateStr, serviceId);
  return slots.includes(startTime);
}

module.exports = {
  getAvailableSlots,
  isSlotStillFree,
  timeToMinutes,
  minutesToTime,
  weekdayOf,
  getSchedulingSettings,
};
