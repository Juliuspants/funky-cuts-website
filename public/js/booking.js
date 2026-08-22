(() => {
  "use strict";

  const state = {
    services: [],
    selectedService: null,
    viewMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDate: null, // "YYYY-MM-DD"
    closedWeekdays: new Set(),
    slots: [],
    selectedSlot: null,
    currentStep: 1,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const stepEls = $$(".step");
  const progressFill = $("#progressFill");
  const progressSteps = $$(".progress-step");

  function pad(n) { return String(n).padStart(2, "0"); }
  function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function todayStr() { return toDateStr(new Date()); }

  function formatMoney(cents) {
    if (cents == null) return "";
    return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  }

  function formatDateHuman(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  }

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

  // ---------------- Step navigation ----------------

  function goToStep(n) {
    state.currentStep = n;
    stepEls.forEach((el) => el.classList.toggle("active", Number(el.dataset.step) === n));
    const pct = ((n - 1) / 3) * 100;
    progressFill.style.width = `${Math.min(pct, 100)}%`;
    progressSteps.forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle("active", s === n);
      el.classList.toggle("done", s < n);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------------- Step 1: Services ----------------

  async function loadServices() {
    try {
      state.services = await api("/api/services");
      renderServices();
    } catch (err) {
      $("#serviceList").innerHTML = `<div class="empty-state">Leistungen konnten nicht geladen werden.</div>`;
      showToast(err.message, true);
    }
  }

  function renderServices() {
    const list = $("#serviceList");
    list.innerHTML = "";
    state.services.forEach((svc, i) => {
      const card = document.createElement("div");
      card.className = "option-card";
      card.style.animationDelay = `${i * 60}ms`;
      card.dataset.id = svc.id;
      card.innerHTML = `
        <div class="option-main">
          <span class="option-name">${escapeHtml(svc.name)}</span>
          <span class="option-meta">${svc.duration_minutes} Min.</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <span class="option-price">${formatMoney(svc.price_cents)}</span>
          <span class="check-badge">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
        </div>
      `;
      card.addEventListener("click", () => selectService(svc, card));
      list.appendChild(card);
    });
  }

  function selectService(svc, card) {
    state.selectedService = svc;
    $$(".option-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    $("#toStep2").disabled = false;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  $("#toStep2").addEventListener("click", () => {
    goToStep(2);
    renderCalendar();
  });

  // ---------------- Step 2: Calendar ----------------

  async function loadWorkingHours() {
    try {
      const rows = await api("/api/working-hours");
      state.closedWeekdays = new Set(rows.filter((r) => r.closed).map((r) => r.weekday));
    } catch (_) {
      // Falls das fehlschlägt, einfach alle Tage anbieten und den Server entscheiden lassen.
    }
  }

  function renderCalendar() {
    const grid = $("#dayGrid");
    grid.innerHTML = "";
    grid.classList.remove("day-grid");
    void grid.offsetWidth; // reflow für Re-Trigger der Animation
    grid.classList.add("day-grid");

    const year = state.viewMonth.getFullYear();
    const month = state.viewMonth.getMonth();
    $("#calendarTitle").textContent = state.viewMonth.toLocaleDateString("de-DE", { month: "long", year: "numeric" });

    const firstOfMonth = new Date(year, month, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7; // Montag = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const today = todayStr();
    const minMonth = new Date();
    $("#prevMonth").disabled = year === minMonth.getFullYear() && month <= minMonth.getMonth();

    for (let i = 0; i < startOffset; i++) {
      const empty = document.createElement("div");
      empty.className = "day-cell empty";
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = toDateStr(date);
      const weekday = date.getDay();
      const isPast = dateStr < today;
      const isClosed = state.closedWeekdays.has(weekday);

      const cell = document.createElement("div");
      cell.className = "day-cell";
      cell.textContent = String(day);
      if (dateStr === today) cell.classList.add("today");
      if (dateStr === state.selectedDate) cell.classList.add("selected");

      if (isPast || isClosed) {
        cell.classList.add("disabled");
      } else {
        cell.addEventListener("click", () => selectDate(dateStr, cell));
      }
      grid.appendChild(cell);
    }
  }

  function selectDate(dateStr, cell) {
    state.selectedDate = dateStr;
    $$(".day-cell").forEach((c) => c.classList.remove("selected"));
    cell.classList.add("selected");
    $("#toStep3").disabled = false;
  }

  $("#prevMonth").addEventListener("click", () => {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  $("#nextMonth").addEventListener("click", () => {
    state.viewMonth = new Date(state.viewMonth.getFullYear(), state.viewMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  $("#backStep2Btn").addEventListener("click", () => goToStep(1));

  $("#toStep3").addEventListener("click", () => {
    goToStep(3);
    loadSlots();
  });

  // ---------------- Step 3: Time slots ----------------

  async function loadSlots() {
    const grid = $("#slotGrid");
    grid.innerHTML = `<div class="skeleton" style="height:44px"></div><div class="skeleton" style="height:44px"></div><div class="skeleton" style="height:44px"></div>`;
    $("#timeHint").textContent = `Verfügbare Zeiten am ${formatDateHuman(state.selectedDate)}.`;
    state.selectedSlot = null;
    $("#toStep4").disabled = true;

    try {
      const data = await api(`/api/availability?date=${state.selectedDate}&serviceId=${state.selectedService.id}`);
      state.slots = data.slots || [];
      renderSlots();
    } catch (err) {
      grid.innerHTML = `<div class="empty-state">Zeiten konnten nicht geladen werden.</div>`;
      showToast(err.message, true);
    }
  }

  function renderSlots() {
    const grid = $("#slotGrid");
    grid.innerHTML = "";
    if (state.slots.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">An diesem Tag ist leider nichts mehr frei. Bitte einen anderen Tag wählen 🙂</div>
        <div class="waitlist-cta">
          <button type="button" class="btn btn-ghost btn-block" id="waitlistToggleBtn">Auf die Warteliste für diesen Tag</button>
          <div class="waitlist-form hidden" id="waitlistForm">
            <div class="field">
              <label for="wlName">Name *</label>
              <input type="text" id="wlName" placeholder="Max Mustermann" autocomplete="name" />
            </div>
            <div class="field">
              <label for="wlPhone">Telefonnummer *</label>
              <input type="tel" id="wlPhone" placeholder="0151 23456789" autocomplete="tel" />
            </div>
            <div class="field">
              <label for="wlEmail">E-Mail (optional)</label>
              <input type="email" id="wlEmail" placeholder="max@beispiel.de" autocomplete="email" />
              <p class="field-note">Damit wir dich benachrichtigen können, falls ein Termin frei wird.</p>
            </div>
            <button type="button" class="btn btn-primary btn-block" id="wlSubmitBtn">Eintragen</button>
          </div>
        </div>
      `;
      wireWaitlistForm();
      return;
    }
    state.slots.forEach((slot, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-btn";
      btn.textContent = slot;
      btn.style.animationDelay = `${i * 35}ms`;
      btn.addEventListener("click", () => {
        state.selectedSlot = slot;
        $$(".slot-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        $("#toStep4").disabled = false;
      });
      grid.appendChild(btn);
    });
  }

  function wireWaitlistForm() {
    const toggleBtn = $("#waitlistToggleBtn");
    const form = $("#waitlistForm");
    if (!toggleBtn || !form) return;
    toggleBtn.addEventListener("click", () => {
      form.classList.toggle("hidden");
      toggleBtn.textContent = form.classList.contains("hidden")
        ? "Auf die Warteliste für diesen Tag"
        : "Warteliste ausblenden";
    });
    $("#wlSubmitBtn").addEventListener("click", async () => {
      const name = $("#wlName").value.trim();
      const phone = $("#wlPhone").value.trim();
      const email = $("#wlEmail").value.trim();
      if (name.length < 2) return showToast("Bitte einen gültigen Namen angeben.", true);
      if (phone.length < 5) return showToast("Bitte eine gültige Telefonnummer angeben.", true);

      const btn = $("#wlSubmitBtn");
      btn.disabled = true;
      btn.textContent = "Wird eingetragen …";
      try {
        await api("/api/waitlist", {
          method: "POST",
          body: JSON.stringify({
            serviceId: state.selectedService.id,
            date: state.selectedDate,
            name, phone,
            email: email || undefined,
          }),
        });
        showToast("Du stehst auf der Warteliste — wir melden uns, sobald etwas frei wird! 🎉");
        form.classList.add("hidden");
        toggleBtn.textContent = "Auf die Warteliste für diesen Tag";
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = "Eintragen";
      }
    });
  }

  $("#backStep3Btn").addEventListener("click", () => goToStep(2));

  $("#toStep4").addEventListener("click", () => {
    renderSummary();
    goToStep(4);
  });

  // ---------------- Step 4: Contact ----------------

  function renderSummary() {
    const svc = state.selectedService;
    $("#summaryCard").innerHTML = `
      <div class="summary-row"><span class="label">Leistung</span><span class="value">${escapeHtml(svc.name)}</span></div>
      <div class="summary-row"><span class="label">Datum</span><span class="value">${formatDateHuman(state.selectedDate)}</span></div>
      <div class="summary-row"><span class="label">Uhrzeit</span><span class="value">${state.selectedSlot} Uhr</span></div>
      ${svc.price_cents != null ? `<div class="summary-row"><span class="label">Preis</span><span class="value">${formatMoney(svc.price_cents)}</span></div>` : ""}
    `;
  }

  // ---------------- Wiederkehrende Kund*innen ("wie letztes Mal?") ----------------

  let returningLookupTimer = null;
  $("#phoneInput").addEventListener("input", () => {
    clearTimeout(returningLookupTimer);
    const phone = $("#phoneInput").value.trim();
    if (phone.length < 6) {
      hideReturningNote();
      return;
    }
    returningLookupTimer = setTimeout(() => lookupReturningCustomer(phone), 700);
  });

  function hideReturningNote() {
    $("#returningCustomerNote")?.classList.add("hidden");
  }

  async function lookupReturningCustomer(phone) {
    const note = $("#returningCustomerNote");
    if (!note) return;
    try {
      const res = await api(`/api/customer-lookup?phone=${encodeURIComponent(phone)}`);
      if (!res.found) {
        hideReturningNote();
        return;
      }
      const sameService = state.selectedService && res.serviceId === state.selectedService.id;
      if (sameService) {
        note.innerHTML = `👋 Willkommen zurück! Wie immer: <strong>${escapeHtml(res.serviceName)}</strong> ✓`;
      } else {
        note.innerHTML = `👋 Willkommen zurück! Letztes Mal warst du bei uns für <strong>${escapeHtml(res.serviceName)}</strong>. <button type="button" class="link-btn" id="returningSwitchBtn">Diesen Service stattdessen buchen</button>`;
      }
      note.classList.remove("hidden");
      const switchBtn = $("#returningSwitchBtn");
      if (switchBtn) {
        switchBtn.addEventListener("click", () => {
          const svc = state.services.find((s) => s.id === res.serviceId);
          if (!svc) return;
          goToStep(1);
          const card = document.querySelector(`.option-card[data-id="${svc.id}"]`);
          if (card) selectService(svc, card);
          showToast(`"${svc.name}" ausgewählt — bitte Datum & Uhrzeit neu wählen.`);
        });
      }
    } catch (_) {
      // Rein kosmetisches Feature — bei Fehlern einfach nichts anzeigen.
      hideReturningNote();
    }
  }

  $("#backStep4Btn").addEventListener("click", () => goToStep(3));

  $("#submitBooking").addEventListener("click", async () => {
    const name = $("#nameInput").value.trim();
    const phone = $("#phoneInput").value.trim();
    const email = $("#emailInput").value.trim();
    const note = $("#noteInput").value.trim();

    if (name.length < 2) return showToast("Bitte einen gültigen Namen angeben.", true);
    if (phone.length < 5) return showToast("Bitte eine gültige Telefonnummer angeben.", true);

    const btn = $("#submitBooking");
    btn.disabled = true;
    btn.textContent = "Wird gebucht …";

    try {
      const booking = await api("/api/bookings", {
        method: "POST",
        body: JSON.stringify({
          serviceId: state.selectedService.id,
          date: state.selectedDate,
          startTime: state.selectedSlot,
          name, phone,
          email: email || undefined,
          note: note || undefined,
        }),
      });
      $("#successDetails").textContent =
        `${state.selectedService.name} am ${formatDateHuman(state.selectedDate)} um ${state.selectedSlot} Uhr. Bis bald, ${name}!`;
      goToStep(5);
      fireConfetti();
    } catch (err) {
      showToast(err.message, true);
      if (String(err.message).includes("nicht mehr verfügbar")) {
        loadSlots();
        goToStep(3);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "Termin buchen";
    }
  });

  $("#newBookingBtn").addEventListener("click", () => {
    state.selectedService = null;
    state.selectedDate = null;
    state.selectedSlot = null;
    $("#toStep2").disabled = true;
    $("#toStep3").disabled = true;
    $("#toStep4").disabled = true;
    $("#nameInput").value = "";
    $("#phoneInput").value = "";
    $("#emailInput").value = "";
    $("#noteInput").value = "";
    hideReturningNote();
    $$(".option-card").forEach((c) => c.classList.remove("selected"));
    goToStep(1);
  });

  // ---------------- confetti ----------------

  function fireConfetti() {
    const colors = ["#c1815c", "#c9a35b", "#7f9a80", "#e7e4dd"];
    const count = 60;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      const size = 6 + Math.random() * 6;
      piece.style.width = `${size}px`;
      piece.style.height = `${size * 0.5}px`;
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.background = colors[i % colors.length];
      const duration = 2.2 + Math.random() * 1.4;
      const delay = Math.random() * 0.3;
      piece.style.animationDuration = `${duration}s`;
      piece.style.animationDelay = `${delay}s`;
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), (duration + delay) * 1000 + 200);
    }
  }

  // ---------------- footer ----------------

  async function loadFooterContact() {
    try {
      const cfg = await api("/api/config");
      const link = $("#footerEmail");
      if (cfg.contactEmail && link) {
        link.href = `mailto:${cfg.contactEmail}`;
        link.textContent = cfg.contactEmail;
      } else if (link) {
        link.remove();
      }
    } catch (_) {
      // Footer-Kontakt ist rein informativ, kein Fehler-Toast nötig.
    }
  }

  // ---------------- init ----------------

  (async function init() {
    await Promise.all([loadServices(), loadWorkingHours(), loadFooterContact()]);
  })();
})();
