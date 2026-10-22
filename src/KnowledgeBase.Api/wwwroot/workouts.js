// Workout screens: Log Workout (#workout), Edit workout (#workout/<id>) and Config (#workout/config).
// Uses $, api, showError, formatDue and route from app.js.

let workoutConfig = null;
let logCategoryId = null;       // remembered between saves on Log Workout
let editOpenedFromLog = false;  // so Save/Delete on Edit can go "back" instead of adding history

const CHEVRON_RIGHT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadWorkoutConfig() {
  workoutConfig = await api('/workout-config');
  return workoutConfig;
}

function setStatus(el, message, isError = false) {
  el.textContent = message || '';
  el.classList.toggle('error', isError);
}

// ---------- the shared form (Log Workout and Edit workout) ----------

// Renders the form into `host`. `workout` pre-fills it (edit) or is null (log).
// `actions` builds the buttons; `onSubmit(body, status)` saves.
function renderWorkoutForm(host, { workout, categoryId, actions, onSubmit }) {
  const form = $('workout-form-template').content.firstElementChild.cloneNode(true);
  const f = form.elements;
  const status = form.querySelector('.form-status');

  // A workout whose category was removed from Config still shows it, so it can be edited as it was.
  const categories = [...workoutConfig.categories];
  if (workout && !categories.some((c) => c.id === workout.categoryId)) {
    categories.push({ id: workout.categoryId, name: workout.categoryName, kind: workout.kind, items: [] });
  }

  let selected = categories.find((c) => c.id === (workout?.categoryId ?? categoryId)) ?? categories[0];

  f.date.value = workout?.date ?? todayString();
  f.notes.value = workout?.notes ?? '';
  if (workout?.durationMinutes) {
    f.hours.value = Math.floor(workout.durationMinutes / 60) || '';
    f.minutes.value = workout.durationMinutes % 60 || '';
  }

  // Quick picks fill in the boxes; the one matching what's typed is shown as picked.
  const presets = form.querySelector('.duration-presets');
  const showPicked = () => {
    const minutes = durationMinutes(f);
    for (const chip of presets.children) chip.setAttribute('aria-pressed', String(Number(chip.dataset.minutes) === minutes));
  };
  presets.append(...DURATION_PRESETS.map((minutes) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.minutes = minutes;
    chip.textContent = formatDuration(minutes);
    chip.addEventListener('click', () => {
      f.hours.value = Math.floor(minutes / 60) || '';
      f.minutes.value = minutes % 60 || '';
      showPicked();
    });
    return chip;
  }));
  f.hours.addEventListener('input', showPicked);
  f.minutes.addEventListener('input', showPicked);
  showPicked();
  if (workout?.distanceMiles) f.distance.value = workout.distanceMiles;

  const chips = form.querySelector('.categories');
  const buttons = new Map();
  for (const c of categories) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = c.name;
    b.addEventListener('click', () => {
      selected = c;
      showCategory();
    });
    buttons.set(c, b);
    chips.append(b);
  }

  function showCategory() {
    for (const [c, b] of buttons) b.setAttribute('aria-pressed', String(c === selected));
    const isActivity = selected.kind === 'activity';
    form.querySelector('.activity-fields').hidden = !isActivity;
    form.querySelector('.checklist-fields').hidden = isActivity;
    setStatus(status, '');

    if (isActivity) {
      // Keep a logged activity that has since been removed from Config.
      const options = [...selected.items];
      if (workout?.activity && workout.categoryId === selected.id && !options.includes(workout.activity)) {
        options.unshift(workout.activity);
      }
      const previous = f.activity.value;
      f.activity.replaceChildren(...options.map((o) => new Option(o, o)));
      f.activity.value = workout?.categoryId === selected.id && workout.activity ? workout.activity
        : options.includes(previous) ? previous : options[0] ?? '';
      form.querySelector('.activity-label').hidden = options.length === 0;
      form.querySelector('.distance-label').hidden = !hasDistance(selected);
      form.querySelector('.no-activities').hidden = options.length > 0;
    } else {
      form.querySelector('legend').textContent = selected.id === 'weights' ? 'Muscle groups (pick any)' : 'Pick any';
      const ticked = workout?.categoryId === selected.id ? workout.items : [];
      const items = [...selected.items, ...ticked.filter((i) => !selected.items.includes(i))];
      form.querySelector('.checks').replaceChildren(...items.map((item) => {
        const label = document.createElement('label');
        label.className = 'check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.name = 'items';
        box.value = item;
        box.checked = ticked.includes(item);
        label.append(box, item);
        return label;
      }));
    }
  }

  form.querySelector('.form-actions').append(...actions(form, status));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isActivity = selected.kind === 'activity';
    const duration = isActivity ? durationMinutes(f) : null;
    if (isActivity && !(duration >= 1 && duration <= 1440))
      return setStatus(status, 'Enter how long it took, up to 24 hours.', true);
    const body = {
      date: f.date.value || null,
      categoryId: selected.id,
      activity: isActivity ? f.activity.value || null : null,
      durationMinutes: duration,
      distanceMiles: isActivity && hasDistance(selected) && f.distance.value ? Number(f.distance.value) : null,
      items: isActivity ? [] : [...form.querySelectorAll('.checks input:checked')].map((b) => b.value),
      notes: f.notes.value.trim() || null,
    };
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      await onSubmit(body, status, selected);
    } catch (err) {
      setStatus(status, err.message, true);
    } finally {
      submit.disabled = false;
    }
  });

  // Distance is offered on Cardio, and on any workout that already has one.
  function hasDistance(category) {
    return category.id === 'cardio' || (workout?.categoryId === category.id && workout.distanceMiles != null);
  }

  showCategory();
  host.replaceChildren(form);
  return form;
}

