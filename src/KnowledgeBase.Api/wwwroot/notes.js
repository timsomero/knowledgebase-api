// Notes, like Apple Notes: the notebook button next to the Idea catcher opens all notes (#notes), pinned
// first and then the most recently changed, with search and a row of folders. A note (#note/<id>, or
// #note/new) is one big box whose first line is its title, a folder you can change, a pin, links and photos.
// Saving a new note opens the Save panel: Claude tidies it up and suggests a folder, or you save it as
// typed without a folder (Unfiled) to sort later. Tidy up does the same for a note you already have.
// Uses $, api, config, showError, showToast and isNew from app.js; formatWhen, findLinks, linkTo and
// shortLink from projects.js; shrink, openViewer and MAX_PHOTOS from photos.js; setStatus from workouts.js.

let notes = [];
let noteFolder = ''; // the folder shown in the list: '' all, '\u0000' Unfiled, else a folder's name
const UNFILED = '\u0000';
let noteId = null; // the note on screen; null for a new one
let noteSaved = { text: '', folder: '', pinned: false }; // what is saved, to tell whether there are changes
let notePinned = false;
let newNotePhotos = []; // photos picked for a new note: [{ key, url, file }], uploaded once it is saved
const noteUploads = new Map(); // photos uploading, by note id: [{ key, url }]

