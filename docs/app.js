/* Ocean Pulse — M1: live busyness + popular times.
   Plain GET, no custom headers (CORS simple request; Apps Script redirects
   to script.googleusercontent.com, so redirect:'follow' is required). */
(function () {
  "use strict";

  var API = (window.OCEAN_API_URL || "").trim();

  var LS_BUSY = "op:busy:v1";
  var LS_TYPICAL = "op:typical:v1";
  var LS_AUTH = "op:auth:v1";
  var LS_ME = "op:me:v1";
  var POLL_MS = 3 * 60 * 1000;

  var DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  var DAY_LABELS = { mon: "M", tue: "T", wed: "W", thu: "T", fri: "F", sat: "S", sun: "S" };
  var DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday (closed)" };

  var AR_LABELS = {
    "Quiet": "هادئ",
    "Calmer than usual": "أهدأ من المعتاد",
    "Usual": "كالمعتاد",
    "Busier than usual": "أكثر ازدحاماً من المعتاد"
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    setup: $("setup"),
    live: $("live"),
    liveError: $("liveError"),
    popular: $("popular"),
    gaugeFill: $("gaugeFill"),
    gaugePct: $("gaugePct"),
    busyLabel: $("busyLabel"),
    busyLabelAr: $("busyLabelAr"),
    asOf: $("asOf"),
    liveNote: $("liveNote"),
    cachedBadge: $("cachedBadge"),
    staleBadge: $("staleBadge"),
    dayTabs: $("dayTabs"),
    chart: $("chart"),
    axis: $("axis"),
    refreshBtn: $("refreshBtn"),
    viewNav: $("viewNav"),
    navPulse: $("navPulse"),
    navMember: $("navMember"),
    viewPulse: $("view-pulse"),
    viewMember: $("view-member"),
    memberActivate: $("memberActivate"),
    activateIntro: $("activateIntro"),
    activateForm: $("activateForm"),
    activateError: $("activateError"),
    activateBtn: $("activateBtn"),
    actPw: $("actPw"),
    actPw2: $("actPw2"),
    memberLogin: $("memberLogin"),
    loginForm: $("loginForm"),
    loginError: $("loginError"),
    loginBtn: $("loginBtn"),
    loginPhone: $("loginPhone"),
    loginPw: $("loginPw"),
    memberProfile: $("memberProfile")
  };

  var state = {
    typical: null,          // typical payload for this session
    typicalFetched: false,  // fetched once per session (payload covers every day tab)
    typicalFetchedDay: null,// local date string of the last successful fetch
    selectedDay: null,
    userPicked: false,      // member tapped a tab themselves
    pollTimer: null
  };

  /* ---------- utilities ---------- */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function fmtClock(d) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }

  function fmtAsOf(v) {
    if (!v) return "";
    if (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v.trim())) return v.trim();
    var d = new Date(v);
    if (!isNaN(d.getTime())) return fmtClock(d);
    return String(v);
  }

  function lsGet(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function lsSet(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data: data })); } catch (e) { /* full/blocked */ }
  }

  function apiGet(action) {
    var url = API + (API.indexOf("?") === -1 ? "?" : "&") + "action=" + action;
    return fetch(url, { method: "GET", redirect: "follow" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function todayKey() {
    // Trust the API's notion of "today" (Asia/Beirut) only when fetched on the
    // current local date — a payload fetched yesterday (cached, or a session
    // left open past midnight) would point at the wrong tab.
    if (state.typicalFetched &&
        state.typicalFetchedDay === new Date().toDateString() &&
        state.typical && DAY_KEYS.indexOf(state.typical.today) !== -1) {
      return state.typical.today;
    }
    return DAY_KEYS[(new Date().getDay() + 6) % 7]; // JS: 0=Sun → mon-first
  }

  function hourLabel(h) { return h + ":00"; }

  /* ---------- live card ---------- */

  function renderLive(payload, meta) {
    meta = meta || {};
    var live = payload && payload.live;
    if (!live) { renderLiveError(); return; }

    els.liveError.hidden = true;
    els.live.hidden = false;

    var pct = Math.max(0, Math.min(100, Math.round(Number(live.pct) || 0)));
    var label = live.label || "—";
    var isStale = live.stale === true;

    els.live.classList.toggle("is-stale", isStale);
    els.staleBadge.hidden = !isStale;

    els.gaugeFill.setAttribute("stroke-dasharray", pct + " 100");
    els.gaugePct.textContent = pct + "%";
    els.busyLabel.textContent = label;
    els.busyLabelAr.textContent = AR_LABELS[label] || "";

    var asOf = fmtAsOf(live.asOf);
    els.asOf.textContent = asOf ? "as of " + asOf : "";

    if (isStale) {
      els.liveNote.textContent = "No fresh check-ins in the last 15 minutes — go by the typical pattern below.";
      els.liveNote.hidden = false;
    } else if (meta.cached) {
      els.liveNote.textContent = "Showing the last data we saved — tap refresh when you’re back online.";
      els.liveNote.hidden = false;
    } else {
      els.liveNote.hidden = true;
    }

    if (meta.cached) {
      els.cachedBadge.textContent = meta.cachedAt ? "cached " + fmtClock(new Date(meta.cachedAt)) : "cached";
      els.cachedBadge.hidden = false;
    } else {
      els.cachedBadge.hidden = true;
    }
  }

  function renderLiveError() {
    els.live.hidden = true;
    els.liveError.hidden = false;
  }

  function loadBusy() {
    if (!API) return Promise.resolve();
    return apiGet("busy")
      .then(function (json) {
        if (!json || json.ok !== true) throw new Error("api not ok");
        lsSet(LS_BUSY, json);
        renderLive(json, { cached: false });
      })
      .catch(function () {
        var cached = lsGet(LS_BUSY);
        if (cached && cached.data) {
          renderLive(cached.data, { cached: true, cachedAt: cached.t });
        } else {
          renderLiveError();
        }
      });
  }

  /* ---------- popular times ---------- */

  function buildTabs() {
    els.dayTabs.textContent = "";
    DAY_KEYS.forEach(function (key) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tab" + (key === "sun" ? " is-closed" : "");
      b.id = "tab-" + key;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(key === state.selectedDay));
      b.setAttribute("aria-label", DAY_NAMES[key]);
      b.textContent = DAY_LABELS[key];
      b.addEventListener("click", function () { state.userPicked = true; selectDay(key); });
      els.dayTabs.appendChild(b);
    });
  }

  function selectDay(key) {
    state.selectedDay = key;
    DAY_KEYS.forEach(function (k) {
      var tab = document.getElementById("tab-" + k);
      if (tab) tab.setAttribute("aria-selected", String(k === key));
    });
    renderChart();
  }

  function renderChart() {
    var t = state.typical;
    els.chart.textContent = "";
    els.axis.textContent = "";

    if (!t || !t.days || !t.hours || !t.days[state.selectedDay]) {
      var empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = "No typical-times data yet — check back after a few days of check-ins.";
      els.chart.appendChild(empty);
      return;
    }

    var hours = t.hours;
    var values = t.days[state.selectedDay];

    // One scale across all days so tabs compare honestly.
    var globalMax = 0;
    DAY_KEYS.forEach(function (k) {
      (t.days[k] || []).forEach(function (v) { if (Number(v) > globalMax) globalMax = Number(v); });
    });
    if (globalMax <= 0) globalMax = 1;

    var now = new Date();
    var isToday = state.selectedDay === todayKey();
    var nowHour = now.getHours();

    hours.forEach(function (h, i) {
      var v = Math.max(0, Number(values[i]) || 0);
      var share = Math.round((v / globalMax) * 100);
      var tier = share >= 78 ? " bar-hi" : (share <= 24 ? " bar-lo" : "");
      var bar = document.createElement("button");
      bar.type = "button";
      bar.className = "bar" + tier + (isToday && h === nowHour ? " is-now" : "");
      bar.style.height = Math.max(2, share) + "%";
      bar.dataset.tip = hourLabel(h) + " · " + share + "%";
      bar.setAttribute("aria-label", hourLabel(h) + ", " + share + "% of the busiest hour" +
        (isToday && h === nowHour ? " (current hour)" : ""));
      els.chart.appendChild(bar);
    });

    // Sparse axis labels: every 4 hours (6, 10, 14, 18, 22).
    hours.forEach(function (h) {
      if ((h - hours[0]) % 4 === 0) {
        var s = document.createElement("span");
        s.textContent = h;
        els.axis.appendChild(s);
      }
    });
  }

  function loadTypical(force) {
    if (!API) return Promise.resolve();

    // Paint instantly from cache while (maybe) fetching.
    var cached = lsGet(LS_TYPICAL);
    if (!state.typical && cached && cached.data) {
      state.typical = cached.data;
      if (!state.selectedDay) state.selectedDay = todayKey();
      els.popular.hidden = false;
      buildTabs();
      renderChart();
    }

    // Once per session — the payload includes every day tab.
    if (state.typicalFetched && !force) return Promise.resolve();

    return apiGet("typical")
      .then(function (json) {
        if (!json || json.ok !== true) throw new Error("api not ok");
        state.typicalFetched = true;
        state.typicalFetchedDay = new Date().toDateString();
        state.typical = json;
        lsSet(LS_TYPICAL, json);
        if (!state.selectedDay || !state.userPicked) state.selectedDay = todayKey();
        els.popular.hidden = false;
        buildTabs();
        renderChart();
      })
      .catch(function () {
        // Cache (if any) is already painted; otherwise show the card's empty state.
        if (!state.typical) {
          els.popular.hidden = false;
          state.selectedDay = state.selectedDay || todayKey();
          buildTabs();
          renderChart();
        }
      });
  }

  /* ---------- polling (only while visible) ---------- */

  // Session left open past midnight: re-fetch typical so the "today" tab
  // re-snaps (unless the member picked a tab) with the new day's data.
  function maybeRolloverTypical() {
    if (state.typicalFetched && state.typicalFetchedDay !== new Date().toDateString()) {
      loadTypical(true);
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(function () {
      if (document.hidden) return;
      loadBusy();
      renderChart(); // cheap; keeps the "now" hour highlight tracking the clock
      maybeRolloverTypical();
    }, POLL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  document.addEventListener("visibilitychange", function () {
    if (!API) return;
    if (document.hidden) {
      stopPolling();
    } else {
      loadBusy();
      renderChart(); // "now" highlight may have moved while hidden
      maybeRolloverTypical();
      startPolling();
    }
  });

  /* ---------- member area (M3) ---------- */

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var member = {
    view: "pulse",          // 'pulse' | 'member'
    pendingActivation: null // {cid, code} parsed from the WhatsApp link
  };

  function authGet() { var a = lsGet(LS_AUTH); return a && a.data && a.data.cid && a.data.token ? a.data : null; }
  function authSet(data) { lsSet(LS_AUTH, data); }
  function authClear() {
    try { localStorage.removeItem(LS_AUTH); localStorage.removeItem(LS_ME); } catch (e) { /* ok */ }
  }

  /* POST as text/plain => CORS simple request (Apps Script can't answer
     preflights). The response, after the googleusercontent redirect, is JSON. */
  function apiPost(body) {
    return fetch(API, { method: "POST", redirect: "follow", body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }

  function fmtDate(ymd) { // '2026-09-25' -> '25 Sep 2026'
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || "";
    var p = ymd.split("-");
    return Number(p[2]) + " " + MONTHS[Number(p[1]) - 1] + " " + p[0];
  }

  function showView(name) {
    member.view = name;
    els.viewPulse.hidden = name !== "pulse";
    els.viewMember.hidden = name !== "member";
    els.navPulse.setAttribute("aria-selected", String(name === "pulse"));
    els.navMember.setAttribute("aria-selected", String(name === "member"));
    if (name === "member") renderMemberArea();
  }

  /* Decide which member sub-screen to show. */
  function renderMemberArea() {
    var auth = authGet();
    els.memberActivate.hidden = true;
    els.memberLogin.hidden = true;
    els.memberProfile.hidden = true;

    if (member.pendingActivation) {
      els.memberActivate.hidden = false;
      return;
    }
    if (!auth) {
      els.memberLogin.hidden = false;
      return;
    }
    els.memberProfile.hidden = false;
    var cachedMe = lsGet(LS_ME);
    if (cachedMe && cachedMe.data) renderProfile(cachedMe.data, { cached: true, cachedAt: cachedMe.t });
    loadMe();
  }

  function loadMe() {
    var auth = authGet();
    if (!auth) return Promise.resolve();
    return apiPost({ action: "me", cid: auth.cid, token: auth.token })
      .then(function (json) {
        if (json && json.ok === true && json.member) {
          lsSet(LS_ME, json.member);
          renderProfile(json.member, { cached: false });
        } else if (json && json.error === "auth") {
          // Password changed elsewhere / secret rotated: sign out gracefully.
          authClear();
          els.memberProfile.hidden = true;
          els.memberLogin.hidden = false;
          showFormError(els.loginError, "Please sign in again.");
        }
        // other errors: keep whatever is on screen (cached copy)
      })
      .catch(function () { /* offline: cached copy already rendered */ });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderProfile(m, meta) {
    var h = "";

    h += '<div class="hello"><h2>Hi ' + esc(m.firstName || "there") + "</h2>" +
         '<button type="button" class="signout" id="signoutBtn">sign out</button></div>';

    if (m.status === "active" && m.plan) {
      var d = Number(m.plan.daysRemaining);
      var daysNum = d === 0 ? "Today" : String(d);
      var daysCap = d === 0 ? "last day — expires tonight" : (d === 1 ? "day left" : "days left");
      h += '<section class="plan-hero">' +
        '<div class="plan-head">' +
          '<p class="plan-name">' + esc(m.plan.name) + "</p>" +
          '<span class="plan-chip">Active</span>' +
        "</div>" +
        '<div class="days-left-row">' +
          '<p class="days-left' + (d <= 3 ? " is-low" : "") + '">' + daysNum + "</p>" +
          '<span class="days-left-cap">' + daysCap + "</span>" +
        "</div>" +
        '<p class="plan-dates">Until <strong>' + esc(fmtDate(m.plan.endDate)) + "</strong>" +
        (m.memberSince ? " · member since " + esc(fmtDate(m.memberSince)) : "") + "</p>" +
        (m.plan.progressPct != null
          ? '<div class="plan-progress" role="img" aria-label="' + m.plan.progressPct + '% of this membership period used"><span style="width:' + m.plan.progressPct + '%"></span></div>'
          : "") +
        "</section>";
    } else if (m.status === "expired") {
      h += '<div class="status-banner expired"><span class="banner-title">Membership expired</span>' +
        "It ended" + (m.plan && m.plan.endDate ? " on <strong>" + esc(fmtDate(m.plan.endDate)) + "</strong>" : "") +
        " — we'd love to see you back in the water.</div>";
      h += waButton(m, "I'd like to renew my membership");
    } else {
      h += '<div class="status-banner none"><span class="banner-title">No active membership</span>' +
        "You're welcome anytime — day passes at the front desk, or start a plan and make it official.</div>";
      h += waButton(m, "I'd like to subscribe");
    }

    h += '<div class="stat-row">' +
      stat(m.lifetimeVisits, "total visits", false) +
      stat(m.visits30d, "last 30 days", true) +
      stat(m.lastVisit ? fmtDate(m.lastVisit) : "—", "last visit", false) +
      "</div>";

    if (m.timeline && m.timeline.length) {
      h += '<section class="card"><h2>Your journey</h2><ul class="timeline">' +
        m.timeline.map(function (t) {
          return "<li><span>" + esc(t.plan) + '</span><span class="tl-date">' + esc(fmtDate(t.date)) + "</span></li>";
        }).join("") + "</ul></section>";
    }

    if (meta && meta.cached) {
      h += '<p class="member-cached">Showing saved data' +
        (meta.cachedAt ? " from " + fmtClock(new Date(meta.cachedAt)) : "") + " — updating…</p>";
    }

    els.memberProfile.innerHTML = h;
    var so = $("signoutBtn");
    if (so) so.addEventListener("click", function () {
      authClear();
      renderMemberArea();
    });
  }

  function stat(value, label, accent) {
    return '<div class="stat' + (accent ? " stat-accent" : "") + '"><b>' + esc(value == null ? "—" : value) + "</b><span>" + esc(label) + "</span></div>";
  }

  function waButton(m, text) {
    if (!m.whatsapp) return "";
    var url = "https://wa.me/" + String(m.whatsapp).replace(/\D/g, "") +
      "?text=" + encodeURIComponent("Hi Ocean Fitness! " + text + " 💪");
    return '<a class="btn-wa" href="' + esc(url) + '" target="_blank" rel="noopener">Message us on WhatsApp</a>';
  }

  /* ---------- member forms ---------- */

  function showFormError(el, msg) { el.textContent = msg; el.hidden = false; }
  function clearFormError(el) { el.textContent = ""; el.hidden = true; }

  var AUTH_ERRORS = {
    rate: "Too many tries — wait a few minutes and try again.",
    busy: "The service is a bit crowded right now — try again in a minute.",
    weak_password: "Password needs at least 6 characters.",
    expired_link: "This link has expired — ask the front desk to send you a fresh one.",
    not_activated: "This phone isn't set up yet — ask the front desk for your activation link.",
    auth: "That didn't match. Check the number and password and try again."
  };

  els.activateForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    clearFormError(els.activateError);
    var pw = els.actPw.value, pw2 = els.actPw2.value;
    if (pw.length < 6) return showFormError(els.activateError, AUTH_ERRORS.weak_password);
    if (pw !== pw2) return showFormError(els.activateError, "The two passwords don't match.");
    var pa = member.pendingActivation;
    if (!pa) return;
    els.activateBtn.disabled = true;
    apiPost({ action: "activate", cid: pa.cid, code: pa.code, newPassword: pw })
      .then(function (json) {
        if (json && json.ok === true) {
          authSet({ cid: json.cid, token: json.token, firstName: json.firstName });
          member.pendingActivation = null;
          if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
          renderMemberArea();
        } else {
          var code = (json && json.error === "auth") ? "expired_link" : (json && json.error);
          showFormError(els.activateError, AUTH_ERRORS[code] || AUTH_ERRORS.auth);
        }
      })
      .catch(function () { showFormError(els.activateError, "Can't reach the gym right now — check your connection."); })
      .then(function () { els.activateBtn.disabled = false; });
  });

  els.loginForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    clearFormError(els.loginError);
    var phone = els.loginPhone.value.trim(), pw = els.loginPw.value;
    if (!phone || !pw) return showFormError(els.loginError, "Enter your phone number and password.");
    els.loginBtn.disabled = true;
    apiPost({ action: "login", phone: phone, password: pw })
      .then(function (json) {
        if (json && json.ok === true) {
          authSet({ cid: json.cid, token: json.token, firstName: json.firstName });
          els.loginPw.value = "";
          renderMemberArea();
        } else {
          showFormError(els.loginError, AUTH_ERRORS[json && json.error] || AUTH_ERRORS.auth);
        }
      })
      .catch(function () { showFormError(els.loginError, "Can't reach the gym right now — check your connection."); })
      .then(function () { els.loginBtn.disabled = false; });
  });

  /* Activation links look like  <app>/#activate=1042.WXYZ2345  */
  function parseActivationHash() {
    var m = /^#activate=([^.\s]+)\.([A-Za-z0-9]+)$/.exec(location.hash || "");
    if (m) member.pendingActivation = { cid: m[1], code: m[2].toUpperCase() };
    return !!m;
  }

  /* ---------- refresh ---------- */

  els.refreshBtn.addEventListener("click", function () {
    if (!API) return;
    els.refreshBtn.classList.add("is-loading");
    var jobs = [loadBusy(), loadTypical(true)];
    if (member.view === "member" && authGet()) jobs.push(loadMe());
    Promise.all(jobs).then(function () {
      els.refreshBtn.classList.remove("is-loading");
    });
  });

  /* ---------- boot ---------- */

  function boot() {
    if (!API) {
      els.setup.hidden = false;
      els.live.hidden = true;
      els.liveError.hidden = true;
      els.popular.hidden = true;
      els.viewNav.hidden = true;
      els.viewMember.hidden = true;
      return;
    }
    els.setup.hidden = true;
    els.viewNav.hidden = false;

    els.navPulse.addEventListener("click", function () { showView("pulse"); });
    els.navMember.addEventListener("click", function () { showView("member"); });
    window.addEventListener("hashchange", function () {
      if (parseActivationHash()) showView("member");
    });

    loadBusy();
    loadTypical(false);
    startPolling();

    // A WhatsApp activation link lands on the member view; everyone else
    // (signed-in or not) starts on busyness — the daily-use screen.
    if (parseActivationHash()) showView("member");
    else showView("pulse");
  }

  boot();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* shell still works */ });
    });
  }
})();
