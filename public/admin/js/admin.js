(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  // Anzeige-Reihenfolge Montag -> Sonntag
  const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function showToast(message, isError = false) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      throw new Error((data && data.error) || "Etwas ist schiefgelaufen.");
    }
    return data;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function formatMoney(cents) {
    if (cents == null) return "—";
    return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }

  function formatDateShort(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  }
  function formatDateHuman(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  }

  // ---------------- Auth ----------------

  async function checkSession() {
    try {
      const me = await api("/api/admin/me");
      showDashboard(me.username);
    } catch (_) {
      showLogin();
    }
  }

  function showLogin() {
    $("#loginView").classList.remove("hidden");
    $("#dashboardView").classList.add("hidden");
  }

  function showDashboard(username) {
    $("#loginView").classList.add("hidden");
    $("#dashboardView").classList.remove("hidden");
    $("#whoLabel").textContent = `angemeldet als ${username}`;
    loadBookings();
    loadWorkingHours();
    loadBlockedSlots();
    loadServices();
    loadSchedulingSettings();
  }

  $("#loginBtn").addEventListener("click", doLogin);
  $("#loginPass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

  async function doLogin() {
    const username = $("#loginUser").value.trim();
    const password = $("#loginPass").value;
    if (!username || !password) return showToast("Bitte Benutzername und Passwort eingeben.", true);
    const btn = $("#loginBtn");
    btn.disabled = true;
    btn.textContent = "Anmelden …";
    try {
      const res = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      showDashboard(res.username);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Anmelden";
    }
  }

  $("#logoutBtn").addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    showLogin();
  });

  // ---------------- Tabs ----------------

  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add("active");
    });
  });

  // ---------------- Bookings ----------------

  async function loadBookings() {
    const list = $("#bookingsList");
    try {
      const rows = await api("/api/admin/bookings");
      if (rows.length === 0) {
        list.innerHTML = `<div class="empty-state">Aktuell keine kommenden Termine.</div>`;
        return;
      }
      list.innerHTML = rows.map((b, i) => `
        <div class="booking-row" style="animation-delay:${i * 40}ms">
          <div class="booking-when">
            <div class="d">${formatDateShort(b.date)}</div>
            <div class="t">${b.start_time}</div>
          </div>
          <div class="booking-info">
            <div class="svc">${escapeHtml(b.service_name)}</div>
            <div class="cust">${escapeHtml(b.customer_name)} · ${escapeHtml(b.customer_phone)}${b.note ? " · " + escapeHtml(b.note) : ""}</div>
          </div>
          <button class="btn-danger" data-id="${b.id}">Stornieren</button>
        </div>
      `).join("");
      list.querySelectorAll(".btn-danger").forEach((btn) => {
        btn.addEventListener("click", () => cancelBooking(btn.dataset.id));
      });
    } catch (err) {
      list.innerHTML = `<div class="empty-state">Termine konnten nicht geladen werden.</div>`;
      showToast(err.message, true);
    }
  }

  async function cancelBooking(id) {
    if (!confirm("Diesen Termin wirklich stornieren?")) return;
    try {
      await api(`/api/admin/bookings/${id}`, { method: "DELETE" });
      showToast("Termin storniert.");
      loadBookings();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // ---------------- Working hours ----------------

  async function loadWorkingHours() {
    const list = $("#hoursList");
    try {
      const rows = await api("/api/admin/working-hours");
      const byWeekday = Object.fromEntries(rows.map((r) => [r.weekday, r]));
      list.innerHTML = DISPLAY_ORDER.map((wd) => {
        const r = byWeekday[wd];
        return `
          <div class="wh-row" data-weekday="${wd}">
            <span class="day-name">${WEEKDAY_NAMES[wd]}</span>
            <div class="wh-times">
              <input type="time" class="wh-start" value="${r.start_time}" ${r.closed ? "disabled" : ""} />
              <span>bis</span>
              <input type="time" class="wh-end" value="${r.end_time}" ${r.closed ? "disabled" : ""} />
            </div>
            <span style="font-size:12.5px; color:var(--text-faint);">${r.closed ? "Geschlossen" : "Geöffnet"}</span>
            <label class="switch">
              <input type="checkbox" class="wh-open-toggle" ${r.closed ? "" : "checked"} />
              <span class="track"></span>
            </label>
          </div>
        `;
      }).join("");

      list.querySelectorAll(".wh-row").forEach((row) => {
        const toggle = row.querySelector(".wh-open-toggle");
        const startInput = row.querySelector(".wh-start");
        const endInput = row.querySelector(".wh-end");
        const label = row.querySelector("span:nth-child(3)");
        toggle.addEventListener("change", () => {
          const open = toggle.checked;
          startInput.disabled = !open;
          endInput.disabled = !open;
          label.textContent = open ? "Geöffnet" : "Geschlossen";
        });
      });
    } catch (err) {
      list.innerHTML = `<div class="empty-state">Öffnungszeiten konnten nicht geladen werden.</div>`;
      showToast(err.message, true);
    }
  }

  $("#saveHoursBtn").addEventListener("click", async () => {
    const rows = $$(".wh-row").map((row) => ({
      weekday: Number(row.dataset.weekday),
      closed: !row.querySelector(".wh-open-toggle").checked,
      start_time: row.querySelector(".wh-start").value || "09:00",
      end_time: row.querySelector(".wh-end").value || "18:00",
    }));
    const btn = $("#saveHoursBtn");
    btn.disabled = true;
    try {
      await api("/api/admin/working-hours", { method: "PUT", body: JSON.stringify({ days: rows }) });
      showToast("Öffnungszeiten gespeichert.");
    } catch (err) {
      showToast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------- Blocked slots ----------------

  async function loadBlockedSlots() {
    const list = $("#blockedList");
    try {
      const rows = await api("/api/admin/blocked-slots");
      if (rows.length === 0) {
        list.innerHTML = `<div class="empty-state">Keine blockierten Tage eingetragen.</div>`;
        return;
      }
      list.innerHTML = rows.map((b) => `
        <div class="blocked-row">
          <div class="info">
            <div class="date">${formatDateHuman(b.date)}</div>
            <div class="meta">${b.whole_day ? "Ganzer Tag" : `${b.start_time}–${b.end_time}`}${b.reason ? " · " + escapeHtml(b.reason) : ""}</div>
          </div>
          <button class="btn-danger" data-id="${b.id}">Entfernen</button>
        </div>
      `).join("");
      list.querySelectorAll(".btn-danger").forEach((btn) => {
        btn.addEventListener("click", () => removeBlockedSlot(btn.dataset.id));
      });
    } catch (err) {
      list.innerHTML = `<div class="empty-state">Konnte nicht geladen werden.</div>`;
      showToast(err.message, true);
    }
  }

  $("#addBlockBtn").addEventListener("click", async () => {
    const date = $("#blockDate").value;
    if (!date) return showToast("Bitte ein Datum wählen.", true);
    try {
      await api("/api/admin/blocked-slots", {
        method: "POST",
        body: JSON.stringify({ date, wholeDay: true }),
      });
      $("#blockDate").value = "";
      showToast("Tag blockiert.");
      loadBlockedSlots();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  async function removeBlockedSlot(id) {
    try {
      await api(`/api/admin/blocked-slots/${id}`, { method: "DELETE" });
      showToast("Blockierung entfernt.");
      loadBlockedSlots();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // ---------------- Services ----------------

  async function loadServices() {
    const list = $("#servicesList");
    try {
      const rows = await api("/api/admin/services");
      if (rows.length === 0) {
        list.innerHTML = `<div class="empty-state">Noch keine Leistungen angelegt.</div>`;
        return;
      }
      list.innerHTML = rows.map((s) => `
        <div class="service-row" data-id="${s.id}" style="opacity:${s.active ? 1 : 0.45}">
          <div class="info">
            <div class="name">${escapeHtml(s.name)}</div>
            <div class="meta">${s.duration_minutes} Min. · ${formatMoney(s.price_cents)}${s.active ? "" : " · deaktiviert"}</div>
          </div>
          <button class="btn-ghost toggle-active-btn" data-id="${s.id}" data-active="${s.active}">${s.active ? "Deaktivieren" : "Aktivieren"}</button>
        </div>
      `).join("");
      list.querySelectorAll(".toggle-active-btn").forEach((btn) => {
        btn.addEventListener("click", () => toggleServiceActive(btn.dataset.id, btn.dataset.active === "1"));
      });
    } catch (err) {
      list.innerHTML = `<div class="empty-state">Leistungen konnten nicht geladen werden.</div>`;
      showToast(err.message, true);
    }
  }

  async function toggleServiceActive(id, currentlyActive) {
    try {
      await api(`/api/admin/services/${id}`, {
        method: "PUT",
        body: JSON.stringify({ active: !currentlyActive }),
      });
      loadServices();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  $("#addSvcBtn").addEventListener("click", async () => {
    const name = $("#newSvcName").value.trim();
    const duration = Number($("#newSvcDuration").value);
    const priceEuro = $("#newSvcPrice").value;
    if (!name || !duration) return showToast("Bitte Name und Dauer angeben.", true);
    try {
      await api("/api/admin/services", {
        method: "POST",
        body: JSON.stringify({
          name,
          durationMinutes: duration,
          priceCents: priceEuro ? Math.round(Number(priceEuro) * 100) : null,
        }),
      });
      $("#newSvcName").value = "";
      $("#newSvcDuration").value = "";
      $("#newSvcPrice").value = "";
      showToast("Leistung hinzugefügt.");
      loadServices();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // ---------------- Scheduling settings ----------------

  async function loadSchedulingSettings() {
    try {
      const s = await api("/api/admin/settings");
      $("#slotIntervalSelect").value = String(s.slot_interval_minutes);
      $("#bufferSelect").value = String(s.buffer_minutes);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  $("#saveSettingsBtn").addEventListener("click", async () => {
    const btn = $("#saveSettingsBtn");
    btn.disabled = true;
    try {
      await api("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          slotIntervalMinutes: Number($("#slotIntervalSelect").value),
          bufferMinutes: Number($("#bufferSelect").value),
        }),
      });
      showToast("Terminplanung gespeichert.");
    } catch (err) {
      showToast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  checkSession();
})();