function primaryButton(text) {
  const b = document.createElement('button');
  b.type = 'submit';
  b.className = 'primary';
  b.textContent = text;
  return b;
}

// ---------- Log Workout ----------

async function showWorkoutLog() {
  try {
    await loadWorkoutConfig();
  } catch (err) {
    return showError(err);
  }

  renderWorkoutForm($('log-form'), {
    workout: null,
    categoryId: logCategoryId,
    actions: () => [primaryButton('Save workout')],
    onSubmit: async (body, status, category) => {
      await api('/workouts', { method: 'POST', body: JSON.stringify(body) });
      // Keep the date, category and activity so a second workout for the same day is quick.
      logCategoryId = category.id;
      const form = $('log-form').querySelector('form');
      form.elements.hours.value = '';
      form.elements.minutes.value = '';
      form.querySelectorAll('.duration-presets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      form.elements.distance.value = '';
      form.elements.notes.value = '';
      form.querySelectorAll('.checks input').forEach((b) => { b.checked = false; });
      setStatus(status, 'Saved.');
      await loadRecentWorkouts();
    },
  });
  await loadRecentWorkouts();
  maybeShowStreak();
}

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

// Total minutes from the Hours and Minutes boxes; null when both are empty. Minutes over 59 are fine
// ("90" means 1 h 30 min).
function durationMinutes(f) {
  if (!f.hours.value && !f.minutes.value) return null;
  return Math.round(Number(f.hours.value || 0) * 60 + Number(f.minutes.value || 0));
}

// 45 → "45 min", 60 → "1 h", 85 → "1 h 25 min".
function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

function describeWorkout(w) {
  const title = w.kind === 'activity'
    ? `${w.activity}${w.durationMinutes ? ` · ${formatDuration(w.durationMinutes)}` : ''}${w.distanceMiles ? ` · ${w.distanceMiles} mi` : ''}`
    : w.categoryName;
  const meta = [formatDue(w.date)];
  if (w.kind === 'checklist' && w.items.length) meta.push(w.items.join(', '));
  if (w.notes) meta.push('Notes');
  return { title, meta: meta.join(' · ') };
}

async function loadRecentWorkouts() {
  let workouts;
  try {
    workouts = await api('/workouts?limit=15');
  } catch (err) {
    return showError(err);
  }
  $('recent-workouts').replaceChildren(...workouts.map((w) => {
    const { title, meta } = describeWorkout(w);
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#workout/${w.id}`;
    a.addEventListener('click', () => { editOpenedFromLog = true; });
    const text = document.createElement('span');
    const t = document.createElement('span');
    t.className = 'title';
    t.textContent = title;
    const m = document.createElement('span');
    m.className = 'meta';
    m.textContent = meta;
    text.append(t, m);
    a.append(text);
    a.insertAdjacentHTML('beforeend', CHEVRON_RIGHT);
    li.append(a);
    return li;
  }));
  $('no-workouts').hidden = workouts.length > 0;
}

// ---------- Edit workout ----------

function leaveEdit() {
  if (editOpenedFromLog) history.back();
  else location.replace('#workout');
  editOpenedFromLog = false;
}

async function showWorkoutEdit(id) {
  $('edit-form').replaceChildren();
  let workout;
  try {
    [workout] = await Promise.all([api(`/workouts/${encodeURIComponent(id)}`), loadWorkoutConfig()]);
  } catch (err) {
    return showError(err.message.includes('404') ? new Error('That workout no longer exists.') : err);
  }

  renderWorkoutForm($('edit-form'), {
    workout,
    actions: (form, status) => {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'danger';
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        if (!confirm('Delete this workout?')) return;
        try {
          await api(`/workouts/${workout.id}`, { method: 'DELETE' });
          leaveEdit();
        } catch (err) {
          setStatus(status, err.message, true);
        }
      });
      return [del, primaryButton('Save changes')];
    },
    onSubmit: async (body) => {
      await api(`/workouts/${workout.id}`, { method: 'PUT', body: JSON.stringify(body) });
      leaveEdit();
    },
  });
}