const NOTE_DRAFT_KEY = 'kb_note_draft'; // a new note is kept on the device until it is saved
const readNoteDraft = () => {
  try { return JSON.parse(localStorage.getItem(NOTE_DRAFT_KEY)) ?? null; } catch { return null; }
};
const writeNoteDraft = (draft) => {
  try {
    if (draft) localStorage.setItem(NOTE_DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(NOTE_DRAFT_KEY);
  } catch { /* storage unavailable */ }
};

const noteTitle = (note) => (note.text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 100) || 'New note';
const noteSnippet = (note) => note.text.split('\n').filter((l) => l.trim()).slice(1).join(' ').trim();
const notePhotoUrl = (id, photoId, thumb) => `/notes/${id}/photos/${photoId}${thumb ? '?size=thumb' : ''}`;

// Every folder in use, A to Z.
function noteFolders() {
  return [...new Set(notes.map((n) => n.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function replaceNote(updated) {
  notes = notes.some((n) => n.id === updated.id) ? notes.map((n) => (n.id === updated.id ? updated : n)) : [updated, ...notes];
}

// ---------- all notes ----------

async function showNotes() {
  renderNotes();
  try {
    notes = await api('/notes');
    renderNotes();
  } catch (err) {
    showError(err);
  }
}

function renderNotes() {
  const folders = noteFolders();
  if (noteFolder && noteFolder !== UNFILED && !folders.includes(noteFolder)) noteFolder = '';
  const unfiled = notes.filter((n) => !n.folder).length;
  const choices = [['', `All ${notes.length}`], ...folders.map((f) => [f, `${f} ${notes.filter((n) => n.folder === f).length}`])];
  if (unfiled) choices.push([UNFILED, `Unfiled ${unfiled}`]);
  $('note-folders').replaceChildren(...choices.map(([value, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === noteFolder));
    b.textContent = label;
    b.addEventListener('click', () => { noteFolder = value; renderNotes(); });
    return b;
  }));
  $('note-folders').hidden = notes.length === 0;

  const words = $('notes-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = notes
    .filter((n) => !noteFolder || (noteFolder === UNFILED ? !n.folder : n.folder === noteFolder))
    .filter((n) => words.every((w) => `${n.text}\n${n.folder ?? ''}`.toLowerCase().includes(w)))
    .sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updatedAt) - new Date(a.updatedAt)));

  const items = [];
  const anyPinned = shown.some((n) => n.pinned);
  shown.forEach((note, i) => {
    if (anyPinned && (i === 0 || note.pinned !== shown[i - 1].pinned)) {
      const head = document.createElement('li');
      head.className = 'notes-section';
      head.textContent = note.pinned ? 'Pinned' : 'Notes';
      items.push(head);
    }
    items.push(noteRow(note));
  });
  $('notes-list').replaceChildren(...items);
  $('no-notes').hidden = shown.length > 0;
  $('no-notes').textContent = notes.length ? 'No notes match.' : 'No notes yet. Tap New note to write your first one.';
}

function noteRow(note) {
  const li = document.createElement('li');
  li.classList.toggle('is-new', isNew(note));
  const link = document.createElement('a');
  link.href = `#note/${note.id}`;
  const title = document.createElement('span');
  title.className = 'idea-title';
  if (note.pinned) title.append(pinIcon());
  title.append(noteTitle(note));
  const sub = document.createElement('span');
  sub.className = 'idea-sub';
  const text = document.createElement('span');
  text.className = 'idea-sub-text';
  text.textContent = [formatWhen(note.updatedAt), noteFolder ? '' : note.folder, noteSnippet(note)].filter(Boolean).join(' · ');
  sub.append(text);
  if (note.photos.length) {
    const count = document.createElement('span');
    count.className = 'note-photo-count';
    count.textContent = note.photos.length;
    count.setAttribute('aria-label', `${note.photos.length} photo${note.photos.length > 1 ? 's' : ''}`);
    sub.append(count);
  }
  link.append(title, sub);
  li.append(link);
  return li;
}

function pinIcon() {
  const span = document.createElement('span');
  span.className = 'pin-icon';
  span.setAttribute('aria-label', 'Pinned');
  span.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 3l7 7-3 1-4 4 1 5-2 1-4-5-5 5-1-1 5-5-5-4 1-2 5 1 4-4z"/></svg>';
  return span;
}

$('notes-search').addEventListener('input', renderNotes);

// ---------- one note ----------

async function showNote(id) {
  const f = $('note-form').elements;
  noteId = id === 'new' ? null : id;
  setStatus($('note-status'), '');
  $('note-delete').hidden = !noteId;
  $('note-tidy').hidden = !noteId || !config.assistant;
  $('note-stamp').textContent = '';
  if (!notes.length) notes = await api('/notes').catch(() => []);

  if (!noteId) {
    const draft = readNoteDraft();
    newNotePhotos.forEach((p) => URL.revokeObjectURL(p.url));
    newNotePhotos = [];
    noteSaved = { text: '', folder: '', pinned: false };
    f.text.value = draft?.text ?? '';
    notePinned = !!draft?.pinned;
    fillFolderSelect(draft?.folder ?? (noteFolder !== UNFILED ? noteFolder : ''));
    $('note-stamp').textContent = 'New note';
    renderNoteExtras();
    markNoteSaved();
    if (!f.text.value) f.text.focus();
    return;
  }

  $('note-form').classList.add('is-loading');
  let note;
  try {
    note = await api(`/notes/${noteId}`);
  } catch (err) {
    return showError(err);
  } finally {
    $('note-form').classList.remove('is-loading');
  }
  if (noteId !== note.id) return; // moved on meanwhile
  fillNote(note);
}

function fillNote(note) {
  replaceNote(note);
  noteSaved = { text: note.text, folder: note.folder ?? '', pinned: note.pinned };
  $('note-form').elements.text.value = note.text;
  notePinned = note.pinned;
  fillFolderSelect(note.folder ?? '');
  const changed = note.updatedAt !== note.createdAt;
  $('note-stamp').textContent = `${formatWhen(note.createdAt)}${changed ? ` · changed ${formatWhen(note.updatedAt)}` : ''}`;
  renderNoteExtras();
  markNoteSaved();
}

// Unfiled, every folder in use, the note's own folder, and New folder… at the end.
function fillFolderSelect(folder) {
  const select = $('note-folder');
  const folders = [...new Set([...noteFolders(), ...(folder ? [folder] : [])])].sort((a, b) => a.localeCompare(b));
  select.replaceChildren(new Option('Unfiled', ''), ...folders.map((f) => new Option(f, f)), new Option('New folder…', '\u0001'));
  select.value = folder;
}

$('note-folder').addEventListener('change', () => {
  const select = $('note-folder');
  if (select.value === '\u0001') {
    const name = prompt('Name the new folder')?.trim().slice(0, 40);
    fillFolderSelect(name || '');
  }
  noteChanged();
});

$('note-pin').addEventListener('click', () => {
  notePinned = !notePinned;
  noteChanged();
});

function noteChanged() {
  const f = $('note-form').elements;
  setStatus($('note-status'), '');
  if (!noteId) writeNoteDraft(f.text.value ? { text: f.text.value, folder: $('note-folder').value, pinned: notePinned } : null);
  renderNoteLinks();
  markNoteSaved();
}

$('note-form').addEventListener('input', (e) => { if (e.target.name === 'text') noteChanged(); });

// Save turns into "Saved ✓" while nothing has changed; the pin shows its state.
function markNoteSaved() {
  const text = $('note-form').elements.text.value;
  const unchanged = text.trimEnd() === noteSaved.text && $('note-folder').value === noteSaved.folder && notePinned === noteSaved.pinned;
  const save = $('note-save');
  save.disabled = noteId ? unchanged : !text.trim();
  save.textContent = !noteId || !unchanged ? 'Save' : 'Saved ✓';
  $('note-pin').setAttribute('aria-pressed', String(notePinned));
  $('note-pin').replaceChildren(pinIcon(), notePinned ? 'Pinned' : 'Pin');
}

function renderNoteExtras() {
  renderNoteLinks();
  renderNotePhotos();
}

function renderNoteLinks() {
  const seen = new Set();
  const links = findLinks($('note-form').elements.text.value).filter((l) => !seen.has(l.href) && seen.add(l.href));
  $('note-links-box').hidden = links.length === 0;
  $('note-links').replaceChildren(...links.map((l) => {
    const li = document.createElement('li');
    const a = linkTo(l.href, shortLink(l.href));
    a.title = l.href;
    li.append(a);
    return li;
  }));
}

// The note's photos, photos still uploading, and the Add photo tile, as on tasks. A new note keeps the
// photos you pick and uploads them once it is saved.
function renderNotePhotos() {
  $('note-photos').hidden = !config.photos;
  if (!config.photos) return;
  const note = noteId && notes.find((n) => n.id === noteId);
  const saved = note ? note.photos : [];
  const tiles = saved.map((photo, i) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'photo-tile';
    tile.setAttribute('aria-label', `Open photo ${i + 1}`);
    const img = document.createElement('img');
    img.src = notePhotoUrl(note.id, photo.id, true);
    img.alt = '';
    img.loading = 'lazy';
    tile.append(img);
    tile.addEventListener('click', () => openViewer(notePhotos(note.id), i));
    return tile;
  });
  const pending = noteId ? (noteUploads.get(noteId) ?? []) : newNotePhotos;
  for (const upload of pending) {
    const tile = document.createElement('div');
    tile.className = `photo-tile${noteId ? ' is-uploading' : ''}`;
    tile.innerHTML = noteId ? '<span class="spinner" aria-hidden="true"></span><span>Uploading…</span>' : '';
    tile.style.backgroundImage = `url("${upload.url}")`;
    tile.style.backgroundSize = 'cover';
    tiles.push(tile);
  }
  if (saved.length + pending.length < MAX_PHOTOS) {
    const add = document.createElement('label');
    add.className = 'photo-tile photo-add';
    add.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span class="visually-hidden">Add photo</span>';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.className = 'visually-hidden';
    input.addEventListener('change', () => pickNotePhotos([...input.files]));
    add.append(input);
    tiles.push(add);
  }
  $('note-photo-grid').replaceChildren(...tiles);
}

// What the photo viewer shows for a note.
const notePhotos = (id) => ({
  photos: () => notes.find((n) => n.id === id)?.photos ?? [],
  url: (photo, thumb) => notePhotoUrl(id, photo.id, thumb),
  caption: () => noteTitle(notes.find((n) => n.id === id) ?? { text: '' }),
  remove: async (photo) => {
    replaceNote(await api(notePhotoUrl(id, photo.id, false), { method: 'DELETE' }));
    if (noteId === id) renderNotePhotos();
  },
});

function pickNotePhotos(files) {
  const note = noteId && notes.find((n) => n.id === noteId);
  const pending = noteId ? (noteUploads.get(noteId) ?? []) : newNotePhotos;
  const room = MAX_PHOTOS - (note ? note.photos.length : 0) - pending.length;
  if (files.length > room) showToast(`A note can have ${MAX_PHOTOS} photos, so only ${room} more will be added.`, 'warn');
  const picked = files.slice(0, room).map((file) => ({ key: crypto.randomUUID(), url: URL.createObjectURL(file), file }));
  if (noteId) uploadNotePhotos(noteId, picked);
  else {
    newNotePhotos = [...newNotePhotos, ...picked];
    renderNotePhotos();
  }
}

// One at a time, like tasks, so a big batch doesn't hold every full-size photo in memory at once.
async function uploadNotePhotos(id, batch) {
  noteUploads.set(id, [...(noteUploads.get(id) ?? []), ...batch]);
  if (noteId === id) renderNotePhotos();
  for (const upload of batch) {
    try {
      const form = new FormData();
      form.append('photo', await shrink(upload.file, PHOTO_SIZE, 0.85), 'photo.jpg');
      form.append('thumb', await shrink(upload.file, THUMB_SIZE, 0.8), 'thumb.jpg');
      replaceNote(await api(`/notes/${id}/photos`, { method: 'POST', body: form }));
    } catch (err) {
      showToast(`Couldn't add the photo: ${err.message}`, 'warn');
    } finally {
      URL.revokeObjectURL(upload.url);
      noteUploads.set(id, (noteUploads.get(id) ?? []).filter((u) => u.key !== upload.key));
      if (noteId === id) renderNotePhotos();
    }
  }
}

// Saving: a note you already have saves straight away; a new one goes through the Save panel.
$('note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = e.target.elements.text.value;
  if (!text.trim()) return setStatus($('note-status'), 'Write something first.', true);
  if (!noteId) return openNoteSheet(text);
  $('note-save').disabled = true;
  try {
    fillNote(await api(`/notes/${noteId}`, { method: 'PUT', body: JSON.stringify({ text, folder: $('note-folder').value, pinned: notePinned }) }));
    showToast('Saved.');
  } catch (err) {
    setStatus($('note-status'), err.message, true);
    markNoteSaved();
  }
});

