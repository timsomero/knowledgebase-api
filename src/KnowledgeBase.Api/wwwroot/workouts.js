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
  if (workout?.durationMinutes) f.duration.value = workout.durationMinutes;
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
    const body = {
      date: f.date.value || null,
      categoryId: selected.id,
      activity: isActivity ? f.activity.value || null : null,
      durationMinutes: isActivity && f.duration.value ? Number(f.duration.value) : null,
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
      form.elements.duration.value = '';
      form.elements.distance.value = '';
      form.elements.notes.value = '';
      form.querySelectorAll('.checks input').forEach((b) => { b.checked = false; });
      setStatus(status, 'Saved.');
      await loadRecentWorkouts();
    },
  });
  await loadRecentWorkouts();
}

function describeWorkout(w) {
  const title = w.kind === 'activity'
    ? `${w.activity}${w.durationMinutes ? ` · ${w.durationMinutes} min` : ''}${w.distanceMiles ? ` · ${w.distanceMiles} mi` : ''}`
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
