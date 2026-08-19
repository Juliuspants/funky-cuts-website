const db = require("../db");

const SLOT_STEP_MINUTES = 15; // Raster, in dem Startzeiten angeboten werden

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

function isPastDate(dateStr) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
  return dateStr < todayStr;
}

/**
 * Liefert freie Startzeiten (["HH:MM", ...]) für einen Tag und eine Dienstleistung.
 */
function getAvailableSlots(dateStr, serviceId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return [];
  if (isPastDate(dateStr)) return [];

  const service = db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(serviceId);
  if (!service) return [];

  const weekday = weekdayOf(dateStr);
  const hours = db.prepare("SELECT * FROM working_hours WHERE weekday = ?").get(weekday);
  if (!hours || hours.closed) return [];

  const dayBlocks = db.prepare("SELECT * FROM blocked_slots WHERE date = ?").all(dateStr);
  if (dayBlocks.some((b) => b.whole_day)) return [];

  const existingBookings = db
    .prepare("SELECT start_time, end_time FROM bookings WHERE date = ? AND status = 'confirmed'")
    .all(dateStr);

  const dayStart = timeToMinutes(hours.start_time);
  const dayEnd = timeToMinutes(hours.end_time);
  const duration = service.duration_minutes;

  const busyRanges = [
    ...existingBookings.map((b) => [timeToMinutes(b.start_time), timeToMinutes(b.end_time)]),
    ...dayBlocks
      .filter((b) => !b.whole_day && b.start_time && b.end_time)
      .map((b) => [timeToMinutes(b.start_time), timeToMinutes(b.end_time)]),
  ];

  const nowMinutes = (() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    if (dateStr !== todayStr) return null;
    return now.getHours() * 60 + now.getMinutes();
  })();

  const slots = [];
  for (let start = dayStart; start + duration <= dayEnd; start += SLOT_STEP_MINUTES) {
    const end = start + duration;
    if (nowMinutes !== null && start <= nowMinutes) continue; // vergangene Zeiten heute überspringen
    const overlaps = busyRanges.some(([bs, be]) => start < be && end > bs);
    if (!overlaps) slots.push(minutesToTime(start));
  }
  return slots;
}

/** Prüft, ob ein konkreter Slot (noch) frei ist, bevor eine Buchung final gespeichert wird. */
function isSlotStillFree(dateStr, serviceId, startTime) {
  const slots = getAvailableSlots(dateStr, serviceId);
  return slots.includes(startTime);
}

module.exports = { getAvailableSlots, isSlotStillFree, timeToMinutes, minutesToTime, weekdayOf };