$('note-tidy').addEventListener('click', () => {
  const text = $('note-form').elements.text.value;
  if (text.trim()) openNoteSheet(text);
});

$('note-delete').addEventListener('click', async () => {
  if (!noteId || !confirm("Delete this note and its photos? This can't be undone.")) return;
  try {
    await api(`/notes/${noteId}`, { method: 'DELETE' });
    notes = notes.filter((n) => n.id !== noteId);
    location.replace('#notes');
    showToast('Deleted the note.');
  } catch (err) {
    showToast(err.message, 'warn');
  }
});

// ---------- the Save panel ----------

let sheet = null; // { typed, tidied, folder, request }

async function openNoteSheet(typed) {
  const chosen = $('note-folder').value;
  sheet = { typed, tidied: null, folder: chosen, request: Symbol('tidy') };
  $('note-sheet-loading').hidden = !config.assistant;
  $('note-sheet-unavailable').hidden = config.assistant;
  $('note-sheet-by').hidden = !config.assistant;
  $('note-sheet-preview').hidden = true;
  $('note-sheet-choice').hidden = true;
  $('note-sheet-choice').querySelector('[value="tidied"]').checked = true;
  renderSheetFolders(null);
  $('note-sheet').hidden = false;
  document.body.classList.add('viewer-open');
  $('note-sheet-unfiled').focus();
  if (!config.assistant) return;

  const request = sheet.request;
  let result = null;
  try {
    result = await api('/notes/tidy', { method: 'POST', quiet: true, body: JSON.stringify({ text: typed, folders: noteFolders() }) });
  } catch { /* filed by hand */ }
  if (!sheet || sheet.request !== request) return; // saved or closed meanwhile
  $('note-sheet-loading').hidden = true;
  if (!result?.assisted) {
    $('note-sheet-unavailable').hidden = false;
    return;
  }
  sheet.tidied = result.text;
  const differs = result.text.trim() !== typed.trim();
  $('note-sheet-preview').textContent = result.text;
  $('note-sheet-preview').hidden = false;
  $('note-sheet-choice').hidden = !differs;
  if (!differs) $('note-sheet-preview').prepend(Object.assign(document.createElement('b'), { textContent: 'Nothing to fix.', className: 'sheet-nothing' }), document.createElement('br'));
  // A folder you picked yourself stays; otherwise the suggestion is picked.
  if (!chosen && result.folder) sheet.folder = result.folder;
  renderSheetFolders(result.folder);
}

