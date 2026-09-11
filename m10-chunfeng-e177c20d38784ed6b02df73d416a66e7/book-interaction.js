(() => {
  'use strict';
  const pages = [...document.querySelectorAll('.page')];
  const book = document.querySelector('#book');
  const experience = document.querySelector('#experience');
  const navigation = document.querySelector('.navigation');
  const previous = document.querySelector('#previousPage');
  const next = document.querySelector('#nextPage');
  const label = document.querySelector('#nextLabel');
  const counter = document.querySelector('#currentPage');
  const announcement = document.querySelector('#pageAnnouncement');
  const canvas = document.querySelector('#curlCanvas');
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (x, min = 0, max = 1) => Math.max(min, Math.min(max, x));
  const state = { index: 0, phase: 'idle', turn: null, pointer: null, raf: 0, token: 0 };
  let renderer = null;
  let renderQueued = false;
  let fallbackTimer = 0;

  try { renderer = new window.PaperCurl(canvas); }
  catch (error) { console.warn('Paper curl unavailable; using accessible page transitions.', error.message); }
  book.dataset.renderer = renderer ? 'curved-mesh' : 'simple';

  function controls(busy) {
    navigation.setAttribute('aria-busy', String(busy));
    book.setAttribute('aria-busy', String(busy));
    experience.classList.toggle('is-turning', busy);
    previous.disabled = state.index === 0;
    next.disabled = state.index === pages.length - 1;
    [previous, next].forEach(button => {
      if (busy) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    });
    label.textContent = state.index === pages.length - 2 ? '写到后来' : '翻页';
    counter.textContent = String(state.index + 1).padStart(2, '0');
    experience.style.setProperty('--page-index', state.index);
  }

  function settle(commit = false) {
    const turn = state.turn;
    ++state.token;
    cancelAnimationFrame(state.raf); clearTimeout(fallbackTimer);
    if (commit && turn) state.index = turn.target;
    state.phase = 'idle'; state.turn = null; state.pointer = null;
    canvas.classList.remove('is-active');
    book.classList.remove('is-curling');
    pages.forEach((page, index) => {
      page.classList.remove('is-under', 'is-mesh-source', 'is-fading');
      page.classList.toggle('is-current', index === state.index);
      page.setAttribute('aria-hidden', String(index !== state.index));
      page.toggleAttribute('inert', index !== state.index);
    });
    controls(false);
    announcement.textContent = `当前为第 ${state.index + 1} 页，共 ${pages.length} 页`;
    book.dataset.phase = 'idle';
    book.dataset.progress = '0';
    refreshScrollMode();
  }

  function refreshScrollMode() {
    if (state.phase !== 'idle') return;
    pages.forEach(page => {
      const sheet = page.querySelector('.sheet');
      sheet.classList.toggle('is-scrollable', sheet.scrollHeight > sheet.clientHeight + 3);
    });
  }

  function begin(direction, point, phase) {
    const target = state.index + direction;
    if (state.phase !== 'idle' || target < 0 || target >= pages.length) return false;
    const page = pages[state.index];
    const sheet = page.querySelector('.sheet');
    const rect = sheet.getBoundingClientRect();
    const grab = {
      x: clamp(point.x - rect.left, 3, rect.width - 3),
      y: clamp(point.y - rect.top, 3, rect.height - 3)
    };
    const turn = { direction, target, page, rect, grab, p: 0, dx: 0, dy: 0, commit: false, rich: Boolean(renderer && !motionQuery.matches) };
    const grabX = direction > 0 ? grab.x : rect.width - grab.x;
    turn.end = (2 * grabX + rect.width * 0.22) / (rect.width * 0.92);
    pages[target].querySelector('.sheet').scrollTop = 0;
    // Capture while the source still has its exact flat DOM layout.
    if (turn.rich) {
      try { renderer.begin(sheet, book.getBoundingClientRect(), direction, grab); }
      catch (error) {
        console.warn('Paper texture could not be prepared.', error.message);
        turn.rich = false;
      }
    }
    state.turn = turn; state.phase = phase;
    pages[target].classList.add('is-under');
    controls(true);
    if (turn.rich) {
      page.classList.add('is-mesh-source');
      book.classList.add('is-curling');
      canvas.classList.add('is-active');
    }
    book.dataset.phase = phase;
    return true;
  }

  function draw() {
    renderQueued = false;
    const turn = state.turn;
    if (!turn) return;
    if (turn.rich) renderer.draw(turn.p, turn.dx, turn.dy);
    book.dataset.progress = turn.p.toFixed(3);
  }

  function requestDraw() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(draw);
  }

  function animateTo(destination, automatic = false) {
    const turn = state.turn;
    if (!turn) return;
    state.phase = 'settling'; book.dataset.phase = 'settling';
    turn.commit = destination === 1;
    const token = ++state.token;
    if (!turn.rich) {
      if (destination === 0) return settle(false);
      turn.page.classList.add('is-fading');
      fallbackTimer = setTimeout(() => { if (token === state.token) settle(true); }, motionQuery.matches ? 160 : 320);
      return;
    }
    const goal = destination === 1 ? turn.end : 0;
    const start = turn.p, startDy = turn.dy, started = performance.now();
    const duration = automatic ? 1400 : clamp(Math.abs(goal - start) / turn.end * 1050, 320, 850);
    const tick = now => {
      if (token !== state.token || state.turn !== turn) return;
      const time = clamp((now - started) / duration);
      const eased = automatic ? time * time * time * (10 - 15 * time + 6 * time * time) : 1 - Math.pow(1 - time, 3);
      turn.p = start + (goal - start) * eased;
      // Release retains the contact height and gradually relaxes the diagonal pull.
      turn.dy = startDy * (1 - eased);
      draw();
      if (time < 1) state.raf = requestAnimationFrame(tick);
      else settle(destination === 1);
    };
    state.raf = requestAnimationFrame(tick);
  }

  function buttonTurn(direction) {
    const rect = pages[state.index].querySelector('.sheet').getBoundingClientRect();
    const point = { x: direction > 0 ? rect.right - 5 : rect.left + 5, y: rect.bottom - rect.height * 0.15 };
    if (!begin(direction, point, 'settling')) return false;
    animateTo(1, true);
    return true;
  }

  function down(id, x, y, time, target) {
    if (state.phase !== 'idle' || state.pointer || !target.closest('.sheet')) return false;
    if (!pages[state.index].contains(target)) return false;
    state.pointer = { id, x, y, lastX: x, lastTime: time, velocity: 0, time, scrolling: false };
    return true;
  }

  function move(id, x, y, time) {
    const pointer = state.pointer;
    if (!pointer || id !== pointer.id || pointer.scrolling) return false;
    const dx = x - pointer.x, dy = y - pointer.y;
    if (state.phase === 'idle') {
      if (Math.hypot(dx, dy) < 5) return false;
      if (Math.abs(dy) > Math.abs(dx) * 1.35) {
        pointer.scrolling = true;
        return false;
      }
      const direction = dx < 0 ? 1 : -1;
      if (!begin(direction, pointer, 'dragging')) return false;
    }
    if (state.phase !== 'dragging') return false;
    const elapsed = Math.max(1, time - pointer.lastTime);
    const sample = (x - pointer.lastX) / elapsed;
    pointer.velocity = sample * 0.7 + pointer.velocity * 0.3;
    pointer.lastX = x; pointer.lastTime = time;
    const turn = state.turn;
    turn.dx = dx; turn.dy = dy;
    turn.p = clamp(-dx * turn.direction / (turn.rect.width * 0.92), 0, turn.end);
    requestDraw();
    return true;
  }

  function up(id, x, y, time, cancelled) {
    const pointer = state.pointer;
    if (!pointer || pointer.id !== id) return;
    if (state.phase === 'dragging') {
      // A held half-open page has no fling velocity, even if the last move was fast.
      const velocity = time - pointer.lastTime > 110 ? 0 : -pointer.velocity * state.turn.direction;
      const p = state.turn.p;
      const threshold = Math.min(0.42, state.turn.end * 0.7);
      const commit = !cancelled && (p > threshold || (p > 0.08 && velocity > 0.45));
      state.pointer = null;
      animateTo(commit ? 1 : 0);
    } else state.pointer = null;
  }

  if ('PointerEvent' in window) {
    book.addEventListener('pointerdown', event => {
      if (!event.isPrimary && event.pointerType === 'touch') {
        if (state.pointer) up(state.pointer.id, 0, 0, event.timeStamp, true);
        return;
      }
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (down(event.pointerId, event.clientX, event.clientY, event.timeStamp, event.target)) {
        try { book.setPointerCapture(event.pointerId); } catch (_) { /* Capture is optional. */ }
      }
    });
    book.addEventListener('pointermove', event => {
      if (move(event.pointerId, event.clientX, event.clientY, event.timeStamp) && event.cancelable) event.preventDefault();
    }, { passive: false });
    book.addEventListener('pointerup', event => {
      up(event.pointerId, event.clientX, event.clientY, event.timeStamp, false);
      try { if (book.hasPointerCapture(event.pointerId)) book.releasePointerCapture(event.pointerId); } catch (_) {}
    });
    book.addEventListener('pointercancel', event => up(event.pointerId, event.clientX, event.clientY, event.timeStamp, true));
    book.addEventListener('lostpointercapture', event => {
      if (state.pointer?.id === event.pointerId) up(event.pointerId, 0, 0, event.timeStamp, true);
    });
  } else {
    book.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) {
        if (state.pointer) up(state.pointer.id, 0, 0, event.timeStamp, true);
        return;
      }
      const touch = event.touches[0];
      down(touch.identifier, touch.clientX, touch.clientY, event.timeStamp, event.target);
    }, { passive: true });
    book.addEventListener('touchmove', event => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (move(touch.identifier, touch.clientX, touch.clientY, event.timeStamp) && event.cancelable) event.preventDefault();
    }, { passive: false });
    ['touchend', 'touchcancel'].forEach(type => book.addEventListener(type, event => {
      for (const touch of event.changedTouches) up(touch.identifier, touch.clientX, touch.clientY, event.timeStamp, type === 'touchcancel');
    }, { passive: true }));
  }

  previous.addEventListener('click', () => buttonTurn(-1));
  next.addEventListener('click', () => buttonTurn(1));
  document.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]')) return;
    if (['ArrowRight', 'PageDown'].includes(event.key) && buttonTurn(1)) event.preventDefault();
    if (['ArrowLeft', 'PageUp'].includes(event.key) && buttonTurn(-1)) event.preventDefault();
    if (event.key === 'Escape' && state.turn) settle(false);
  });

  function interrupt() {
    if (state.turn) settle(state.phase === 'settling' && state.turn.commit);
    state.pointer = null;
  }
  window.addEventListener('blur', interrupt);
  window.addEventListener('pagehide', interrupt);
  document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); });
  window.addEventListener('resize', () => { interrupt(); requestAnimationFrame(refreshScrollMode); });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); interrupt(); renderer = null; book.dataset.renderer = 'simple';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try { renderer = new window.PaperCurl(canvas); book.dataset.renderer = 'curved-mesh'; }
    catch (_) { renderer = null; }
  });
  const preferenceChanged = () => {
    interrupt(); experience.classList.toggle('reduced-motion', motionQuery.matches);
  };
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', preferenceChanged);
  else motionQuery.addListener(preferenceChanged);
  if (document.fonts?.ready) document.fonts.ready.then(refreshScrollMode);
  preferenceChanged(); settle();
})();
