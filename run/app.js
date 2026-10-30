/* =========================================================================
   GARMIN TELEMETRY — Yuchen Wang
   Interactive running performance panel
   ========================================================================= */
(function () {
  "use strict";

  var D = window.GARMIN_DATA;
  var METRICS = D.metrics;
  var ACTS = D.activities;
  var PR = D.personalRecords;

  var PALETTE = ["#c9ff3d", "#3ae0ff", "#ffb020", "#ff4d7d", "#a97bff",
    "#37e6a0", "#ff8a3d", "#5b9dff", "#f45b69", "#00d2be", "#ffe066", "#ff6ec7"];
  var MUT = "#77879b", DIM = "#4d5b6c", LINE = "rgba(126,150,175,.14)";
  var MONO = '"JetBrains Mono","SFMono-Regular",Menlo,Consolas,monospace';
  var SPORT = '"Barlow Condensed","Oswald","Arial Narrow",sans-serif';

  var LS_DATES = "garminRunDatesV1";
  function loadDates() {
    try { return JSON.parse(localStorage.getItem(LS_DATES) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveDates() {
    try { localStorage.setItem(LS_DATES, JSON.stringify(state.dates)); } catch (e) {}
  }

  var state = {
    tab: "overview",
    acts: new Set(),
    mets: new Set(["pace", "stride", "cad"]),
    lapX: "km",
    smooth: 0,
    dataAct: ACTS[0] ? ACTS[0].id : null,
    dates: loadDates()
  };

  var charts = {}; // id -> Chart instance

  /* ------------------------------------------------------------ helpers */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function fmtPace(s) {
    if (s == null || !isFinite(s)) return "—";
    s = Math.round(s);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function fmtDur(s) {
    if (s == null || !isFinite(s)) return "—";
    s = Math.round(s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(x).padStart(2, "0")
      : m + ":" + String(x).padStart(2, "0");
  }
  function mOf(k) { for (var i = 0; i < METRICS.length; i++) if (METRICS[i].key === k) return METRICS[i]; return null; }
  function metName(k) { var m = mOf(k); return m ? m.name : k; }
  function metUnit(k) { var m = mOf(k); return m ? m.unit : ""; }
  function isPace(k) { var m = mOf(k); return !!(m && m.type === "pace"); }
  function selMet() { return METRICS.filter(function (m) { return state.mets.has(m.key); }); }
  function selAct() { return ACTS.filter(function (a) { return state.acts.has(a.id); }); }
  function actColor(a) {
    var i = ACTS.indexOf(a);
    return PALETTE[i % PALETTE.length];
  }
  function num(v, d) {
    if (v == null || !isFinite(v)) return "—";
    var p = d == null ? (Math.abs(v) >= 100 ? 0 : (Math.abs(v) >= 10 ? 1 : 2)) : d;
    return Number(v).toFixed(p);
  }
  function val(a, k) { return a.summary[k]; }

  /* -------------------------------------------------- chart.js defaults */
  if (window.Chart) {
    Chart.defaults.font.family = MONO;
    Chart.defaults.font.size = 10;
    Chart.defaults.color = MUT;
    Chart.defaults.borderColor = LINE;
    Chart.defaults.animation.duration = 380;
    Chart.defaults.plugins.tooltip.backgroundColor = "rgba(10,14,20,.95)";
    Chart.defaults.plugins.tooltip.borderColor = "rgba(126,150,175,.35)";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleFont = { family: MONO, size: 11 };
    Chart.defaults.plugins.tooltip.bodyFont = { family: MONO, size: 11 };
    Chart.defaults.plugins.tooltip.padding = 9;
    Chart.defaults.plugins.tooltip.displayColors = true;
    Chart.defaults.plugins.tooltip.boxWidth = 8;
    Chart.defaults.plugins.tooltip.boxHeight = 8;
    Chart.defaults.plugins.legend.display = false;
  }
  function kill(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
  function gridX() {
    return { grid: { color: LINE, drawTicks: false }, border: { color: "rgba(126,150,175,.25)" }, ticks: { padding: 6 } };
  }
  function gridY(opts) {
    var o = opts || {};
    return {
      grid: { color: LINE, drawTicks: false },
      border: { display: false },
      ticks: { padding: 6, callback: o.tick },
      title: o.title ? { display: true, text: o.title, color: o.color || MUT, font: { family: MONO, size: 9 }, padding: 2 } : undefined,
      reverse: !!o.reverse,
      min: o.min, max: o.max
    };
  }

  /* ================================================================ KPI */
  function renderKPIs() {
    var box = $("kpis"); box.innerHTML = "";
    var totD = ACTS.reduce(function (s, a) { return s + a.summary.dist; }, 0);
    var totT = ACTS.reduce(function (s, a) { return s + a.summary.time; }, 0);
    var best = ACTS.reduce(function (b, a) { return (!b || a.summary.pace < b.summary.pace) ? a : b; }, null);
    var cad = ACTS.reduce(function (s, a) { return s + a.summary.cad; }, 0) / ACTS.length;
    var st = ACTS.reduce(function (s, a) { return s + a.summary.stride; }, 0) / ACTS.length;
    var asc = ACTS.reduce(function (s, a) { return s + (a.summary.asc || 0); }, 0);
    var items = [
      { k: "Sessions", v: ACTS.length, u: "场", c: "lime" },
      { k: "Total Volume", v: num(totD, 1), u: "km", c: "" },
      { k: "Total Time", v: fmtDur(totT), u: "", c: "amber" },
      { k: "Best Avg Pace", v: best ? fmtPace(best.summary.pace) : "—", u: "/km", c: "pink" },
      { k: "Mean Cadence", v: num(cad, 0), u: "spm", c: "violet" },
      { k: "Mean Stride", v: num(st, 2), u: "m", c: "" },
      { k: "Total Ascent", v: num(asc, 0), u: "m", c: "" }
    ];
    items.forEach(function (it) {
      var d = el("div", "kpi " + it.c);
      d.innerHTML = '<div class="k">' + it.k + '</div><div class="v">' + it.v +
        (it.u ? ' <small>' + it.u + '</small>' : '') + '</div>';
      box.appendChild(d);
    });
  }

  /* ========================================================== SIDEBAR */
  function bucket(a) {
    var d = a.summary.dist;
    if (d < 4) return "3K";
    if (d < 6) return "5K";
    if (d < 8) return "7K";
    if (d < 13) return "10K";
    return "21K";
  }
  function renderSidebar() {
    var box = $("actList"); box.innerHTML = "";
    var groups = {};
    ACTS.forEach(function (a) { (groups[bucket(a)] = groups[bucket(a)] || []).push(a); });
    Object.keys(groups).sort(function (x, y) { return parseFloat(x) - parseFloat(y); }).forEach(function (g) {
      var wrap = el("div", "grp");
      wrap.appendChild(el("div", "gl", g + " 距离组"));
      groups[g].forEach(function (a) {
        var row = el("div", "act" + (state.acts.has(a.id) ? " on" : ""));
        var dt = state.dates[a.id];
        row.innerHTML =
          '<i class="sw" style="background:' + actColor(a) + ';color:' + actColor(a) + '"></i>' +
          '<div style="flex:1;min-width:0">' +
          '<span class="nm">' + a.label + (a.recent ? ' <span class="tagnew">NEW</span>' : '') + '</span>' +
          (dt ? '<div style="font-family:' + MONO + ';font-size:9px;color:#4d5b6c;letter-spacing:.06em;margin-top:1px">' + dt + '</div>' : '') +
          '</div>' +
          '<span class="mt">' + a.summary.paceFmt + '</span>';
        row.title = a.source + " · " + num(a.summary.dist, 2) + " km · " + a.summary.timeFmt;
        row.onclick = function () {
          if (state.acts.has(a.id)) state.acts.delete(a.id); else state.acts.add(a.id);
          renderSidebar(); refresh();
        };
        wrap.appendChild(row);
      });
      box.appendChild(wrap);
    });
    renderDates();
    // data-tab selector
    var sel = $("dataAct");
    if (sel.options.length === 0) {
      ACTS.forEach(function (a) {
        var o = el("option"); o.value = a.id;
        o.textContent = a.label + " — " + num(a.summary.dist, 2) + "km " + a.summary.paceFmt + "/km";
        sel.appendChild(o);
      });
      sel.value = state.dataAct;
      sel.onchange = function () { state.dataAct = sel.value; renderDataTable(); };
    }
  }

  /* ======================================================= DATES */
  function renderDates() {
    var host = $("dateList");
    if (!host) return;
    host.innerHTML = "";
    ACTS.forEach(function (a) {
      var row = el("div", "drow" + (state.dates[a.id] ? " has" : ""));
      var input = el("input");
      input.type = "date";
      input.value = state.dates[a.id] || "";
      input.setAttribute("aria-label", a.label + " 日期");
      input.onchange = function () {
        if (input.value) state.dates[a.id] = input.value;
        else delete state.dates[a.id];
        saveDates();
        renderSidebar(); refresh();
      };
      row.appendChild(el("span", null, a.label));
      row.appendChild(input);
      host.appendChild(row);
    });
  }

  /* ================================================ FITNESS TIMELINE */
  function renderTimeline() {
    var card = $("timelineCard");
    if (!card) return;
    var dated = ACTS.filter(function (a) { return state.dates[a.id]; });
    if (dated.length < 2) { card.style.display = "none"; return; }
    card.style.display = "";
    kill("tl");
    var t0 = Math.min.apply(null, dated.map(function (a) { return Date.parse(state.dates[a.id]); }));
    function dayOf(a) { return Math.round((Date.parse(state.dates[a.id]) - t0) / 86400000); }
    function dateAt(d) {
      var dt = new Date(t0 + d * 86400000);
      return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
    }
    var pts = dated.map(function (a) {
      return { x: dayOf(a), y: a.summary.pace, r: Math.max(4, a.summary.dist * 0.85), a: a };
    }).sort(function (p, q) { return p.x - q.x; });

    // linear trend
    var n = pts.length, sx = 0, sy = 0;
    pts.forEach(function (p) { sx += p.x; sy += p.y; });
    var mx = sx / n, my = sy / n, sxy = 0, sxx = 0;
    pts.forEach(function (p) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) * (p.x - mx); });
    var trend = [];
    if (sxx > 0) {
      var b = sxy / sxx, c = my - b * mx;
      var x0 = pts[0].x, x1 = pts[n - 1].x;
      trend = [{ x: x0, y: c + b * x0 }, { x: x1, y: c + b * x1 }];
    }

    charts.tl = new Chart($("cTimeline"), {
      type: "bubble",
      data: {
        datasets: [
          {
            label: "sessions", data: pts,
            backgroundColor: pts.map(function (p) { return actColor(p.a) + "88"; }),
            borderColor: pts.map(function (p) { return actColor(p.a); }),
            borderWidth: 1.4, pointStyle: "rectRot"
          },
          {
            label: "trend", data: trend, type: "line", borderColor: "#3ae0ff",
            borderWidth: 1.3, borderDash: [5, 4], pointRadius: 0, fill: false
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: Object.assign(gridX(), {
            title: { display: true, text: "DATE", color: DIM, font: { family: MONO, size: 9 } },
            ticks: { callback: function (v) { return dateAt(v); }, autoSkip: true, maxTicksLimit: 8 }
          }),
          y: Object.assign(gridY({ tick: function (v) { return fmtPace(v); }, title: "AVG PACE (min/km)", reverse: true }), {})
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function (c) {
                var p = c.raw;
                if (!p.a) return null;
                return p.a.label + " · " + dateAt(p.x) + " · " + fmtPace(p.y) + "/km · " + num(p.a.summary.dist, 2) + "km";
              }
            }
          }
        }
      }
    });
  }

  /* ======================================================= METRIC DOCK */
  function renderDock() {
    var rail = $("metricRail"); rail.innerHTML = "";
    METRICS.forEach(function (m) {
      var on = state.mets.has(m.key);
      var b = el("button", "mchip" + (on ? " on" : "") + (m.core ? " core" : ""));
      b.innerHTML = '<span class="n">' + m.name + '</span><span class="u">' + m.unit + '</span><span class="tick">●</span>';
      b.onclick = function () {
        if (state.mets.has(m.key)) state.mets.delete(m.key); else state.mets.add(m.key);
        if (state.mets.size === 0) state.mets.add("pace");
        renderDock(); refresh();
      };
      rail.appendChild(b);
    });
  }

  /* ============================================================ TABS */
  function bindTabs() {
    var btns = $("tabs").querySelectorAll("button");
    Array.prototype.forEach.call(btns, function (b) {
      b.onclick = function () {
        Array.prototype.forEach.call(btns, function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        state.tab = b.dataset.tab;
        ["overview", "laps", "compare", "lab", "model", "data"].forEach(function (t) {
          $("tab-" + t).classList.toggle("hidden", t !== state.tab);
        });
        if (("#" + state.tab) !== location.hash) {
          try { history.replaceState(null, "", "#" + state.tab); } catch (e) {}
        }
        refresh();
      };
    });
  }

  /* ========================================================= PB BOARD */
  function renderPB() {
    var box = $("pbBoard"); box.innerHTML = "";
    var paces = PR.filter(function (r) { return r.pace; }).map(function (r) { return r.pace; });
    var mx = Math.max.apply(null, paces), mn = Math.min.apply(null, paces);
    PR.forEach(function (r) {
      var c = el("div", "pb");
      var pct = mx === mn ? 100 : Math.round(100 - (r.pace - mn) / (mx - mn) * 62);
      c.innerHTML =
        '<div class="d">' + r.cat.replace(/[kK]/, '<small>K</small>') + '</div>' +
        '<div class="t">' + (r.timeFmt || "—") + '</div>' +
        '<div class="p">' + (r.paceFmt || "—") + ' /km' +
        (r.time && r.dist ? ' <span class="chip">' + num(3600 * r.dist / r.time, 1) + ' km/h</span>' : '') +
        '</div><div class="bar"><i style="width:' + pct + '%"></i></div>';
      box.appendChild(c);
    });
  }

  /* ============================================= PACE-DISTANCE ENVELOPE */
  function renderEnvelope() {
    kill("env");
    var pts = PR.filter(function (r) { return r.time && r.pace; })
      .map(function (r) { return { x: r.dist, y: r.pace, r: r }; });
    var fit = riegelFit(pts.map(function (p) { return { d: p.x, t: p.y * p.x }; }));
    var line = [];
    if (fit) {
      for (var d = 0.8; d <= 45; d *= 1.06) {
        line.push({ x: d, y: fit.a * Math.pow(d, fit.b) / d });
        if (d > 44) break;
      }
    }
    var recent = ACTS.filter(function (a) { return a.recent; })
      .map(function (a) { return { x: a.summary.dist, y: a.summary.pace }; });

    charts.env = new Chart($("cEnv"), {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "PB", data: pts, backgroundColor: "#c9ff3d", borderColor: "#c9ff3d",
            pointRadius: 6, pointHoverRadius: 9, pointStyle: "rectRot"
          },
          {
            label: "Riegel fit", data: line, type: "line", borderColor: "#3ae0ff",
            borderWidth: 1.4, borderDash: [5, 4], pointRadius: 0, fill: false, tension: 0
          },
          {
            label: "近期", data: recent, backgroundColor: "rgba(255,77,125,.9)",
            borderColor: "#ff4d7d", pointRadius: 6, pointStyle: "triangle"
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: Object.assign(gridX(), {
            type: "logarithmic",
            title: { display: true, text: "DISTANCE (km, log)", color: DIM, font: { family: MONO, size: 9 } },
            ticks: { callback: function (v) { return [1, 3, 5, 10, 21.1, 42.2].indexOf(+v.toFixed(1)) >= 0 || v === 1 || v === 3 || v === 5 || v === 10 ? v : ""; } }
          }),
          y: Object.assign(gridY({
            tick: function (v) { return fmtPace(v); },
            title: "PACE (min/km)", color: MUT
          }), {})
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function (c) {
                var p = c.raw;
                if (p && p.r) return p.r.cat + " — " + p.r.timeFmt + "  (" + p.r.paceFmt + "/km)";
                return fmtPace(p.y) + " /km @ " + num(p.x, 2) + " km";
              }
            }
          }
        }
      }
    });
  }

  /* =================================================== RIEGEL PROJECTION */
  function renderProjection() {
    var t = $("projTable");
    var head = "<thead><tr><th>基准 PB</th>";
    D.targets.forEach(function (d) {
      head += "<th>" + (d === 21.0975 ? "半马" : d === 42.195 ? "全马" : d + "K") + "</th>";
    });
    head += "</tr></thead>";
    var body = "<tbody>";
    D.projections.forEach(function (p) {
      body += "<tr><td>" + p.from + " <span class='chip'>" + p.t0Fmt + "</span></td>";
      D.targets.forEach(function (d) {
        var v = p[String(d)];
        var isSelf = Math.abs(d - p.d0) < 0.05;
        body += "<td class='" + (isSelf ? "dim" : "hi") + "'>" + v.fmt +
          "<div style='font-size:9px;color:#4d5b6c'>" + v.pace + "/km</div></td>";
      });
      body += "</tr>";
    });
    body += "</tbody>";
    t.innerHTML = head + body;
  }

  /* ======================================================== LOAD CHART */
  function renderLoad() {
    kill("load");
    var acts = ACTS;
    charts.load = new Chart($("cLoad"), {
      type: "bar",
      data: {
        labels: acts.map(function (a) { return a.label; }),
        datasets: [
          {
            type: "bar", label: "距离 km", yAxisID: "y",
            data: acts.map(function (a) { return a.summary.dist; }),
            backgroundColor: acts.map(function (a) { return actColor(a) + "cc"; }),
            borderColor: acts.map(function (a) { return actColor(a); }),
            borderWidth: 1, borderRadius: 1, barPercentage: .68
          },
          {
            type: "line", label: "平均配速", yAxisID: "y1",
            data: acts.map(function (a) { return a.summary.pace; }),
            borderColor: "#ff4d7d", backgroundColor: "#ff4d7d", borderWidth: 1.6,
            pointRadius: 3.5, pointStyle: "rectRot", tension: .25
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: gridX(),
          y: gridY({ title: "DISTANCE (km)", color: "#c9ff3d" }),
          y1: Object.assign(gridY({
            tick: function (v) { return fmtPace(v); }, title: "PACE (min/km)", color: "#ff4d7d"
          }), { position: "right", grid: { display: false } })
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function (c) {
                var a = acts[c.dataIndex];
                return c.datasetIndex === 0
                  ? num(a.summary.dist, 2) + " km · " + a.summary.timeFmt
                  : fmtPace(a.summary.pace) + " /km";
              }
            }
          }
        }
      }
    });
  }

  /* ============================================= normalisation helpers */
  function score(a, k) {
    var m = mOf(k);
    var vals = ACTS.map(function (x) { return val(x, k); }).filter(function (v) { return v != null && isFinite(v); });
    if (!vals.length) return null;
    var v = val(a, k);
    if (v == null || !isFinite(v)) return null;
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mx === mn) return 60;
    var s = (v - mn) / (mx - mn) * 100;
    if (m.dir === -1) s = 100 - s;
    if (m.dir === 0) s = v / mx * 100;
    return Math.round(s);
  }

  function renderRadarCore() {
    kill("radarcore");
    var keys = ["pace", "stride", "cad"];
    var acts = selAct().length ? selAct() : ACTS.slice(0, 4);
    charts.radarcore = new Chart($("cRadarCore"), {
      type: "radar",
      data: {
        labels: keys.map(metName),
        datasets: acts.map(function (a) {
          return {
            label: a.label,
            data: keys.map(function (k) { return score(a, k); }),
            borderColor: actColor(a), backgroundColor: actColor(a) + "22",
            borderWidth: 1.8, pointRadius: 3, pointBackgroundColor: actColor(a)
          };
        })
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0, max: 100,
            grid: { color: LINE }, angleLines: { color: LINE },
            pointLabels: { color: MUT, font: { family: MONO, size: 10 } },
            ticks: { display: false, backdropColor: "transparent" }
          }
        },
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 8, boxHeight: 8, color: MUT, font: { family: MONO, size: 9 }, padding: 10 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + " · " + c.raw + "/100"; } } }
        }
      }
    });
  }

  /* ================================================ LAP TELEMETRY ===== */
  function smooth(arr, w) {
    if (!w) return arr.slice();
    return arr.map(function (v, i) {
      if (v == null) return null;
      var s = 0, n = 0;
      for (var j = Math.max(0, i - w); j <= Math.min(arr.length - 1, i + w); j++) {
        if (arr[j] != null) { s += arr[j]; n++; }
      }
      return n ? s / n : null;
    });
  }
  function xOf(a, l, i) {
    if (state.lapX === "km") return +l.dk.toFixed(3);
    if (state.lapX === "pct") return Math.round(l.cum / a.summary.time * 100);
    return l.lap;
  }

  function renderLaps() {
    var host = $("cLaps").parentNode;
    // remove previously generated small-multiple canvases
    Array.prototype.slice.call(host.querySelectorAll("canvas.gen")).forEach(function (c) {
      if (charts[c.id]) { charts[c.id].destroy(); delete charts[c.id]; }
      c.parentNode.remove();
    });
    $("cLaps").style.display = "none";
    host.style.height = "auto";
    var mets = selMet();
    var acts = selAct();
    $("lapHint").textContent = mets.length + " 项指标 × " + acts.length + " 场";

    if (!acts.length) {
      var w = el("div", "note", "请至少选择一场记录。");
      w.id = "lapEmpty";
      var old = $("lapEmpty"); if (old) old.remove();
      host.appendChild(w);
      return;
    }
    var old2 = $("lapEmpty"); if (old2) old2.remove();

    mets.forEach(function (m) {
      var block = el("div");
      block.style.marginBottom = "14px";
      var head = el("div");
      head.style.cssText = "font-family:var(--sport);font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:" + PALETTE[METRICS.indexOf(m) % PALETTE.length] + ";margin-bottom:2px;display:flex;align-items:baseline;gap:8px";
      head.innerHTML = m.name + ' <span style="font-family:var(--mono);font-size:9.5px;color:#4d5b6c;letter-spacing:.1em">' + m.unit + (m.dir === -1 ? " · LOWER IS BETTER" : m.dir === 1 ? " · HIGHER IS BETTER" : "") + '</span>';
      var cv = el("canvas", "gen");
      cv.id = "lap_" + m.key;
      cv.style.height = "150px";
      var cw = el("div"); cw.style.cssText = "position:relative;height:150px";
      cw.appendChild(cv);
      block.appendChild(head); block.appendChild(cw);
      host.appendChild(block);

      var ds = acts.map(function (a) {
        var pts = a.laps.map(function (l, i) {
          var v = l[m.key];
          return v == null ? null : { x: xOf(a, l, i), y: v };
        }).filter(function (p) { return p; });
        var ys = smooth(pts.map(function (p) { return p.y; }), state.smooth);
        return {
          label: a.label,
          data: pts.map(function (p, i) { return { x: p.x, y: ys[i] }; }),
          borderColor: actColor(a), backgroundColor: actColor(a) + "22",
          borderWidth: 1.7, pointRadius: 2.6, pointHoverRadius: 6,
          pointBackgroundColor: actColor(a), tension: .28, spanGaps: true
        };
      });

      charts[cv.id] = new Chart(cv, {
        type: "line",
        data: { datasets: ds },
        options: {
          maintainAspectRatio: false,
          interaction: { mode: "nearest", axis: "x", intersect: false },
          scales: {
            x: Object.assign(gridX(), {
              type: state.lapX === "km" ? "linear" : "linear",
              title: {
                display: true, color: DIM, font: { family: MONO, size: 9 },
                text: state.lapX === "km" ? "CUMULATIVE DISTANCE (km)" : state.lapX === "pct" ? "RACE PROGRESS (%)" : "SPLIT #"
              },
              min: state.lapX === "pct" ? 0 : undefined, max: state.lapX === "pct" ? 100 : undefined
            }),
            y: gridY({
              tick: isPace(m.key) ? function (v) { return fmtPace(v); } : undefined,
              title: m.unit, color: PALETTE[METRICS.indexOf(m) % PALETTE.length],
              reverse: isPace(m.key)
            })
          },
          plugins: {
            legend: { display: acts.length > 1, position: "top", align: "end", labels: { boxWidth: 8, boxHeight: 8, color: MUT, font: { family: MONO, size: 9 }, padding: 8 } },
            tooltip: {
              callbacks: {
                title: function (c) { return state.lapX === "km" ? num(c[0].parsed.x, 2) + " km" : state.lapX === "pct" ? c[0].parsed.x + " %" : "Split " + c[0].parsed.x; },
                label: function (c) {
                  var v = c.parsed.y;
                  return c.dataset.label + " · " + (isPace(m.key) ? fmtPace(v) + " /km" : num(v) + " " + m.unit);
                }
              }
            }
          }
        }
      });
    });
  }

  function renderSplitBars() {
    kill("split");
    var acts = selAct();
    if (!acts.length) return;
    var maxLaps = Math.max.apply(null, acts.map(function (a) { return a.laps.length; }));
    var labels = [];
    for (var i = 1; i <= maxLaps; i++) labels.push("S" + i);
    charts.split = new Chart($("cSplit"), {
      type: "bar",
      data: {
        labels: labels,
        datasets: acts.map(function (a) {
          return {
            label: a.label,
            data: a.laps.map(function (l) { return l.pace; }),
            backgroundColor: actColor(a) + "cc", borderColor: actColor(a), borderWidth: 1, borderRadius: 1
          };
        })
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: gridX(),
          y: Object.assign(gridY({ tick: function (v) { return fmtPace(v); }, title: "SPLIT PACE (min/km)" }), { reverse: true })
        },
        plugins: {
          legend: { display: true, position: "top", align: "end", labels: { boxWidth: 8, boxHeight: 8, color: MUT, font: { family: MONO, size: 9 }, padding: 8 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + " · " + fmtPace(c.parsed.y) + " /km"; } } }
        }
      }
    });
    $("cSplit").parentNode.style.height = Math.max(240, 120 + acts.length * 26) + "px";
  }

  /* ================================================== CROSS COMPARE === */
  function renderCompare() {
    kill("cmp");
    var acts = selAct(); if (!acts.length) acts = [];
    var mets = selMet();
    charts.cmp = new Chart($("cCompare"), {
      type: "bar",
      data: {
        labels: mets.map(function (m) { return m.name; }),
        datasets: acts.map(function (a) {
          return {
            label: a.label,
            data: mets.map(function (m) { return score(a, m.key); }),
            backgroundColor: actColor(a) + "cc", borderColor: actColor(a), borderWidth: 1, borderRadius: 1
          };
        })
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: gridX(),
          y: gridY({ title: "NORMALISED SCORE (0–100)", min: 0, max: 100 })
        },
        plugins: {
          legend: { display: true, position: "top", align: "end", labels: { boxWidth: 8, boxHeight: 8, color: MUT, font: { family: MONO, size: 9 }, padding: 8 } },
          tooltip: {
            callbacks: {
              label: function (c) {
                var m = mets[c.dataIndex], a = acts.find(function (x) { return x.label === c.dataset.label; });
                var raw = a ? val(a, m.key) : null;
                return c.dataset.label + " · " + c.raw + "/100  [" + (isPace(m.key) ? fmtPace(raw) + "/km" : num(raw) + " " + m.unit) + "]";
              }
            }
          }
        }
      }
    });

    kill("radar");
    charts.radar = new Chart($("cRadar"), {
      type: "radar",
      data: {
        labels: mets.map(function (m) { return m.name; }),
        datasets: acts.map(function (a) {
          return {
            label: a.label, data: mets.map(function (m) { return score(a, m.key); }),
            borderColor: actColor(a), backgroundColor: actColor(a) + "20",
            borderWidth: 1.8, pointRadius: 3, pointBackgroundColor: actColor(a)
          };
        })
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0, max: 100, grid: { color: LINE }, angleLines: { color: LINE },
            pointLabels: { color: MUT, font: { family: MONO, size: 9.5 } },
            ticks: { display: false, backdropColor: "transparent" }
          }
        },
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 8, boxHeight: 8, color: MUT, font: { family: MONO, size: 9 }, padding: 8 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + " · " + c.raw + "/100"; } } }
        }
      }
    });

    // summary table
    var bestPace = {};
    ACTS.forEach(function (a) {
      var g = bucket(a);
      if (!bestPace[g] || a.summary.pace < bestPace[g]) bestPace[g] = a.summary.pace;
    });
    var t = $("cmpTable");
    var h = "<thead><tr><th>场次</th><th>距离</th><th>用时</th><th>ΔvsPB</th>";
    mets.forEach(function (m) { h += "<th>" + m.name + "<div style='font-size:8.5px;color:#3d4756'>" + m.unit + "</div></th>"; });
    h += "</tr></thead><tbody>";
    acts.forEach(function (a) {
      var d = a.summary.pace - bestPace[bucket(a)];
      var dcell = d <= 0.5
        ? "<td class='hi'>PB</td>"
        : "<td style='color:#ffb020'>+" + fmtPace(d) + "</td>";
      h += "<tr><td><span style='color:" + actColor(a) + "'>■</span> " + a.label + "</td><td>" +
        num(a.summary.dist, 2) + "</td><td>" + a.summary.timeFmt + "</td>" + dcell;
      mets.forEach(function (m) {
        var v = val(a, m.key);
        h += "<td class='" + (score(a, m.key) >= 80 ? "hi" : "") + "'>" +
          (isPace(m.key) ? fmtPace(v) : num(v)) + "</td>";
      });
      h += "</tr>";
    });
    h += "</tbody>";
    t.innerHTML = h;
  }

  /* ========================================================== LAB ===== */
  function allSplits(acts) {
    var out = [];
    (acts.length ? acts : ACTS).forEach(function (a) {
      a.laps.forEach(function (l) { out.push({ a: a, l: l }); });
    });
    return out;
  }
  function scatterDatasets(keyX, keyY, sizeKey) {
    var acts = selAct().length ? selAct() : ACTS;
    return acts.map(function (a) {
      return {
        label: a.label,
        data: a.laps.filter(function (l) { return l[keyX] != null && l[keyY] != null; })
          .map(function (l) {
            var sp = sizeKey ? l[sizeKey] : null;
            return { x: l[keyX], y: l[keyY], r: sizeKey ? Math.max(2.5, (sp || 0) * 1.7) : 4, raw: l };
          }),
        backgroundColor: actColor(a) + "55", borderColor: actColor(a),
        borderWidth: 1.2, pointRadius: 4, pointHoverRadius: 8
      };
    });
  }
  function renderLab() {
    kill("cs"); kill("hr"); kill("gct");

    // iso-speed lines: stride = speed*60/cad
    var iso = [];
    [3.2, 3.6, 4.0, 4.4].forEach(function (sp) {
      var pts = [];
      for (var c = 150; c <= 200; c += 2) pts.push({ x: c, y: sp * 60 / c });
      iso.push({
        label: sp + " m/s", data: pts, type: "line", borderColor: "rgba(126,150,175,.28)",
        borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false
      });
    });
    var ds = scatterDatasets("cad", "stride", "speed").concat(iso);
    charts.cs = new Chart($("cCS"), {
      type: "bubble",
      data: { datasets: ds },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: Object.assign(gridX(), { title: { display: true, text: "CADENCE (spm)", color: DIM, font: { family: MONO, size: 9 } }, min: 150, max: 200 }),
          y: Object.assign(gridY({ title: "STRIDE LENGTH (m)", color: MUT }), { min: 0.9, max: 1.8 })
        },
        plugins: {
          legend: { display: true, position: "top", align: "end", labels: { boxWidth: 8, boxHeight: 8, color: MUT, font: { family: MONO, size: 9 }, padding: 8, filter: function (i) { return i.text.indexOf("m/s") < 0; } } },
          tooltip: {
            callbacks: {
              label: function (c) {
                var l = c.raw.raw; if (!l) return c.dataset.label;
                return c.dataset.label + " · " + num(l.cad, 0) + "spm × " + num(l.stride, 2) + "m = " +
                  num(l.kmh, 2) + " km/h (" + fmtPace(l.pace) + "/km)";
              }
            }
          }
        }
      }
    });

    charts.hr = new Chart($("cHR"), {
      type: "scatter",
      data: { datasets: scatterDatasets("hr", "pace", null) },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: Object.assign(gridX(), { title: { display: true, text: "AVG HR (bpm)", color: DIM, font: { family: MONO, size: 9 } } }),
          y: Object.assign(gridY({ tick: function (v) { return fmtPace(v); }, title: "PACE (min/km)", reverse: true })
            , {})
        },
        plugins: {
          legend: { display: true, position: "top", align: "end", labels: { boxWidth: 8, boxHeight: 8, color: MUT, font: { family: MONO, size: 9 }, padding: 8 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + " · " + c.parsed.x + "bpm @ " + fmtPace(c.parsed.y) + "/km"; } } }
        }
      }
    });

    charts.gct = new Chart($("cGCT"), {
      type: "scatter",
      data: { datasets: scatterDatasets("gct", "stride", null) },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: Object.assign(gridX(), { title: { display: true, text: "GROUND CONTACT (ms)", color: DIM, font: { family: MONO, size: 9 } } }),
          y: gridY({ title: "STRIDE LENGTH (m)", color: MUT })
        },
        plugins: {
          legend: { display: true, position: "top", align: "end", labels: { boxWidth: 8, boxHeight: 8, color: MUT, font: { family: MONO, size: 9 }, padding: 8 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + " · " + c.parsed.x + "ms / " + num(c.parsed.y, 2) + "m"; } } }
        }
      }
    });

    renderCorr();
  }

  function pearson(xs, ys) {
    var n = xs.length;
    if (n < 3) return null;
    var sx = 0, sy = 0;
    for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    var mx = sx / n, my = sy / n, num_ = 0, dx = 0, dy = 0;
    for (var j = 0; j < n; j++) {
      var a = xs[j] - mx, b = ys[j] - my;
      num_ += a * b; dx += a * a; dy += b * b;
    }
    if (!dx || !dy) return null;
    return num_ / Math.sqrt(dx * dy);
  }

  function renderCorr() {
    var keys = ["pace", "kmh", "cad", "stride", "hr", "power", "wkg", "gct", "vo", "vr", "re", "ei"];
    var laps = allSplits(selAct().length ? selAct() : ACTS).map(function (s) { return s.l; });
    function pair(a, b) {
      var xs = [], ys = [];
      laps.forEach(function (l) {
        var va = l[a], vb = l[b];
        if (va != null && isFinite(va) && vb != null && isFinite(vb)) { xs.push(va); ys.push(vb); }
      });
      return [xs, ys];
    }
    var h = "<thead><tr><th>r</th>";
    keys.forEach(function (k) { h += "<th>" + metName(k) + "</th>"; });
    h += "</tr></thead><tbody>";
    keys.forEach(function (a) {
      h += "<tr><td>" + metName(a) + "</td>";
      keys.forEach(function (b) {
        if (a === b) { h += "<td class='dim'>1.00</td>"; return; }
        var pr = pair(a, b);
        var r = pearson(pr[0], pr[1]);
        var bg = "transparent", col = "#e7eef6";
        if (r != null) {
          var t = Math.min(1, Math.abs(r));
          if (r < 0) { bg = "rgba(255,77,125," + (t * .34).toFixed(2) + ")"; col = "#ff9dbb"; }
          else { bg = "rgba(55,230,160," + (t * .34).toFixed(2) + ")"; col = "#8ff0c8"; }
        }
        h += "<td style='background:" + bg + ";color:" + col + "'>" + (r == null ? "—" : r.toFixed(2)) + "</td>";
      });
      h += "</tr>";
    });
    h += "</tbody>";
    $("corrTable").innerHTML = h;
  }

  /* ======================================================== MODEL ===== */
  function riegelFit(pts) {
    // log-linear least squares on (log d, log t)
    var n = pts.length; if (n < 2) return null;
    var X = pts.map(function (p) { return Math.log(p.d); });
    var Y = pts.map(function (p) { return Math.log(p.t); });
    var mx = X.reduce(function (a, b) { return a + b; }, 0) / n;
    var my = Y.reduce(function (a, b) { return a + b; }, 0) / n;
    var sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) * (X[i] - mx); syy += (Y[i] - my) * (Y[i] - my); }
    var b = sxy / sxx, a = Math.exp(my - b * mx);
    var r2 = (sxy * sxy) / (sxx * syy);
    return { a: a, b: b, r2: r2, n: n };
  }

  function vo2max(dist_m, time_s) {
    var t = time_s / 60, v = dist_m / t;
    var vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
    var pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
    return vo2 / pct;
  }

  function renderModel() {
    var pts = PR.filter(function (r) { return r.time && r.dist; })
      .map(function (r) { return { d: r.dist * 1000, t: r.time, label: r.cat, km: r.dist }; });

    // ---- Riegel (fit on km for display; b is unit-independent)
    var fit = riegelFit(pts.map(function (p) { return { d: p.km, t: p.t }; }));
    var sg = $("riegelStats");
    sg.innerHTML =
      stat("指数 b", fit ? fit.b.toFixed(4) : "—", "经典参考 1.06") +
      stat("系数 a", fit ? fit.a.toFixed(1) : "—", "T = a·Dᵇ (D:km, T:s)") +
      stat("拟合 R²", fit ? fit.r2.toFixed(4) : "—", fit && fit.r2 > .99 ? "极佳" : "一般") +
      stat("样本 n", fit ? fit.n : "—", "PB 场次");
    var verdict = fit ? (fit.b > 1.10 ? "速度型：距离越长掉速越明显，建议补长距离有氧。"
      : fit.b < 1.03 ? "耐力型：距离延展能力突出，可考虑补短距离速度/爆发。"
        : "均衡型：疲劳指数处于经典区间。") : "";
    $("riegelEq").innerHTML =
      "T = <span class='v'>" + (fit ? fit.a.toFixed(1) : "—") + "</span> · D<sup><span class='v'>" +
      (fit ? fit.b.toFixed(4) : "—") + "</span></sup> &nbsp;&nbsp;(D: km, T: 秒)<br>" +
      "判定：<span class='v'>" + verdict + "</span>";

    // ---- Critical speed: D = D' + CS*t  ->  D/t = CS + D'/t
    var xs = pts.map(function (p) { return 1 / p.t; });      // 1/t
    var ys = pts.map(function (p) { return p.d / p.t; });    // speed m/s
    var n = xs.length;
    var mx = xs.reduce(function (a, b) { return a + b; }, 0) / n;
    var my = ys.reduce(function (a, b) { return a + b; }, 0) / n;
    var sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); syy += (ys[i] - my) * (ys[i] - my); }
    var slope = sxy / sxx;               // D'
    var CS = my - slope * mx;            // m/s
    var r2 = (sxy * sxy) / (sxx * syy);
    $("csStats").innerHTML =
      stat("临界速度 CS", fmtPace(1000 / CS), "≈ 阈配速 /km") +
      stat("CS (m/s)", CS.toFixed(3), (CS * 3.6).toFixed(2) + " km/h") +
      stat("无氧储备 D′", Math.round(slope) + "", "米") +
      stat("拟合 R²", r2.toFixed(4), "");
    $("csEq").innerHTML =
      "D = <span class='v'>" + Math.round(slope) + "</span> + <span class='v'>" + CS.toFixed(3) +
      "</span>·t &nbsp;&nbsp;(D: 米, t: 秒)<br>" +
      "CS ≈ <span class='v'>" + fmtPace(1000 / CS) + "</span> /km；在此配速以下理论上可持续较长时间，以上则动用 D′ 储备。";

    // ---- CS fit chart
    kill("csfit");
    var fitLine = [];
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    for (var k = 0; k <= 40; k++) {
      var xv = x0 + (x1 - x0) * k / 40;
      fitLine.push({ x: xv, y: CS + slope * xv });
    }
    charts.csfit = new Chart($("cCSFit"), {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "PB", data: pts.map(function (p, i) { return { x: xs[i], y: ys[i], p: p }; }),
            backgroundColor: "#c9ff3d", borderColor: "#c9ff3d", pointRadius: 6, pointStyle: "rectRot"
          },
          {
            label: "fit", data: fitLine, type: "line", borderColor: "#3ae0ff",
            borderDash: [5, 4], borderWidth: 1.4, pointRadius: 0, fill: false
          }
        ]
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: Object.assign(gridX(), { title: { display: true, text: "1 / TIME  (1/s)", color: DIM, font: { family: MONO, size: 9 } } }),
          y: Object.assign(gridY({ title: "SPEED (m/s)", color: MUT, tick: function (v) { return (+v).toFixed(1); } }), {})
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function (c) {
                var p = c.raw.p;
                return p ? p.label + " — " + fmtPace(p.t / p.km) + "/km · " + (p.d / p.t).toFixed(2) + " m/s"
                  : (1000 / c.parsed.y).toFixed(1) + " s/km";
              }
            }
          }
        }
      }
    });

    // ---- VO2max table
    var h = "<thead><tr><th>PB</th><th>用时</th><th>速度 m/min</th><th>VO₂max 估算</th><th>等级</th></tr></thead><tbody>";
    PR.filter(function (r) { return r.time; }).forEach(function (r) {
      var v = vo2max(r.dist * 1000, r.time);
      var grade = v >= 60 ? "优秀" : v >= 52 ? "良好" : v >= 45 ? "中等" : "基础";
      h += "<tr><td>" + r.cat + "</td><td>" + r.timeFmt + "</td><td>" +
        num(r.dist * 1000 / (r.time / 60), 0) + "</td><td class='hi'>" + v.toFixed(1) +
        "</td><td>" + grade + "</td></tr>";
    });
    var vs = PR.filter(function (r) { return r.time; }).map(function (r) { return vo2max(r.dist * 1000, r.time); });
    h += "<tr><td class='dim'>均值</td><td class='dim'>—</td><td class='dim'>—</td><td class='hi'>" +
      (vs.reduce(function (a, b) { return a + b; }, 0) / vs.length).toFixed(1) + "</td><td class='dim'>—</td></tr>";
    h += "</tbody>";
    $("vo2Table").innerHTML = h;

    // ---- decoupling
    kill("decoup");
    var acts = ACTS.filter(function (a) { return a.summary.decoupling != null; });
    charts.decoup = new Chart($("cDecoup"), {
      type: "bar",
      data: {
        labels: acts.map(function (a) { return a.label; }),
        datasets: [{
          label: "decoupling %",
          data: acts.map(function (a) { return a.summary.decoupling; }),
          backgroundColor: acts.map(function (a) {
            return a.summary.decoupling > 10 ? "#ff4d7dcc" : a.summary.decoupling > 5 ? "#ffb020cc" : "#37e6a0cc";
          }),
          borderColor: acts.map(function (a) {
            return a.summary.decoupling > 10 ? "#ff4d7d" : a.summary.decoupling > 5 ? "#ffb020" : "#37e6a0";
          }),
          borderWidth: 1, borderRadius: 1, barPercentage: .6
        }]
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: gridX(),
          y: gridY({ title: "DECOUPLING (%)", color: MUT })
        },
        plugins: {
          tooltip: { callbacks: { label: function (c) { return c.parsed.y.toFixed(2) + " %"; } } }
        }
      }
    });
  }
  function stat(k, v, sub) {
    return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v +
      (sub ? ' <small>' + sub + '</small>' : '') + '</div></div>';
  }

  /* ========================================================= DATA ===== */
  function renderDataTable() {
    var a = ACTS.find(function (x) { return x.id === state.dataAct; });
    if (!a) return;
    $("dataHint").textContent = a.source + " · " + a.laps.length + " splits";
    var keys = ["lap", "dist", "time", "pace", "gap", "hr", "cad", "stride", "gct", "vo", "vr", "power", "wkg", "asc", "re", "ei"];
    var h = "<thead><tr>";
    keys.forEach(function (k) {
      var m = mOf(k);
      h += "<th>" + (m ? m.name : k.toUpperCase()) + (m ? "<div style='font-size:8.5px;color:#3d4756'>" + m.unit + "</div>" : "") + "</th>";
    });
    h += "</tr></thead><tbody>";
    a.laps.forEach(function (l) {
      h += "<tr>";
      keys.forEach(function (k) {
        var v = l[k];
        if (k === "time") h += "<td>" + fmtDur(v) + "</td>";
        else if (isPace(k)) h += "<td>" + fmtPace(v) + "</td>";
        else if (k === "lap") h += "<td class='dim'>" + v + "</td>";
        else h += "<td>" + num(v) + "</td>";
      });
      h += "</tr>";
    });
    h += "</tbody>";
    $("dataTable").innerHTML = h;
  }

  $("dlCsv").onclick = function () {
    var a = ACTS.find(function (x) { return x.id === state.dataAct; });
    if (!a) return;
    var keys = ["lap", "dist", "cum", "time", "pace", "gap", "hr", "hrmax", "cad", "stride", "gct", "vo", "vr", "power", "wkg", "asc", "desc", "re", "ei", "kmh"];
    var rows = [keys.join(",")];
    a.laps.forEach(function (l) {
      rows.push(keys.map(function (k) { return l[k] == null ? "" : l[k]; }).join(","));
    });
    var blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var t = el("a"); t.href = url; t.download = a.id + "_splits.csv";
    document.body.appendChild(t); t.click(); document.body.removeChild(t);
  };

  /* ====================================================== REFRESH ===== */
  function refresh() {
    if (state.tab === "overview") { renderEnvelope(); renderLoad(); renderRadarCore(); renderTimeline(); }
    if (state.tab === "laps") { renderLaps(); renderSplitBars(); }
    if (state.tab === "compare") { renderCompare(); }
    if (state.tab === "lab") { renderLab(); }
    if (state.tab === "model") { renderModel(); }
    if (state.tab === "data") { renderDataTable(); }
  }

  /* ========================================================= BOOT ===== */
  function pickDefault() {
    var byGroup = {};
    ACTS.forEach(function (a) { var g = bucket(a); if (!byGroup[g]) byGroup[g] = a; });
    Object.keys(byGroup).forEach(function (g) { state.acts.add(byGroup[g].id); });
  }

  function boot() {
    // precompute cumulative distance per lap
    ACTS.forEach(function (a) {
      var d = 0;
      a.laps.forEach(function (l) { d += l.dist || 0; l.dk = +d.toFixed(4); });
    });
    renderKPIs();
    renderSidebar();
    renderDock();
    renderPB();
    renderProjection();
    bindTabs();
    $("footN").textContent = ACTS.reduce(function (s, a) { return s + a.laps.length; }, 0);

    $("selAll").onclick = function () { ACTS.forEach(function (a) { state.acts.add(a.id); }); renderSidebar(); refresh(); };
    $("selNone").onclick = function () { state.acts.clear(); renderSidebar(); refresh(); };
    $("selBest").onclick = function () {
      state.acts.clear();
      var g = {};
      ACTS.forEach(function (a) {
        var k = bucket(a);
        if (!g[k] || a.summary.pace < g[k].summary.pace) g[k] = a;
      });
      Object.keys(g).forEach(function (k) { state.acts.add(g[k].id); });
      renderSidebar(); refresh();
    };
    $("selRecent").onclick = function () {
      state.acts.clear();
      ACTS.filter(function (a) { return a.recent; }).forEach(function (a) { state.acts.add(a.id); });
      renderSidebar(); refresh();
    };
    $("copyDates").onclick = function () {
      var payload = {};
      ACTS.forEach(function (a) { if (state.dates[a.id]) payload[a.id] = state.dates[a.id]; });
      var txt = JSON.stringify(payload, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () {
          $("copyDates").textContent = "已复制 ✓";
          setTimeout(function () { $("copyDates").textContent = "复制日期 JSON"; }, 1200);
        });
      } else {
        window.prompt("复制以下 JSON 发给我回填 data.js：", txt);
      }
    };
    $("clearDates").onclick = function () {
      state.dates = {};
      saveDates();
      renderSidebar(); refresh();
    };
    $("mCore").onclick = function () {
      state.mets = new Set(METRICS.filter(function (m) { return m.core; }).map(function (m) { return m.key; }));
      renderDock(); refresh();
    };
    $("mAll").onclick = function () { state.mets = new Set(METRICS.map(function (m) { return m.key; })); renderDock(); refresh(); };
    $("mNone").onclick = function () { state.mets = new Set(["pace"]); renderDock(); refresh(); };
    $("lapX").onchange = function () { state.lapX = this.value; renderLaps(); };
    $("lapSmooth0").onclick = function () {
      state.smooth = 0; $("lapSmooth0").classList.add("on"); $("lapSmooth1").classList.remove("on"); renderLaps();
    };
    $("lapSmooth1").onclick = function () {
      state.smooth = 1; $("lapSmooth1").classList.add("on"); $("lapSmooth0").classList.remove("on"); renderLaps();
    };

    pickDefault();
    renderSidebar();
    refresh();

    // deep link:  #laps / #compare / #lab / #model / #data
    var wanted = (location.hash || "").replace("#", "");
    if (wanted) {
      var b = $("tabs").querySelector('button[data-tab="' + wanted + '"]');
      if (b) b.click();
    }
    window.addEventListener("hashchange", function () {
      var w = (location.hash || "").replace("#", "");
      var b2 = $("tabs").querySelector('button[data-tab="' + w + '"]');
      if (b2 && !b2.classList.contains("on")) b2.click();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
