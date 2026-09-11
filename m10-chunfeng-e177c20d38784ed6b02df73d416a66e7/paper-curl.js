/* Continuous paper surface. No screenshots, network assets, or per-frame DOM clones. */
(() => {
  'use strict';

  const vertexSource = `
    precision highp float;
    attribute vec2 a_uv;
    uniform mediump vec2 u_size;
    uniform vec2 u_view, u_origin, u_shadowOffset, u_normal, u_cameraCentre;
    uniform float u_crease, u_radius, u_angle, u_direction;
    uniform mediump float u_shadow;
    varying mediump vec2 v_uv;
    varying mediump vec3 v_normal;
    varying mediump float v_height;
    const float PI = 3.141592653589793;

    void main() {
      vec2 q = a_uv * u_size;
      if (u_direction < 0.0) q.x = u_size.x - q.x;
      vec2 n = u_normal;
      float d = dot(q, n) - u_crease;
      float radius = u_radius;
      float theta = clamp(d / radius, 0.0, u_angle);
      float arc = radius * theta;
      float tail = max(0.0, d - arc);
      float bent = radius * sin(theta) + tail * cos(theta);
      float z = radius * (1.0 - cos(theta)) + tail * sin(theta);
      if (d > 0.0) q += n * (bent - d);
      else z = 0.0;
      vec3 normal = vec3(-n * sin(theta), cos(theta));
      if (u_direction < 0.0) {
        q.x = u_size.x - q.x;
        normal.x = -normal.x;
      }
      v_uv = a_uv;
      v_normal = normal;
      v_height = z;

      vec2 world = u_origin + q;
      float depth = z;
      if (u_shadow > 0.5) {
        world += vec2(0.21 * u_direction, 0.16) * z + u_shadowOffset;
        depth = 0.0;
      }
      // A modest perspective keeps a tall phone's lifted page inside the view.
      float camera = max(1250.0, u_size.x * 4.2);
      vec2 centre = u_origin + u_cameraCentre;
      world = centre + (world - centre) * camera / (camera - depth);
      gl_Position = vec4(world.x / u_view.x * 2.0 - 1.0,
        1.0 - world.y / u_view.y * 2.0, -depth / 1000.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision mediump float;
    uniform sampler2D u_front;
    uniform mediump vec2 u_size;
    uniform mediump float u_shadow, u_shadowAlpha;
    varying mediump vec2 v_uv;
    varying mediump vec3 v_normal;
    varying mediump float v_height;

    float paperMask(vec2 xy) {
      float r = xy.x < u_size.x * 0.5
        ? (xy.y < u_size.y * 0.5 ? 3.0 : 30.0)
        : (xy.y < u_size.y * 0.5 ? 42.0 : 5.0);
      vec2 corner = clamp(xy, vec2(r), u_size - vec2(r));
      float sdf = length(xy - corner) - r;
      return 1.0 - smoothstep(-0.65, 0.65, sdf);
    }

    void main() {
      vec2 xy = v_uv * u_size;
      float mask = paperMask(xy);
      if (mask < 0.01) discard;
      if (u_shadow > 0.5) {
        // Only raised paper casts a shadow, so the stationary section stays clean.
        float a = mask * u_shadowAlpha * smoothstep(1.0, 18.0, v_height);
        gl_FragColor = vec4(0.065, 0.14, 0.085, a);
        return;
      }
      vec3 normal = normalize(v_normal);
      bool front = gl_FrontFacing;
      vec3 facingNormal = front ? normal : -normal;
      vec3 color = texture2D(u_front, v_uv).rgb;
      if (!front) {
        color = mix(vec3(0.935, 0.956, 0.844), vec3(0.982, 0.982, 0.914), v_uv.x);
        float edge = min(min(xy.x, u_size.x - xy.x), min(xy.y, u_size.y - xy.y));
        color -= vec3(0.02, 0.026, 0.014) * exp(-edge / 8.0);
      }
      vec3 light = normalize(vec3(-0.36, -0.30, 0.89));
      float diffuse = max(0.0, dot(facingNormal, light));
      float shading = 0.72 + 0.28 * diffuse / light.z;
      float curvature = pow(1.0 - abs(normal.z), 1.5);
      float silk = pow(max(0.0, dot(facingNormal, normalize(vec3(-0.18, -0.12, 0.97)))), 24.0);
      color = color * shading + vec3(0.042) * silk * curvature;
      float grain = fract(sin(dot(mod(floor(xy * 1.4), vec2(97.0, 89.0)), vec2(0.123, 0.456))) * 173.0);
      color += (grain - 0.5) * 0.009;
      gl_FragColor = vec4(color, mask);
    }
  `;

  function roundedRect(ctx, x, y, w, h, radii) {
    const [tl, tr, br, bl] = radii;
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
    ctx.lineTo(x + w, y + h - br); ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    ctx.lineTo(x + bl, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
    ctx.lineTo(x, y + tl); ctx.quadraticCurveTo(x, y, x + tl, y); ctx.closePath();
  }

  // Paint from live glyph positions, including vertical Chinese and enlarged text.
  // The semantic DOM remains the source of truth; the bitmap exists only while curling.
  function snapshotPaper(sheet, width, height) {
    const scale = Math.min(2.5, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    const base = sheet.getBoundingClientRect();
    const paperStyle = getComputedStyle(sheet);
    ctx.fillStyle = paperStyle.backgroundColor; ctx.fillRect(0, 0, width, height);
    const stops = paperStyle.backgroundImage.match(/linear-gradient\(([-\d.]+)deg,\s*(rgba?\([^)]+\)),\s*(rgba?\([^)]+\))\)/);
    if (stops) {
      const angle = Number(stops[1]) * Math.PI / 180;
      const dx = Math.sin(angle), dy = -Math.cos(angle);
      const length = Math.abs(width * dx) + Math.abs(height * dy);
      const gradient = ctx.createLinearGradient(width / 2 - dx * length / 2, height / 2 - dy * length / 2,
        width / 2 + dx * length / 2, height / 2 + dy * length / 2);
      gradient.addColorStop(0, stops[2]); gradient.addColorStop(1, stops[3]);
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    }
    ctx.strokeStyle = 'rgba(60,104,68,0.10)'; ctx.lineWidth = 1;
    roundedRect(ctx, 13, 13, width - 26, height - 26, [1, 31, 3, 21]); ctx.stroke();

    const walker = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim()) continue;
      const element = node.parentElement;
      const style = getComputedStyle(element);
      if (style.display === 'none') continue;
      const fontSize = parseFloat(style.fontSize);
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ctx.fillStyle = style.color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      const vertical = style.writingMode.startsWith('vertical');
      let offset = 0;
      for (const character of node.textContent) {
        range.setStart(node, offset); offset += character.length; range.setEnd(node, offset);
        if (!character.trim()) continue;
        const box = range.getBoundingClientRect();
        if (box.width < 0.1 || box.height < 0.1) continue;
        const x = box.left - base.left, y = box.top - base.top;
        if (y + box.height < 0 || y > height) continue;
        const metrics = ctx.measureText(character);
        const ascent = metrics.fontBoundingBoxAscent || fontSize * 0.88;
        const descent = metrics.fontBoundingBoxDescent || fontSize * 0.12;
        const baseline = y + (box.height - ascent - descent) * 0.5 + ascent;
        const drawX = vertical ? x + (box.width - metrics.width) * 0.5 : x;
        ctx.fillText(character, drawX, baseline);
      }
    }
    const kicker = sheet.querySelector('.kicker');
    if (kicker) {
      const box = kicker.getBoundingClientRect();
      ctx.fillStyle = '#b58b45'; ctx.fillRect(box.left - base.left, box.bottom - base.top - 1, 34, 1);
    }
    return canvas;
  }

  class PaperCurl {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', {
        alpha: true, antialias: true, premultipliedAlpha: true,
        preserveDrawingBuffer: false, depth: true, powerPreference: 'default'
      });
      if (!gl) throw new Error('WebGL unavailable');
      this.gl = gl;
      const compile = (type, source) => {
        const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      const vertex = compile(gl.VERTEX_SHADER, vertexSource);
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      this.program = gl.createProgram();
      gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      gl.deleteShader(vertex); gl.deleteShader(fragment); gl.useProgram(this.program);
      this.uniforms = {};
      ['size', 'view', 'origin', 'normal', 'cameraCentre', 'crease', 'radius', 'angle', 'direction', 'shadow', 'shadowOffset', 'shadowAlpha', 'front'].forEach(name => {
        this.uniforms[name] = gl.getUniformLocation(this.program, 'u_' + name);
      });
      // 96 x 96 cells keep diagonal creases smooth without individual DOM strips.
      const columns = 96, rows = 96, vertices = [], indices = [];
      for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) vertices.push(x / columns, y / rows);
      for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
        const i = y * (columns + 1) + x;
        indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2);
      }
      this.vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(this.program, 'a_uv');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.indexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
      this.count = indices.length;
      this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE); gl.depthFunc(gl.LEQUAL);
    }

    begin(sheet, frame, direction, grab, opened = false) {
      const gl = this.gl, rect = sheet.getBoundingClientRect();
      this.width = rect.width; this.height = rect.height;
      this.origin = [rect.left - frame.left, rect.top - frame.top];
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(frame.width * ratio); this.canvas.height = Math.round(frame.height * ratio);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.program);
      const texture = snapshotPaper(sheet, rect.width, rect.height);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture);
      gl.uniform1i(this.uniforms.front, 0);
      gl.uniform2f(this.uniforms.view, frame.width, frame.height);
      gl.uniform2f(this.uniforms.size, rect.width, rect.height);
      gl.uniform2f(this.uniforms.origin, ...this.origin);
      gl.uniform1f(this.uniforms.direction, direction);
      this.grab = { x: direction > 0 ? grab.x : rect.width - grab.x, y: grab.y };
      this.direction = direction;
      this.end = (2 * this.grab.x + rect.width * 0.22) / (rect.width * 0.92);
      // A returning leaf starts already turned to the left, then unrolls to zero.
      this.draw(opened ? this.end : 0, 0, 0);
    }

    draw(progress, dx, dy) {
      const gl = this.gl, u = this.uniforms;
      if (gl.isContextLost()) return;
      const w = this.width, h = this.height, grab = this.grab;
      const phase = Math.max(0, Math.min(1, progress / this.end));
      const radius = w * (0.016 + 0.164 * Math.pow(1 - phase, 0.75));
      const camera = Math.max(1250, w * 4.2);
      // Begin perspective at the contact, then ease to the page centre. This
      // avoids an initial pop when a corner first lifts off the flat sheet.
      const enter = Math.min(1, progress / 0.12);
      const blend = enter * enter * (3 - 2 * enter);
      const cx = grab.x + (w / 2 - grab.x) * blend;
      const cy = grab.y + (h / 2 - grab.y) * blend;
      const finger = { x: grab.x - progress * w * 0.92, y: grab.y + dy };
      let z = 0, nx = 1, ny = 0, distance = 0, angle = 0;
      // Solve the material point against the actual finger, including perspective.
      // The inverse arc equation is monotonic, so bisection stays stable near zero.
      for (let iteration = 0; iteration < 12 && progress > 0; iteration++) {
        const qx = cx + (finger.x - cx) * (1 - z / camera);
        const qy = cy + (finger.y - cy) * (1 - z / camera);
        const pullX = grab.x - qx, pullY = grab.y - qy;
        const travel = Math.hypot(pullX, pullY);
        nx = pullX / Math.max(travel, 0.0001); ny = pullY / Math.max(travel, 0.0001);
        if (travel >= Math.PI * radius) {
          angle = Math.PI; distance = (travel + Math.PI * radius) / 2;
        } else {
          let low = 0, high = Math.PI;
          for (let step = 0; step < 18; step++) {
            const middle = (low + high) / 2;
            if (radius * (middle - Math.sin(middle)) < travel) low = middle;
            else high = middle;
          }
          angle = (low + high) / 2; distance = radius * angle;
        }
        z = radius * (1 - Math.cos(angle));
      }
      gl.uniform2f(u.normal, nx, ny);
      gl.uniform2f(u.cameraCentre, this.direction > 0 ? cx : w - cx, cy);
      gl.uniform1f(u.crease, grab.x * nx + grab.y * ny - distance);
      gl.uniform1f(u.radius, radius); gl.uniform1f(u.angle, angle);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.uniform1f(u.shadow, 1);
      const shadows = [[-5, -3, 0.027], [5, 3, 0.027], [-2, 2, 0.035], [2, -2, 0.035], [0, 0, 0.065]];
      for (const [x, y, alpha] of shadows) {
        gl.uniform2f(u.shadowOffset, x, y); gl.uniform1f(u.shadowAlpha, alpha);
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
      }
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.uniform1f(u.shadow, 0);
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    }

    clear() {
      const gl = this.gl;
      if (!gl.isContextLost()) gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
  }

  window.PaperCurl = PaperCurl;
})();