// ---------- Config ----------

async function showWorkoutConfig() {
  setStatus($('config-status'), '');
  try {
    await loadWorkoutConfig();
  } catch (err) {
    return showError(err);
  }
  renderConfig();
}

// Saves the whole config after each change; on failure the page goes back to what is saved.
async function saveConfig(categories, message) {
  const status = $('config-status');
  try {
    workoutConfig = await api('/workout-config', { method: 'PUT', body: JSON.stringify({ categories }) });
    setStatus(status, message);
    renderConfig();
    return true;
  } catch (err) {
    setStatus(status, err.message, true);
    renderConfig();
    return false;
  }
}

function withCategory(id, change) {
  return workoutConfig.categories.map((c) => (c.id === id ? change(c) : c));
}

function renderConfig() {
  $('config-categories').replaceChildren(...workoutConfig.categories.map((c) => {
    const section = document.createElement('section');
    section.className = 'config-category';

    const h = document.createElement('h3');
    h.textContent = c.name;
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = c.kind === 'activity' ? ' · activities' : c.id === 'weights' ? ' · muscle groups' : ' · items';
    h.append(kind);

    const list = document.createElement('ul');
    list.className = 'config-items';
    list.replaceChildren(...c.items.map((item) => {
      const li = document.createElement('li');
      li.append(item);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${item}`);
      remove.addEventListener('click', () =>
        saveConfig(withCategory(c.id, (x) => ({ ...x, items: x.items.filter((i) => i !== item) })), `Removed ${item}.`));
      li.append(remove);
      return li;
    }));
    if (c.items.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'None yet.';
      list.append(li);
    }

    const add = document.createElement('form');
    add.className = 'row add-item';
    const input = document.createElement('input');
    input.placeholder = c.kind === 'activity' ? 'Add activity…' : c.id === 'weights' ? 'Add muscle group…' : 'Add item…';
    input.setAttribute('aria-label', `Add to ${c.name}`);
    input.maxLength = 60;
    input.autocomplete = 'off';
    const addButton = document.createElement('button');
    addButton.type = 'submit';
    addButton.textContent = 'Add';
    add.append(input, addButton);
    add.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      if (c.items.some((i) => i.toLowerCase() === name.toLowerCase())) {
        return setStatus($('config-status'), `${c.name} already has ${name}.`, true);
      }
      saveConfig(withCategory(c.id, (x) => ({ ...x, items: [...x.items, name] })), `Added ${name}.`);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link danger-link';
    remove.textContent = `Delete ${c.name} category`;
    remove.addEventListener('click', () => {
      if (!confirm(`Delete the ${c.name} category? Workouts already logged in it are kept.`)) return;
      saveConfig(workoutConfig.categories.filter((x) => x.id !== c.id), `Deleted ${c.name}.`);
    });

    section.append(h, list, add, remove);
    return section;
  }));
}

$('add-category').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const name = form.elements.name.value.trim();
  if (!name) return;
  const added = await saveConfig(
    [...workoutConfig.categories, { id: null, name, kind: form.elements.kind.value, items: [] }],
    `Added the ${name} category.`);
  if (added) form.reset();
});

// ---------- streak badge ----------

// Shown every time Log Workout opens, as long as a workout was logged yesterday.
const FLAME = '<svg class="streak-flame" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.6 2.2c.5 3.3 3 5 4.4 7.3a6.4 6.4 0 0 1-5 10.3 6 6 0 0 1-6-6c0-2.5 1.3-4.4 3-5.8-.1 1.8.6 3.3 2 4 .2-3.6.4-6.6 1.6-9.8z"/></svg>';

async function maybeShowStreak() {
  const today = todayString();
  let streak;
  try {
    streak = await api(`/workouts/streak?today=${today}`);
  } catch {
    return; // a streak is a bonus; never show an error for it
  }
  if (!streak.loggedYesterday || $('workout').hidden) return;

  showStreakBadge(streak.days, streakSubtitle(streak));
}

function streakSubtitle(s) {
  const since = formatDue(s.since);
  if (s.loggedToday) return `Every day since ${since}, including today.`;
  return s.days === 1
    ? 'You worked out yesterday. Log today to make it 2.'
    : `Every day since ${since}. Log today to make it ${s.days + 1}.`;
}

function showStreakBadge(days, subtitle) {
  document.querySelector('.streak-overlay')?.remove();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const overlay = document.createElement('div');
  overlay.className = 'streak-overlay';
  overlay.innerHTML = `
    <canvas class="streak-confetti" aria-hidden="true"></canvas>
    <div class="streak-card" role="status" aria-live="polite" tabindex="-1">
      <div class="streak-medal" aria-hidden="true">
        <div class="streak-ring"></div>
        <div class="streak-face">${FLAME}<span class="streak-num">${reduced ? days : 1}</span></div>
      </div>
      <p class="streak-title">${days} Day Streak!</p>
      <p class="streak-sub"></p>
      <button type="button" class="streak-close">Keep it going</button>
    </div>`;
  overlay.querySelector('.streak-sub').textContent = subtitle;
  document.body.append(overlay);

  const close = () => {
    window.removeEventListener('hashchange', close);
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 220);
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.streak-close')) close();
  });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('hashchange', close);
  overlay.querySelector('.streak-card').focus({ preventScroll: true });

  if (reduced) return;

  // Count the medal up to the streak.
  const num = overlay.querySelector('.streak-num');
  const startTime = performance.now();
  const countFor = Math.min(900, 250 + days * 40);
  (function count(t) {
    const p = Math.min(1, (t - startTime) / countFor);
    num.textContent = Math.max(1, Math.round(1 + (days - 1) * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(count);
  })(startTime);

  // Confetti: one burst from the medal, then two cannons from the bottom corners.
  const box = overlay.getBoundingClientRect();
  const medal = overlay.querySelector('.streak-medal').getBoundingClientRect();
  const cx = medal.left - box.left + medal.width / 2;
  const cy = medal.top - box.top + medal.height / 2;
  const extra = days >= 7 ? 1.5 : 1;
  confetti(overlay.querySelector('.streak-confetti'), [
    { x: cx, y: cy, count: Math.round(90 * extra), angle: -Math.PI / 2, spread: Math.PI * 1.4, speed: [5, 12], delay: 120 },
    { x: 0, y: box.height, count: Math.round(45 * extra), angle: -Math.PI / 3, spread: 0.6, speed: [11, 17], delay: 260 },
    { x: box.width, y: box.height, count: Math.round(45 * extra), angle: -Math.PI * 2 / 3, spread: 0.6, speed: [11, 17], delay: 260 },
  ]);
}

function confetti(canvas, bursts) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const css = getComputedStyle(canvas);
  const colors = [1, 2, 3, 4, 5].map((i) => css.getPropertyValue(`--confetti-${i}`).trim());
  const rand = (a, b) => a + Math.random() * (b - a);
  const pieces = [];
  for (const b of bursts) {
    for (let i = 0; i < b.count; i++) {
      const angle = b.angle + rand(-b.spread / 2, b.spread / 2);
      const speed = rand(b.speed[0], b.speed[1]);
      pieces.push({
        x: b.x, y: b.y, born: b.delay,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        w: rand(6, 11), h: rand(3, 6), r: rand(0, Math.PI * 2), vr: rand(-0.25, 0.25),
        color: colors[i % colors.length], round: Math.random() < 0.25,
      });
    }
  }

  const start = performance.now();
  (function frame(t) {
    const ms = t - start;
    ctx.clearRect(0, 0, w, h);
    const fade = ms > 2400 ? Math.max(0, 1 - (ms - 2400) / 700) : 1;
    let alive = false;
    for (const p of pieces) {
      if (ms < p.born) { alive = true; continue; }
      p.vx *= 0.986;
      p.vy = p.vy * 0.986 + 0.3;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      if (p.y > h + 20) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.h * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.scale(1, Math.cos(p.r * 2)); // flutter
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (alive && fade > 0 && canvas.isConnected) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, w, h);
  })(start);
}
