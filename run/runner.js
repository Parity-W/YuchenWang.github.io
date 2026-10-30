/* =========================================================================
   runner.js — 参数化步态动画（Parametric Gait Animation）
   用真实跑步指标驱动一个侧面跑姿的线稿小人：
     步频 → 步频周期   步幅 → 髋摆幅   触地时间 → 支撑相占比
     垂直振幅 → 重心起伏   速度 → 前倾角 / 地面滚动速度
   ========================================================================= */
(function (global) {
  "use strict";

  var DEG = Math.PI / 180;
  var NS = "http://www.w3.org/2000/svg";

  function mk(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function map(v, a, b, c, d) { return c + (clamp(v, a, b) - a) / (b - a) * (d - c); }

  /* ------------------------------------------------------------- geometry */
  var GEO = {
    w: 640, h: 330,
    groundY: 264,
    hipX: 300,
    thigh: 62, shank: 62, foot: 24,
    torso: 78, neck: 15, headR: 14,
    upperArm: 42, foreArm: 40,
    pxPerM: 58
  };

  function Runner(host, opts) {
    opts = opts || {};
    this.host = typeof host === "string" ? document.getElementById(host) : host;
    this.params = {
      cadence: 175, stride: 1.35, gct: 235, vo: 9.6, kmh: 13.5, label: ""
    };
    this.phase = 0;
    this.speed = opts.speed == null ? 1 : opts.speed;
    this.running = !!opts.autoplay;
    this.dashOffset = 0;
    this._last = 0;
    this._build();
    this.setParams(this.params);
    if (this.running) this.play();
  }

  Runner.prototype._build = function () {
    var g = GEO;
    var svg = mk("svg", {
      viewBox: "150 20 420 305",
      preserveAspectRatio: "xMidYMid meet",
      width: "100%", height: "100%"
    }, this.host);
    this.svg = svg;

    // ---- defs: 细网格底纹
    var defs = mk("defs", null, svg);
    var pat = mk("pattern", { id: "rGrid", width: 20, height: 20, patternUnits: "userSpaceOnUse" }, defs);
    mk("path", { d: "M20 0H0V20", fill: "none", stroke: "#e6eaf1", "stroke-width": 1 }, pat);
    mk("rect", { x: 0, y: 0, width: g.w, height: g.h, fill: "url(#rGrid)", opacity: ".7" }, svg);

    // ---- 轨迹 / 地面 / 标尺
    this.traj = mk("path", {
      fill: "none", stroke: "#b9c6e8", "stroke-width": 1.4,
      "stroke-dasharray": "3 4", "stroke-linejoin": "round"
    }, svg);
    this.ground = mk("line", {
      x1: 40, y1: g.groundY, x2: g.w - 30, y2: g.groundY,
      stroke: "#c3cbd9", "stroke-width": 1.6
    }, svg);
    this.groundDash = mk("line", {
      x1: 40, y1: g.groundY + 10, x2: g.w - 30, y2: g.groundY + 10,
      stroke: "#dde3ec", "stroke-width": 3, "stroke-dasharray": "10 14"
    }, svg);

    // 1 m 标尺
    this.ruler = mk("g", null, svg);
    var rx = 168;
    mk("line", { x1: rx, y1: g.groundY + 22, x2: rx + g.pxPerM, y2: g.groundY + 22, stroke: "#98a2b3", "stroke-width": 1 }, this.ruler);
    mk("line", { x1: rx, y1: g.groundY + 17, x2: rx, y2: g.groundY + 27, stroke: "#98a2b3", "stroke-width": 1 }, this.ruler);
    mk("line", { x1: rx + g.pxPerM, y1: g.groundY + 17, x2: rx + g.pxPerM, y2: g.groundY + 27, stroke: "#98a2b3", "stroke-width": 1 }, this.ruler);
    var rt = mk("text", { x: rx + g.pxPerM / 2, y: g.groundY + 37, "text-anchor": "middle", fill: "#98a2b3", "font-size": 10, "font-family": "monospace", "letter-spacing": ".08em" }, this.ruler);
    rt.textContent = "1 m";

    // ---- 残影（motion trail）
    this.ghosts = [];
    for (var i = 0; i < 2; i++) {
      var gg = mk("g", { opacity: i === 0 ? ".16" : ".08" }, svg);
      this.ghosts.push({
        thighB: mk("line", { stroke: "#7c8aa0", "stroke-width": 6, "stroke-linecap": "round" }, gg),
        shankB: mk("line", { stroke: "#7c8aa0", "stroke-width": 6, "stroke-linecap": "round" }, gg),
        thighA: mk("line", { stroke: "#7c8aa0", "stroke-width": 6, "stroke-linecap": "round" }, gg),
        shankA: mk("line", { stroke: "#7c8aa0", "stroke-width": 6, "stroke-linecap": "round" }, gg)
      });
    }

    // ---- 身体（后侧腿先画，弱一档）
    var INK = "#101a2e", INK2 = "#5b6675";
    this.limb = {};
    ["B", "A"].forEach(function (side, idx) {
      var grp = mk("g", null, svg);
      var col = idx === 0 ? INK2 : INK;
      var sw = idx === 0 ? 5.5 : 7;
      var o = idx === 0 ? ".62" : "1";
      grp.setAttribute("opacity", o);
      this.limb[side] = {
        thigh: mk("line", { stroke: col, "stroke-width": sw, "stroke-linecap": "round" }, grp),
        shank: mk("line", { stroke: col, "stroke-width": sw, "stroke-linecap": "round" }, grp),
        foot: mk("line", { stroke: col, "stroke-width": idx === 0 ? 4.5 : 6, "stroke-linecap": "round" }, grp),
        knee: mk("circle", { r: 3.4, fill: "#fff", stroke: col, "stroke-width": 1.6 }, grp),
        ankle: mk("circle", { r: 3.4, fill: "#fff", stroke: col, "stroke-width": 1.6 }, grp),
        armU: mk("line", { stroke: col, "stroke-width": idx === 0 ? 4.5 : 5.5, "stroke-linecap": "round" }, grp),
        armF: mk("line", { stroke: col, "stroke-width": idx === 0 ? 4.5 : 5.5, "stroke-linecap": "round" }, grp),
        hand: mk("circle", { r: 3, fill: "#fff", stroke: col, "stroke-width": 1.4 }, grp),
        g: grp
      };
    }, this);

    // ---- 阴影（随重心起伏缩放）
    this.shadow = mk("ellipse", { rx: 34, ry: 7, fill: "rgba(15,23,42,.07)" }, svg);

    // ---- 躯干 / 头
    var core = mk("g", null, svg);
    this.torso = mk("line", { stroke: INK, "stroke-width": 9, "stroke-linecap": "round" }, core);
    this.neck = mk("line", { stroke: INK, "stroke-width": 6, "stroke-linecap": "round" }, core);
    this.head = mk("circle", { r: GEO.headR, fill: "#fff", stroke: INK, "stroke-width": 2.2 }, core);
    this.hipJ = mk("circle", { r: 4.2, fill: "#1a5cff", stroke: "#fff", "stroke-width": 1.6 }, core);
    this.shoulderJ = mk("circle", { r: 4.2, fill: "#1a5cff", stroke: "#fff", "stroke-width": 1.6 }, core);

    // ---- 触地标记 + 地面反作用力
    this.contactDot = mk("circle", { r: 4.6, fill: "#ff5a2d", opacity: "0" }, svg);
    this.grf = mk("line", { stroke: "#ff5a2d", "stroke-width": 2.4, "stroke-linecap": "round", opacity: "0" }, svg);

    // ---- 重心竖直参考线
    this.comLine = mk("line", { stroke: "#c3cbd9", "stroke-width": 1, "stroke-dasharray": "2 4" }, svg);

    this._raf = null;
  };

  /* ------------------------------------------------------------- pose */
  Runner.prototype._pose = function (p) {
    var g = GEO, P = this.params;
    var A = this.amp;
    var s = this.stanceFrac;

    function leg(rawPh) {
      var ph = rawPh - Math.floor(rawPh);
      // 髋：+ 向前（着地）→ − 向后（蹬离）
      var th = A.hip * Math.cos(2 * Math.PI * ph);
      var psi;
      if (ph < s) {
        // 支撑相：负荷期微屈，蹬伸期回伸
        psi = A.kneeStance * Math.sin(Math.PI * ph / s);
      } else {
        // 摆动相：蹬离后膝迅速大幅折叠（前段陡升），前摆时回伸
        var u = (ph - s) / (1 - s);
        psi = A.kneeSwing * Math.sin(Math.PI * Math.pow(u, 0.55));
      }
      var footA;
      if (ph < s) footA = 6 - 9 * Math.sin(Math.PI * ph / s);
      else {
        var u2 = (ph - s) / (1 - s);
        footA = -20 * Math.sin(Math.PI * Math.pow(u2, 0.7));
      }
      return { th: th, psi: psi, footA: footA };
    }

    var bob = -A.bob * Math.cos(4 * Math.PI * p);
    var hx = GEO.hipX;
    var hy = GEO.groundY - (GEO.thigh + GEO.shank) * 0.95 + bob + A.bob * 0.5;

    var lean = A.lean * DEG;
    var sx = hx + Math.sin(lean) * GEO.torso;
    var sy = hy - Math.cos(lean) * GEO.torso;
    var nx = sx + Math.sin(lean) * GEO.neck;
    var ny = sy - Math.cos(lean) * GEO.neck;

    function limbKin(L, side) {
      var kx = hx + Math.sin(L.th * DEG) * GEO.thigh;
      var ky = hy + Math.cos(L.th * DEG) * GEO.thigh;
      var shAng = (L.th - L.psi) * DEG;
      var ax = kx + Math.sin(shAng) * GEO.shank;
      var ay = ky + Math.cos(shAng) * GEO.shank;
      var tx = ax + Math.cos(L.footA * DEG) * GEO.foot;
      var ty = ay + Math.sin(L.footA * DEG) * GEO.foot;
      // 手臂与该侧腿反相
      var tha = -A.arm * Math.cos(2 * Math.PI * L.ph);
      var ex = sx + Math.sin(tha * DEG) * GEO.upperArm;
      var ey = sy + Math.cos(tha * DEG) * GEO.upperArm;
      var flex = A.elbow * DEG;
      var hdx = ex + Math.sin((tha + flex) * DEG) * GEO.foreArm;
      var hdy = ey + Math.cos((tha + flex) * DEG) * GEO.foreArm;
      return { kx: kx, ky: ky, ax: ax, ay: ay, tx: tx, ty: ty, ex: ex, ey: ey, hdx: hdx, hdy: hdy, th: L.th, psi: L.psi };
    }

    var A_ = leg(p); A_.ph = p - Math.floor(p);
    var B_ = leg(p + 0.5); B_.ph = (p + 0.5) % 1;
    var la = limbKin(A_, "A");
    var lb = limbKin(B_, "B");

    return {
      hip: { x: hx, y: hy }, sh: { x: sx, y: sy }, neck: { x: nx, y: ny },
      A: la, B: lb,
      contact: (p < s) ? la : (B_.ph % 1 < s ? lb : null),
      contactLeg: p < s ? "A" : "B",
      hipDeg: A_.th, kneeDeg: A_.psi,
      inStance: p < s
    };
  };

  Runner.prototype._drawPose = function (po, ghostOnly) {
    var g = GEO;
    function set(l, a, b) { l.setAttribute("x1", a.x); l.setAttribute("y1", a.y); l.setAttribute("x2", b.x); l.setAttribute("y2", b.y); }
    function put(c, a) { c.setAttribute("cx", a.x); c.setAttribute("cy", a.y); }

    if (ghostOnly) {
      this.ghosts.forEach(function (gh, i) {
        var q = this._pose(this.phase - (i + 1) * 0.085);
        set(gh.thighA, q.hip, { x: q.A.kx, y: q.A.ky });
        set(gh.shankA, { x: q.A.kx, y: q.A.ky }, { x: q.A.ax, y: q.A.ay });
        set(gh.thighB, q.hip, { x: q.B.kx, y: q.B.ky });
        set(gh.shankB, { x: q.B.kx, y: q.B.ky }, { x: q.B.ax, y: q.B.ay });
      }, this);
      return;
    }

    ["B", "A"].forEach(function (s) {
      var L = this.limb[s], K = po[s];
      set(L.thigh, po.hip, { x: K.kx, y: K.ky });
      set(L.shank, { x: K.kx, y: K.ky }, { x: K.ax, y: K.ay });
      set(L.foot, { x: K.ax, y: K.ay }, { x: K.tx, y: K.ty });
      put(L.knee, { x: K.kx, y: K.ky });
      put(L.ankle, { x: K.ax, y: K.ay });
      set(L.armU, po.sh, { x: K.ex, y: K.ey });
      set(L.armF, { x: K.ex, y: K.ey }, { x: K.hdx, y: K.hdy });
      put(L.hand, { x: K.hdx, y: K.hdy });
    }, this);

    set(this.torso, po.hip, po.sh);
    set(this.neck, po.sh, po.neck);
    put(this.head, po.neck);
    put(this.hipJ, po.hip);
    put(this.shoulderJ, po.sh);

    // 阴影随离地高度缩放
    var lift = clamp((GEO.groundY - (po.hip.y + (GEO.thigh + GEO.shank) * 0.95)) / 18, -0.4, 1);
    this.shadow.setAttribute("cx", po.hip.x);
    this.shadow.setAttribute("cy", GEO.groundY + 3);
    this.shadow.setAttribute("rx", 30 + lift * 6);
    this.shadow.setAttribute("opacity", (0.9 - lift * 0.45).toFixed(2));

    this.comLine.setAttribute("x1", po.hip.x); this.comLine.setAttribute("y1", po.hip.y - 40);
    this.comLine.setAttribute("x2", po.hip.x); this.comLine.setAttribute("y2", g.groundY);

    // 触地
    var c = po.contact;
    if (c) {
      var cy = Math.max(c.ay, c.ty);
      this.contactDot.setAttribute("opacity", ".95");
      this.contactDot.setAttribute("cx", c.ax); this.contactDot.setAttribute("cy", g.groundY);
      this.grf.setAttribute("opacity", ".9");
      this.grf.setAttribute("x1", c.ax); this.grf.setAttribute("y1", g.groundY - 2);
      this.grf.setAttribute("x2", c.ax); this.grf.setAttribute("y2", g.groundY - 34);
    } else {
      this.contactDot.setAttribute("opacity", "0");
      this.grf.setAttribute("opacity", "0");
    }
  };

  Runner.prototype._trajPath = function () {
    var d = [];
    for (var i = 0; i <= 48; i++) {
      var q = this._pose(i / 48);
      var pt = q.A.ax + "," + q.A.ay;
      d.push((i === 0 ? "M" : "L") + pt);
    }
    d.push("Z");
    this.traj.setAttribute("d", d.join(" "));
  };

  /* ------------------------------------------------------------- api */
  Runner.prototype.setParams = function (p) {
    for (var k in p) if (p[k] != null && isFinite(p[k])) this.params[k] = p[k];
    var P = this.params;
    var cycleMs = 120 / P.cadence * 1000;
    this.stanceFrac = clamp(P.gct / cycleMs, 0.14, 0.52);
    this.amp = {
      hip: map(P.stride, 0.9, 1.7, 21, 40),
      arm: map(P.stride, 0.9, 1.7, 12, 22),
      kneeStance: 16 + (P.cadence - 165) * 0.12,
      kneeSwing: map(P.cadence, 155, 190, 66, 88),
      bob: map(P.vo, 7, 12, 6, 15),
      lean: map(P.kmh, 8, 16, 4, 13),
      elbow: 84
    };
    this._trajPath();
    this._render();
    return this;
  };

  Runner.prototype._render = function () {
    var po = this._pose(this.phase);
    this._drawPose(po, true);
    this._drawPose(po, false);
    this.state = {
      hip: po.hipDeg, knee: po.kneeDeg,
      stance: po.inStance,
      phase: this.phase,
      stanceFrac: this.stanceFrac,
      flight: 1 - this.stanceFrac
    };
    if (this.onframe) this.onframe(this.state);
  };

  Runner.prototype.tick = function (dtMs) {
    var cyc = 120 / this.params.cadence * 1000;   // ms per full gait cycle
    this.phase = (this.phase + (dtMs * this.speed) / cyc) % 1;
    var v = this.params.stride * this.params.cadence / 60;   // m/s
    this.dashOffset -= v * GEO.pxPerM * (dtMs / 1000) * this.speed;
    this.groundDash.setAttribute("stroke-dashoffset", this.dashOffset);
    this._render();
  };

  Runner.prototype.play = function () {
    if (this._raf) return this;
    this.running = true;
    var self = this;
    var loop = function (t) {
      var dt = self._last ? Math.min(64, t - self._last) : 16;
      self._last = t;
      self.tick(dt);
      self._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
    return this;
  };
  Runner.prototype.pause = function () {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null; this._last = 0;
    return this;
  };
  Runner.prototype.toggle = function () { return this.running ? this.pause() : this.play(); };
  Runner.prototype.step = function (d) { this.phase = (this.phase + (d || 0.02) + 1) % 1; this._render(); return this; };

  global.Runner = Runner;
})(window);
