(function () {
  'use strict';

  var trigger = document.getElementById('cv-access-trigger');
  var dialog = document.getElementById('cv-password-dialog');
  var form = document.getElementById('cv-password-form');
  var input = document.getElementById('cv-password-input');
  var error = document.getElementById('cv-password-error');
  var cancel = document.getElementById('cv-password-cancel');

  if (!trigger || !dialog || !form || !input || !error || !cancel) return;

  var pointerStart = null;
  var lastTap = null;
  var maxTapDistance = 24;

  function showPasswordDialog() {
    pointerStart = null;
    lastTap = null;
    if (dialog.open) return;
    form.reset();
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    dialog.showModal();
    input.focus();
  }

  trigger.addEventListener('dblclick', function (event) {
    event.preventDefault();
    showPasswordDialog();
  });

  trigger.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      showPasswordDialog();
    }
  });

  // Recognize two short, nearby taps without intercepting page scrolling.
  trigger.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp
    };
  });

  trigger.addEventListener('pointermove', function (event) {
    if (pointerStart && pointerStart.id === event.pointerId &&
        Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > maxTapDistance) {
      pointerStart = null;
      lastTap = null;
    }
  });

  trigger.addEventListener('pointercancel', function () {
    pointerStart = null;
    lastTap = null;
  });

  trigger.addEventListener('pointerup', function (event) {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    var start = pointerStart;
    pointerStart = null;
    if (event.timeStamp - start.time > 500 ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > maxTapDistance) {
      lastTap = null;
      return;
    }
    if (lastTap && event.timeStamp - lastTap.time <= 400 &&
        Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= maxTapDistance) {
      event.preventDefault();
      showPasswordDialog();
      return;
    }
    lastTap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
  });

  cancel.addEventListener('click', function () {
    dialog.close();
  });

  dialog.addEventListener('close', function () {
    form.reset();
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    trigger.focus({ preventScroll: true });
  });

  input.addEventListener('input', function () {
    error.textContent = '';
    input.removeAttribute('aria-invalid');
  });

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    // This is a convenience gate only; GitHub Pages files remain public.
    if (input.value === '0713') {
      dialog.close();
      window.location.assign('../doc/CV_template.pdf');
      return;
    }
    error.textContent = '密码错误，请重试。';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    input.select();
  });
})();