function renderSheetFolders(suggested) {
  const folders = [...new Set([...(suggested ? [suggested] : []), ...noteFolders(), ...(sheet.folder ? [sheet.folder] : [])])];
  const chips = folders.map((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(f === sheet.folder));
    b.textContent = f === suggested ? `${f} · suggested` : f;
    b.addEventListener('click', () => { sheet.folder = f; renderSheetFolders(suggested); });
    return b;
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = '+ New folder';
  add.addEventListener('click', () => {
    const name = prompt('Name the new folder')?.trim().slice(0, 40);
    if (name) { sheet.folder = name; renderSheetFolders(suggested); }
  });
  $('note-sheet-folders').replaceChildren(...chips, add);
  $('note-sheet-save').hidden = !sheet.folder;
  $('note-sheet-save').textContent = `Save to ${sheet.folder}`;
}

function closeNoteSheet() {
  sheet = null;
  $('note-sheet').hidden = true;
  document.body.classList.remove('viewer-open');
}

async function saveFromSheet(folder) {
  const useTidied = sheet.tidied && document.querySelector('input[name="note-version"]:checked').value === 'tidied';
  const text = useTidied ? sheet.tidied : sheet.typed;
  for (const b of [$('note-sheet-save'), $('note-sheet-unfiled')]) b.disabled = true;
  try {
    const body = JSON.stringify({ text, folder, pinned: notePinned });
    if (noteId) {
      fillNote(await api(`/notes/${noteId}`, { method: 'PUT', body }));
      closeNoteSheet();
      showToast(folder ? `Saved to ${folder}.` : 'Saved.');
      return;
    }
    const note = await api('/notes', { method: 'POST', body });
    replaceNote(note);
    writeNoteDraft(null);
    closeNoteSheet();
    showToast(folder ? `Saved to ${folder}.` : 'Saved. It is in Unfiled until you pick a folder.');
    const photos = newNotePhotos;
    newNotePhotos = [];
    // Back to the list, where it's at the top marked new; photos upload on the way.
    location.replace('#notes');
    if (photos.length) await uploadNotePhotos(note.id, photos);
    renderNotes();
  } catch (err) {
    showToast(err.message, 'warn');
  } finally {
    for (const b of [$('note-sheet-save'), $('note-sheet-unfiled')]) b.disabled = false;
  }
}

$('note-sheet-save').addEventListener('click', () => saveFromSheet(sheet.folder));
$('note-sheet-unfiled').addEventListener('click', () => {
  // In a hurry: saved as typed when Claude hasn't answered yet.
  if (!sheet.tidied) $('note-sheet-choice').querySelector('[value="typed"]').checked = true;
  saveFromSheet('');
});
$('note-sheet-cancel').addEventListener('click', closeNoteSheet);
$('note-sheet').addEventListener('click', (e) => { if (e.target === $('note-sheet')) closeNoteSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet) closeNoteSheet(); });
