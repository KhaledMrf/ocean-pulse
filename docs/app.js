/* Ocean Pulse — M1: live busyness + popular times.
   Plain GET, no custom headers (CORS simple request; Apps Script redirects
   to script.googleusercontent.com, so redirect:'follow' is required). */
(function () {
  "use strict";

  var API = (window.OCEAN_API_URL || "").trim();

  var LS_BUSY = "op:busy:v1";
  var LS_TYPICAL = "op:typical:v1";
  var POLL_MS = 3 * 60 * 1000;

  var DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  var DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

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
    refreshBtn: $("refreshBtn")
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
      b.className = "tab";
      b.id = "tab-" + key;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(key === state.selectedDay));
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
      var bar = document.createElement("button");
      bar.type = "button";
      bar.className = "bar" + (isToday && h === nowHour ? " is-now" : "");
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

  /* ---------- refresh ---------- */

  els.refreshBtn.addEventListener("click", function () {
    if (!API) return;
    els.refreshBtn.classList.add("is-loading");
    Promise.all([loadBusy(), loadTypical(true)]).then(function () {
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
      return;
    }
    els.setup.hidden = true;
    loadBusy();
    loadTypical(false);
    startPolling();
  }

  boot();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* shell still works */ });
    });
  }
})();
