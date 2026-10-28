// Photos on tasks: the photo row in a task's edit form, shrinking and uploading new photos,
// and the full-screen viewer. Uses app.js's $, api, config, tasks, renderMeta and showToast.

const MAX_PHOTOS = 10; // the server allows the same
const PHOTO_SIZE = 2000; // longest side, in pixels
const THUMB_SIZE = 400;

// Photos still uploading, by task id: [{ key, url }] where url previews the picked file.
const uploads = new Map();

const photoUrl = (taskId, photoId, thumb) => `/tasks/${taskId}/photos/${photoId}${thumb ? '?size=thumb' : ''}`;

// A task's edit form: the row of thumbnails and photos being uploaded (shown once there is one), and the
// small camera button beside Delete and Save.
function renderPhotos(li, task) {
  const section = li.querySelector('.photos');
  const slot = li.querySelector('.photo-add-slot');
  section.hidden = true;
  slot.replaceChildren();
  if (!config.photos) return;

  const tiles = task.photos.map((photo, i) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'photo-tile';
    tile.setAttribute('aria-label', `Open photo ${i + 1}`);
    const img = document.createElement('img');
    img.src = photoUrl(task.id, photo.id, true);
    img.alt = '';
    img.loading = 'lazy';
    tile.append(img);
    tile.addEventListener('click', () => openViewer(task.id, i));
    return tile;
  });

  const pending = uploads.get(task.id) ?? [];
  for (const upload of pending) {
    const tile = document.createElement('div');
    tile.className = 'photo-tile is-uploading';
    tile.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Uploading…</span>';
    tile.style.backgroundImage = `url("${upload.url}")`;
    tiles.push(tile);
  }

  if (task.photos.length + pending.length < MAX_PHOTOS) {
    const add = document.createElement('label');
    add.className = 'photo-tile photo-add';
    add.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span class="visually-hidden">Add photo</span>';
    // No "capture" attribute, so the phone offers both the camera and the photo library.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.className = 'visually-hidden';
    input.addEventListener('change', () => addPhotos(task.id, [...input.files]));
    add.append(input);
    slot.append(add);
  }

  section.hidden = tiles.length === 0;
  li.querySelector('.photo-grid').replaceChildren(...tiles);
}

// Redraws one task's meta line and photo row in place, leaving the rest of its form alone.
function refreshTaskPhotos(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  const li = document.querySelector(`#list li[data-id="${taskId}"]`);
  if (!task || !li) return;
  renderMeta(li, task);
  renderPhotos(li, task);
}

function replaceTask(updated) {
  tasks = tasks.map((t) => (t.id === updated.id ? updated : t));
  refreshTaskPhotos(updated.id);
}

async function addPhotos(taskId, files) {
  const task = tasks.find((t) => t.id === taskId);
  const pending = uploads.get(taskId) ?? [];
  const room = MAX_PHOTOS - task.photos.length - pending.length;
  if (files.length > room) showToast(`A task can have ${MAX_PHOTOS} photos, so only ${room} more will be added.`, 'warn');

  const batch = files.slice(0, room).map((file) => ({ key: crypto.randomUUID(), url: URL.createObjectURL(file), file }));
  uploads.set(taskId, [...pending, ...batch]);
  refreshTaskPhotos(taskId);

  // One at a time, so a big batch doesn't hold every full-size photo in memory at once.
  for (const upload of batch) {
    try {
      const [photo, thumb] = [await shrink(upload.file, PHOTO_SIZE, 0.85), await shrink(upload.file, THUMB_SIZE, 0.8)];
      const form = new FormData();
      form.append('photo', photo, 'photo.jpg');
      form.append('thumb', thumb, 'thumb.jpg');
      const updated = await api(`/tasks/${taskId}/photos`, { method: 'POST', body: form });
      done(upload);
      replaceTask(updated);
    } catch (err) {
      done(upload);
      refreshTaskPhotos(taskId);
      showToast(`Couldn't add the photo: ${err.message}`, 'warn');
    }
  }

  function done(upload) {
    URL.revokeObjectURL(upload.url);
    uploads.set(taskId, (uploads.get(taskId) ?? []).filter((u) => u.key !== upload.key));
  }
}

// A JPEG of the picked image with its longest side at most `size` pixels. Drawing it on a canvas
// also turns iPhone HEIC photos into JPEG and applies the photo's rotation.
async function shrink(file, size, quality) {
  const image = await loadImage(file);
  const scale = Math.min(1, size / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('the image could not be read.');
  return blob;
}

async function loadImage(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    // Older Safari: decode through an <img> instead.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error("that file isn't an image this browser can open.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

// ---------- full-screen viewer ----------

let viewing = null; // { taskId, index }

function openViewer(taskId, index) {
  viewing = { taskId, index };
  showViewerPhoto();
  $('photo-viewer').hidden = false;
  document.body.classList.add('viewer-open');
  $('viewer-close').focus();
}

function closeViewer() {
  viewing = null;
  $('photo-viewer').hidden = true;
  $('viewer-image').removeAttribute('src');
  document.body.classList.remove('viewer-open');
}

function showViewerPhoto() {
  const task = tasks.find((t) => t.id === viewing.taskId);
  if (!task || task.photos.length === 0) return closeViewer();
  viewing.index = Math.max(0, Math.min(viewing.index, task.photos.length - 1));
  const count = task.photos.length;
  $('viewer-image').src = photoUrl(task.id, task.photos[viewing.index].id, false);
  $('viewer-image').alt = `Photo ${viewing.index + 1} of ${count}, ${task.title}`;
  $('viewer-count').textContent = `${viewing.index + 1} of ${count}`;
  $('viewer-caption').textContent = task.title;
  $('viewer-prev').hidden = viewing.index === 0;
  $('viewer-next').hidden = viewing.index === count - 1;
}

function stepViewer(delta) {
  if (!viewing) return;
  viewing.index += delta;
  showViewerPhoto();
}

$('viewer-close').addEventListener('click', closeViewer);
$('viewer-prev').addEventListener('click', () => stepViewer(-1));
$('viewer-next').addEventListener('click', () => stepViewer(1));

$('viewer-delete').addEventListener('click', async () => {
  if (!viewing || !confirm('Delete this photo?')) return;
  const task = tasks.find((t) => t.id === viewing.taskId);
  try {
    const updated = await api(photoUrl(task.id, task.photos[viewing.index].id, false), { method: 'DELETE' });
    replaceTask(updated);
    showViewerPhoto();
  } catch (err) {
    showToast(`Couldn't delete the photo: ${err.message}`, 'warn');
  }
});

document.addEventListener('keydown', (e) => {
  if (!viewing) return;
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowLeft') stepViewer(-1);
  else if (e.key === 'ArrowRight') stepViewer(1);
});

// Swipe left or right for the next or previous photo; two-finger gestures are left to pinch-zoom.
let swipeStart = null;
$('viewer-stage').addEventListener('touchstart', (e) => {
  swipeStart = e.touches.length === 1 ? e.touches[0].clientX : null;
}, { passive: true });
$('viewer-stage').addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) swipeStart = null;
}, { passive: true });
$('viewer-stage').addEventListener('touchend', (e) => {
  if (swipeStart === null || window.visualViewport?.scale > 1) return;
  const dx = e.changedTouches[0].clientX - swipeStart;
  if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1);
  swipeStart = null;
});
