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
  function formatWeekdayShort(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("de-DE", { weekday: "short" });
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
    loadContent();
    loadGallery();
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
            <div class="d">${formatWeekdayShort(b.date)} ${formatDateShort(b.date)}</div>
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
          <button class="btn-danger delete-svc-btn" data-id="${s.id}" data-name="${escapeHtml(s.name)}">Löschen</button>
        </div>
      `).join("");
      list.querySelectorAll(".toggle-active-btn").forEach((btn) => {
        btn.addEventListener("click", () => toggleServiceActive(btn.dataset.id, btn.dataset.active === "1"));
      });
      list.querySelectorAll(".delete-svc-btn").forEach((btn) => {
        btn.addEventListener("click", () => deleteService(btn.dataset.id, btn.dataset.name));
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

  async function deleteService(id, name) {
    if (!confirm(`"${name}" endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    try {
      await api(`/api/admin/services/${id}`, { method: "DELETE" });
      showToast("Leistung gelöscht.");
      loadServices();
    } catch (err) {
      // Hat die Leistung schon Termine, blockt der Server das endgültige Löschen bewusst ab.
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

  // ---------------- Startseite: Texte ----------------

  async function loadContent() {
    try {
      const c = await api("/api/admin/content");
      $("#heroTitleInput").value = c.heroTitle || "";
      $("#heroTextInput").value = c.heroText || "";
      $("#aboutTextInput").value = c.aboutText || "";
      $("#addressLine1Input").value = c.addressLine1 || "";
      $("#addressLine2Input").value = c.addressLine2 || "";
    } catch (err) {
      showToast(err.message, true);
    }
  }

  $("#saveContentBtn").addEventListener("click", async () => {
    const btn = $("#saveContentBtn");
    btn.disabled = true;
    try {
      await api("/api/admin/content", {
        method: "PUT",
        body: JSON.stringify({
          heroTitle: $("#heroTitleInput").value,
          heroText: $("#heroTextInput").value,
          aboutText: $("#aboutTextInput").value,
          addressLine1: $("#addressLine1Input").value,
          addressLine2: $("#addressLine2Input").value,
        }),
      });
      showToast("Startseite gespeichert.");
    } catch (err) {
      showToast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------- Startseite: Galerie ----------------

  async function loadGallery() {
    const grid = $("#galleryManageGrid");
    try {
      const images = await api("/api/admin/gallery");
      if (images.length === 0) {
        grid.innerHTML = `<div class="gallery-manage-empty">Noch keine Bilder hochgeladen.</div>`;
        return;
      }
      grid.innerHTML = images.map((img) => `
        <div class="gallery-manage-item" data-id="${img.id}">
          <img src="${img.url}" alt="Galeriebild" />
          <div class="gallery-manage-actions">
            <button class="gallery-manage-move" data-dir="left" title="Nach links verschieben">◀</button>
            <button class="gallery-manage-delete" title="Löschen">✕</button>
            <button class="gallery-manage-move" data-dir="right" title="Nach rechts verschieben">▶</button>
          </div>
        </div>
      `).join("");
      grid.querySelectorAll(".gallery-manage-move").forEach((btn) => {
        btn.addEventListener("click", () => moveGalleryImage(btn.closest(".gallery-manage-item").dataset.id, btn.dataset.dir));
      });
      grid.querySelectorAll(".gallery-manage-delete").forEach((btn) => {
        btn.addEventListener("click", () => deleteGalleryImage(btn.closest(".gallery-manage-item").dataset.id));
      });
    } catch (err) {
      grid.innerHTML = `<div class="gallery-manage-empty">Galerie konnte nicht geladen werden.</div>`;
      showToast(err.message, true);
    }
  }

  async function moveGalleryImage(id, dir) {
    try {
      await api(`/api/admin/gallery/${id}/move`, {
        method: "PUT",
        body: JSON.stringify({ direction: dir }),
      });
      loadGallery();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function deleteGalleryImage(id) {
    if (!confirm("Dieses Bild wirklich löschen?")) return;
    try {
      await api(`/api/admin/gallery/${id}`, { method: "DELETE" });
      showToast("Bild gelöscht.");
      loadGallery();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // Bild vor dem Upload clientseitig verkleinern/komprimieren, damit es
  // sicher unter das Netlify-Function-Body-Limit passt und die Startseite
  // schnell lädt.
  function resizeImageFile(file, maxDimension = 1400, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width >= height) {
              height = Math.round((height / width) * maxDimension);
              width = maxDimension;
            } else {
              width = Math.round((width / height) * maxDimension);
              height = maxDimension;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  $("#galleryUploadBtn").addEventListener("click", () => $("#galleryFileInput").click());

  $("#galleryFileInput").addEventListener("change", async () => {
    const file = $("#galleryFileInput").files[0];
    $("#galleryFileInput").value = "";
    if (!file) return;
    const btn = $("#galleryUploadBtn");
    btn.disabled = true;
    btn.textContent = "Wird hochgeladen …";
    try {
      const dataUrl = await resizeImageFile(file);
      await api("/api/admin/gallery", {
        method: "POST",
        body: JSON.stringify({ image: dataUrl }),
      });
      showToast("Bild hochgeladen.");
      loadGallery();
    } catch (err) {
      showToast(err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Bild hochladen";
    }
  });

  checkSession();
})();
