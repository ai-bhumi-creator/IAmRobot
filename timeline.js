/* ----------------------------------------------------------------------------- */
/* ---------------------------- Animation timeline ----------------------------- */
/* ----------------------------------------------------------------------------- */
// ---- Timeline references ----
const timelineRuler = document.getElementById('timelineRuler');
const timelineLayers = document.getElementById('timelineLayers');
const timelineFrames = document.getElementById('timelineFrames');

const timelineRulerInner = document.getElementById('timelineRulerInner'); // ✅ ADD

const timelineBody = document.getElementById('timelineBody');
const timelineFramesViewport = document.getElementById('timelineFramesViewport');
const timelineHScroll = document.getElementById('timelineHScroll');
const timelineScrollInner = document.getElementById('timelineScrollInner');

const NS = 'http://www.w3.org/2000/svg';

// ---- Config ----
const totalFrames = 120;    // total number of frames
let currentFrame = 1; // 1..totalFrames
const frameWidth = 20;      // width of each frame-cell in px
const highlightStep = 5;    // highlight every 5 frames (like ruler)

let syncingTimelineScroll = false;

// ---------------- Timeline state ----------------
let timelineLayerCount = 0;
let activeTimelineLayerId = null;

// --- Drag-scrub playhead ONLY on the ruler ---
let rulerScrubbing = false;
let rulerPointerId = null;

// layerId -> Map(frameIndex -> innerHTML string)
const keyframeStore = new Map();

/* -------------- timeline helper function -----------------*/
function resetTimeline() {
  // clear UI
  timelineLayers.innerHTML = '';
  timelineFrames.innerHTML = '';
  timelineRulerInner.innerHTML = '';

  // reset state
  timelineLayerCount = 0;
  activeTimelineLayerId = null;

  // rebuild ruler
  // rebuild ruler (✅ put ticks inside timelineRulerInner)
  timelineRuler.style.display = 'flex';
  timelineRulerInner.innerHTML = '';

  for (let i = 1; i <= totalFrames; i++) {
    const tick = document.createElement('div');
    tick.className = 'frame-ruler-tick';
    tick.style.width = frameWidth + 'px';
    tick.textContent = (i === 1 || i % highlightStep === 0) ? i : '';
    timelineRulerInner.appendChild(tick);
  }

  // rebuild playhead
  // ✅ ensure there is ONLY one playhead in DOM
  const oldPH = document.getElementById('playhead');
  if (oldPH) oldPH.remove();

  // re-append the GLOBAL playhead overlay
  timelineFramesViewport.appendChild(playhead);

  // create first layer
  createTimelineLayer('Layer 1');

  updateTimelineScrollWidth();
  wireTimelineHorizontalScroll();
  updatePlayhead();
}

function isTimelineLayerLocked(layerId){
  const g = ensureTimelineSVGGroup(layerId);
  return g.dataset.tlLocked === 'true';
}

function setTimelineLayerLocked(layerId, locked){
  const g = ensureTimelineSVGGroup(layerId);
  g.dataset.tlLocked = locked ? 'true' : 'false';

  // if locked and currently selected items are inside, deselect them
  if (locked && selectedElements.length) {
    const inside = selectedElements.some(el => el.closest('g[data-tl]')?.dataset.tl === layerId);
    if (inside) clearSelection();
  }

  updateTimelineLayerUI(layerId);
}

function isTimelineLayerVisible(layerId){
  const g = ensureTimelineSVGGroup(layerId);
  return g.style.display !== 'none';
}

function setTimelineLayerVisible(layerId, visible){
  const g = ensureTimelineSVGGroup(layerId);
  g.style.display = visible ? '' : 'none';

  // if hidden and currently selected items are inside, deselect them
  if (!visible && selectedElements.length) {
    const inside = selectedElements.some(el => el.closest('g[data-tl]')?.dataset.tl === layerId);
    if (inside) clearSelection();
  }

  updateTimelineLayerUI(layerId);
}

function updateTimelineLayerUI(layerId){
  const row = timelineLayers.querySelector(`.timeline-layer[data-layer-id="${layerId}"]`);
  if (!row) return;

  const eye = row.querySelector('.tl-eye');
  const lock = row.querySelector('.tl-lock');

  if (eye) {
    const vis = isTimelineLayerVisible(layerId);
    eye.textContent = vis ? '👁' : '🚫';
    eye.classList.toggle('hidden', !vis);
  }

  if (lock) {
    const locked = isTimelineLayerLocked(layerId);
    lock.textContent = locked ? '🔒' : '🔓';
    row.classList.toggle('locked', locked);
  }
}

function updateTimelineScrollWidth() {
  if (!timelineHScroll || !timelineScrollInner || !timelineRulerInner) return;

  const row = timelineFrames.querySelector('.frame-row');
  const rowW = row ? row.scrollWidth : (totalFrames * frameWidth);

  // How wide is the visible frames viewport?
  // Use the frames viewport width, not the scrollbar width.
  const viewW = timelineFramesViewport
    ? timelineFramesViewport.clientWidth
    : timelineHScroll.clientWidth;

  // Make scrollbar content long enough so max scroll reaches the end
  const scrollW = rowW + viewW;

  timelineScrollInner.style.width = scrollW + 'px';
  timelineScrollInner.style.minWidth = scrollW + 'px';

  timelineRulerInner.style.width = rowW + 'px';
  timelineRulerInner.style.minWidth = rowW + 'px';

  // Optional: clamp current scroll so it can't exceed the new max
  const maxScroll = Math.max(0, rowW - viewW);
  if (timelineHScroll.scrollLeft > maxScroll) timelineHScroll.scrollLeft = maxScroll;
}

function updatePlayhead() {
  if (!timelineFramesViewport || !timelineHScroll) return;

  // frame center in "timeline content space"
  const frameCenterX = (currentFrame - 1) * frameWidth + frameWidth / 2;

  // convert to viewport space by subtracting scrollLeft
  const x = frameCenterX - timelineHScroll.scrollLeft;

  playhead.style.left = `${x}px`;
}

function syncTimelineLayerRenderOrder() {
  // UI order: top -> bottom
  const ui = [...timelineLayers.querySelectorAll('.timeline-layer[data-layer-id]')];

  // SVG must be bottom -> top so top layer draws on top
  const idsBottomToTop = ui.map(el => el.dataset.layerId).reverse();

  for (const id of idsBottomToTop) {
    const g = contentLayer.querySelector(`g[data-tl="${id}"]`);
    if (g) contentLayer.appendChild(g); // move to end = above others
  }
}

// Creates (or returns) the SVG group for a timeline layer
function ensureTimelineSVGGroup(layerId) {
  let g = contentLayer.querySelector(`g[data-tl="${layerId}"]`);
  if (!g) {
    g = document.createElementNS(NS, 'g');
    g.dataset.tl = layerId;
    contentLayer.appendChild(g);
    syncTimelineLayerRenderOrder(); // ✅ IMPORTANT
  }
  return g;
}

// Select a timeline layer (UI + remember active + ensure svg group exists)
function selectTimelineLayer(layerId) {
  activeTimelineLayerId = layerId;

  // highlight left layer list
  [...timelineLayers.querySelectorAll('.timeline-layer')].forEach(el => {
    el.classList.toggle('selected', el.dataset.layerId === layerId);
  });

  // (optional) highlight frame row
  [...timelineFrames.querySelectorAll('.frame-row')].forEach(row => {
    row.classList.toggle('selected', row.dataset.layerId === layerId);
  });

  // ensure svg group exists (for future “draw only in active layer”)
  ensureTimelineSVGGroup(layerId);
  updateTimelineLayerUI(layerId);
}

function getLayerFrameMap(layerId) {
  let m = keyframeStore.get(layerId);
  if (!m) {
    m = new Map();
    keyframeStore.set(layerId, m);
  }
  return m;
}

function getLayerGroup(layerId) {
  // your timeline layers are SVG groups: g[data-tl="layerId"]
  return svg.querySelector(`g[data-tl="${layerId}"]`);
}

function isKeyframeUI(layerId, frameIndex) {
  const row = timelineFrames.querySelector(`.frame-row[data-layer-id="${layerId}"]`);
  if (!row) return false;
  const cell = row.querySelector(`.frame-cell[data-frame="${frameIndex}"]`);
  return !!cell?.querySelector(':scope > .frame-content-row');
}

function saveActiveLayerToKeyframe() {
  const layerId = activeTimelineLayerId;     // use your real variable name
  const frameIndex = currentFrame;

  if (!isKeyframeUI(layerId, frameIndex)) return;

  const g = getLayerGroup(layerId);
  if (!g) return;

  getLayerFrameMap(layerId).set(frameIndex, g.innerHTML);
}

function renderFrame(frameIndex) {
  // clear selection/handles (no deselectAll)
  selectedElement = null;
  selectedElements = [];
  activeAnchorIndex = null;
  activeControlPoint = null;
  draggingPath = null;
  draggingAnchor = null;
  isHandleDragging = false;
  handleDrag = null;

  clearControlPoints();

  const layerGroups = svg.querySelectorAll('g[data-tl]');
  layerGroups.forEach(g => {
    const layerId = g.getAttribute('data-tl');
    const frameMap = getLayerFrameMap(layerId);

    if (isKeyframeUI(layerId, frameIndex)) {
      g.innerHTML = frameMap.get(frameIndex) || '';
    } else {
      const prev = findPrevKeyframe(layerId, frameIndex);
      g.innerHTML = (prev ? (frameMap.get(prev) || '') : '');
    }
  });

  // optional: refresh selection visuals (will be empty now)
  drawSelectionBoxes?.();
}

function findPrevKeyframe(layerId, frameIndex) {
  for (let f = frameIndex; f >= 1; f--) {
    if (isKeyframeUI(layerId, f)) return f;
  }
  return null;
}

function addBlankFrameAfterLast(layerId) {
  const row = timelineFrames.querySelector(`.frame-row[data-layer-id="${layerId}"]`);
  if (!row) return;

  const cells = row.querySelectorAll('.frame-cell');
  if (!cells.length) return;

  // find last cell that already has frame-content-row
  let lastIndex = -1;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].querySelector(':scope > .frame-content-row')) lastIndex = i;
  }

  // if none exist yet, treat frame 1 as start
  if (lastIndex === -1) lastIndex = 0, addFrameContentRow(cells[0]);

  const nextIndex = lastIndex + 1;

  // reached end (frame 120 already filled)
  if (nextIndex >= cells.length) return;

  // add a blank frame marker to the next cell
  addFrameContentRow(cells[nextIndex]);
}

function addBlankFrameAllLayers() {
  const rows = timelineFrames.querySelectorAll('.frame-row');
  rows.forEach(row => addBlankFrameAfterLast(row.dataset.layerId));
}

function addFrameContentRow(cell) {
  // ✅ add only once (safe if called multiple times)
  let inner = cell.querySelector(':scope > .frame-content-row');
  if (inner) return inner;

  inner = document.createElement('div');
  inner.className = 'frame-content-row';
  inner.style.width = '100%';
  inner.style.height = '100%';
  inner.style.position = 'relative';
  cell.appendChild(inner);
  return inner;
}

function ensureFrameMarker(layerId, frameIndex) {
  const row = timelineFrames.querySelector(`.frame-row[data-layer-id="${layerId}"]`);
  if (!row) return;
  const cell = row.querySelector(`.frame-cell[data-frame="${frameIndex}"]`);
  if (!cell) return;
  addFrameContentRow(cell); // safe: it won’t duplicate
}

function makeFrameCell(i) {
  const cell = document.createElement('div');
  cell.className = 'frame-cell';
  cell.style.width = frameWidth + 'px';
  cell.dataset.frame = String(i);

  if (i !== 1 && i % highlightStep === 0) cell.style.backgroundColor = '#777';
  else cell.style.backgroundColor = '#525151';

  if (i === 1) addFrameContentRow(cell);
  return cell;
}

function buildFrameRow(layerId) {
  const row = document.createElement('div');
  row.className = 'frame-row';
  row.dataset.layerId = layerId;

  for (let i = 1; i <= totalFrames; i++) {
    row.appendChild(makeFrameCell(i));
  }

  return row;
}

// Creates a new timeline layer (UI + row) and selects it
function createTimelineLayer(name) {
  timelineLayerCount++;
  const layerId = `tl_${timelineLayerCount}`;
  const layerName = name || `Layer ${timelineLayerCount}`;

  // left list item
  const layerDiv = document.createElement('div');
  layerDiv.className = 'timeline-layer';
  layerDiv.dataset.layerId = layerId;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tl-name';
  nameSpan.textContent = layerName;

  const eye = document.createElement('span');
  eye.className = 'tl-eye';
  eye.textContent = '👁';

  const lock = document.createElement('span');
  lock.className = 'tl-lock';
  lock.textContent = '🔓';

  eye.addEventListener('click', (e) => {
    e.stopPropagation();
    setTimelineLayerVisible(layerId, !isTimelineLayerVisible(layerId));
  });

  lock.addEventListener('click', (e) => {
    e.stopPropagation();
    setTimelineLayerLocked(layerId, !isTimelineLayerLocked(layerId));
  });

  // clicking the row selects the layer
  layerDiv.addEventListener('click', (e) => {
    if (isRenamingLayer) return;
    // optional: don’t allow selecting a locked timeline layer
    // if (isTimelineLayerLocked(layerId)) return;
    selectTimelineLayer(layerId);
  });

// ✅ right-click menu (like Library): Rename / Delete
layerDiv.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation(); // prevent your document-level context menu
  selectTimelineLayer(layerId);
  showTimelineLayerMenu(e.clientX, e.clientY, layerId);
});

  layerDiv.appendChild(nameSpan);
  layerDiv.appendChild(eye);
  layerDiv.appendChild(lock);

  timelineLayers.appendChild(layerDiv);

  // ensure defaults are reflected in UI
  updateTimelineLayerUI(layerId);

  // right frames row (append in same order as left list)
  const row = buildFrameRow(layerId);
  timelineFrames.appendChild(row);

  // make it active
  selectTimelineLayer(layerId);

  syncTimelineLayerRenderOrder();

  return layerId;
}

function removeTimelineLayer(layerId = activeTimelineLayerId) {
  if (!layerId) return;

  // if selection is inside the layer being removed, clear it
  if (selectedElements.some(el => el.closest('g[data-tl]')?.dataset.tl === layerId)) {
    clearSelection();
  }

  const layerItems = [...timelineLayers.querySelectorAll('.timeline-layer')];
  if (layerItems.length <= 1) {
    alert("You can't remove the last layer.");
    return;
  }

  // find the index of the layer being removed
  const idx = layerItems.findIndex(el => el.dataset.layerId === layerId);

  // pick next layer to select (prefer previous, else next)
  const nextEl =
    layerItems[idx - 1] ||
    layerItems[idx + 1] ||
    null;

  const nextId = nextEl ? nextEl.dataset.layerId : null;

  // remove left item
  const layerDiv = timelineLayers.querySelector(`.timeline-layer[data-layer-id="${layerId}"]`);
  if (layerDiv) layerDiv.remove();

  // remove frame row
  const row = timelineFrames.querySelector(`.frame-row[data-layer-id="${layerId}"]`);
  if (row) row.remove();

  // remove SVG group for this layer
  const g = contentLayer.querySelector(`g[data-tl="${layerId}"]`);
  if (g) g.remove();

  // update active selection
  activeTimelineLayerId = null;
  if (nextId) selectTimelineLayer(nextId);

  syncTimelineLayerRenderOrder();
}

function getActiveLayerGroup() {
  // if nothing selected yet, auto-pick first timeline layer
  if (!activeTimelineLayerId) {
    const first = timelineLayers.querySelector('.timeline-layer');
    if (first) selectTimelineLayer(first.dataset.layerId);
  }
  // always return a valid group
  return ensureTimelineSVGGroup(activeTimelineLayerId);
}

// ✅ Playhead (starts at center of frame 1)
const playhead = document.createElement('div');
playhead.id = 'playhead';

// frame 1 center = frameWidth/2
playhead.style.left = `${frameWidth / 2}px`;

timelineFramesViewport.appendChild(playhead);

// ---- 1. Create Layer 1 ----
createTimelineLayer('Layer 1');

// ---- 3. Create sparse frame ruler (numbers every highlightStep) ----
timelineRuler.style.display = 'flex';

timelineRulerInner.innerHTML = '';
for (let i = 1; i <= totalFrames; i++) {
  const tick = document.createElement('div');
  tick.className = 'frame-ruler-tick';
  tick.style.width = frameWidth + 'px';
  tick.style.display = 'flex';
  tick.style.alignItems = 'center';
  tick.style.justifyContent = 'center';
  tick.style.borderRight = '1px solid #444';
  tick.style.color = '#ddd';
  tick.style.fontSize = '10px';

  // Show number at multiples of highlightStep (like 1, 5, 10, 15…)
  tick.textContent = (i === 1 || i % highlightStep === 0) ? i : '';

  timelineRulerInner.appendChild(tick);
}

timelineRuler.addEventListener('click', (e) => {
  stopTimelinePlayback(); // ✅ add here (top)

  // click position inside ruler viewport
  const rect = timelineRuler.getBoundingClientRect();
  const localX = e.clientX - rect.left;

  // convert to timeline content space by adding horizontal scroll
  const x = localX + timelineHScroll.scrollLeft;

  // frame index from x
  const idx = Math.floor(x / frameWidth) + 1;

  currentFrame = Math.max(1, Math.min(totalFrames, idx));
  renderFrame(currentFrame);
  updatePlayhead();
});

wireTimelineHorizontalScroll();
updatePlayhead();

timelineFrames.addEventListener('click', (e) => {
  stopTimelinePlayback();

  const cell = e.target.closest('.frame-cell');
  if (!cell) return;

  const row = cell.closest('.frame-row');
  if (!row) return;

  const cells = [...row.querySelectorAll(':scope > .frame-cell')];
  const idx = cells.indexOf(cell);
  if (idx < 0) return;

  currentFrame = idx + 1;
  renderFrame(currentFrame);
  updatePlayhead();
});

function setFrameFromRulerClientX(clientX) {
  const rect = timelineRuler.getBoundingClientRect();
  const localX = clientX - rect.left;

  // ruler viewport -> timeline content space
  const x = localX + timelineHScroll.scrollLeft;

  const idx = Math.floor(x / frameWidth) + 1;
  const nextFrame = Math.max(1, Math.min(totalFrames, idx));

  // ✅ only do work if frame changed
  if (nextFrame === currentFrame) return;

  currentFrame = nextFrame;

  renderFrame(currentFrame);
  updatePlayhead(); // ✅ keep UI in sync
}

// Click-to-jump + drag-to-scrub
timelineRuler.addEventListener('pointerdown', (e) => {
  // only left button
  if (e.button !== 0) return;

  stopTimelinePlayback(); // ✅ add here (top)

  rulerScrubbing = true;
  rulerPointerId = e.pointerId;

  // capture so dragging keeps working even if cursor leaves ruler
  timelineRuler.setPointerCapture(rulerPointerId);

  setFrameFromRulerClientX(e.clientX);
  e.preventDefault();
});

timelineRuler.addEventListener('pointermove', (e) => {
  if (!rulerScrubbing || e.pointerId !== rulerPointerId) return;
  setFrameFromRulerClientX(e.clientX);
});

function stopRulerScrub(e) {
  if (!rulerScrubbing) return;
  if (rulerPointerId != null && e.pointerId === rulerPointerId) {
    try { timelineRuler.releasePointerCapture(rulerPointerId); } catch {}
  }
  rulerScrubbing = false;
  rulerPointerId = null;
}

timelineRuler.addEventListener('pointerup', stopRulerScrub);
timelineRuler.addEventListener('pointercancel', stopRulerScrub);
timelineRuler.addEventListener('lostpointercapture', () => {
  rulerScrubbing = false;
  rulerPointerId = null;
});

function applyTimelineScrollX(x) {
  timelineFrames.style.transform = `translateX(${-x}px)`;
  timelineRulerInner.style.transform = `translateX(${-x}px)`;
}

window.addEventListener('resize', () => {
  updateTimelineScrollWidth();
  applyTimelineScrollX(timelineHScroll.scrollLeft);
});

function wireTimelineHorizontalScroll() {
  if (!timelineHScroll || !timelineScrollInner || !timelineRulerInner) return;

  updateTimelineScrollWidth();

  // ✅ IMPORTANT: don't stack listeners every reset (use onscroll)
  timelineHScroll.onscroll = () => {
    applyTimelineScrollX(timelineHScroll.scrollLeft);
    updatePlayhead();
  };

  // initial align
  applyTimelineScrollX(timelineHScroll.scrollLeft);
  updatePlayhead();
}

/* ----------------------------------------------------------------------------- */
/* --------------------------- Timeline playback (24fps) ------------------------ */
/* ----------------------------------------------------------------------------- */
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const toFirstBtn = document.getElementById('toFirstBtn');
const toLastBtn  = document.getElementById('toLastBtn');
const stepBackBtn  = document.getElementById('stepBackBtn');
const stepFrontBtn = document.getElementById('stepFrontBtn');

const PLAY_FPS = 24; // ✅ for now (we'll make this editable later)
let timelineIsPlaying = false;
let timelinePlayTimer = null;

const PLAY_ICON_HTML = playBtn ? playBtn.innerHTML : '';
const STOP_ICON_HTML = `
  <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="12" height="12" fill="currentColor"/>
  </svg>
`;

function getLastTimelineContentFrame() {
  // scan ALL timeline rows (works even if you added content on a different layer)
  let last = 1;

  const rows = timelineFrames.querySelectorAll('.frame-row');
  rows.forEach(row => {
    const cells = row.querySelectorAll('.frame-cell');
    for (let i = cells.length - 1; i >= 0; i--) {
      // ✅ use non-:scope query so it works even if nested
      if (cells[i].querySelector('.frame-content-row')) {
        last = Math.max(last, i + 1);
        break;
      }
    }
  });

  return Math.max(1, Math.min(totalFrames, last));
}

function stopTimelinePlayback() {
  timelineIsPlaying = false;
  if (timelinePlayTimer) {
    clearInterval(timelinePlayTimer);
    timelinePlayTimer = null;
  }
}

function startTimelinePlayback() {
  // clear any old timer first
  stopTimelinePlayback();

  const endFrame = getLastTimelineContentFrame();

  // 🔎 this log will instantly tell you if endFrame is stuck at 1
  console.log('[playback] currentFrame=', currentFrame, 'endFrame=', endFrame);

  // if only frame 1 has content, don’t move (your requirement)
  if (endFrame <= 1) return;

  // if playhead is already past the end, restart from 1
  if (currentFrame >= endFrame) currentFrame = 1;

  timelineIsPlaying = true;

  const ms = Math.max(1, Math.round(1000 / PLAY_FPS));

  timelinePlayTimer = setInterval(() => {
    const end = getLastTimelineContentFrame();

    if (currentFrame >= end) {
      stopTimelinePlayback();
      return;
    }

    currentFrame += 1;
    renderFrame(currentFrame);
    updatePlayhead();
  }, ms);
}

/* ----------------- Controller button ---------------- */
playBtn.onclick = () => {
  console.log('playBtn');
  startTimelinePlayback();
};

stopBtn.onclick = () => {
  console.log('stopBtn');
  stopTimelinePlayback();
};

toFirstBtn.onclick = () => {
  stopTimelinePlayback();

  currentFrame = 1;
  renderFrame(currentFrame);
  updatePlayhead();

  // optional if you already have this helper:
  // ensurePlayheadVisible();
};

toLastBtn.onclick = () => {
  stopTimelinePlayback();

  const last = getLastTimelineContentFrame(); // ✅ last frame that has .frame-content-row
  currentFrame = last;

  renderFrame(currentFrame);
  updatePlayhead();

  // optional if you already have this helper:
  // ensurePlayheadVisible();
};

stepBackBtn.onclick = () => {
  stopTimelinePlayback();

  currentFrame = Math.max(1, currentFrame - 1);
  renderFrame(currentFrame);
  updatePlayhead();

  // optional if you have it:
  // ensurePlayheadVisible();
};

stepFrontBtn.onclick = () => {
  stopTimelinePlayback();

  currentFrame = Math.min(getLastTimelineContentFrame(), currentFrame + 1);
  renderFrame(currentFrame);
  updatePlayhead();

  // optional if you have it:
  // ensurePlayheadVisible();
};

/* ----------------------------------------------------------------------------- */
/* ------------------ Timeline layer right-click menu (rename/delete) ----------- */
/* ----------------------------------------------------------------------------- */
let tlMenuEl = null;
let tlMenuLayerId = null;

function ensureTimelineLayerMenu() {
  if (tlMenuEl) return tlMenuEl;

  tlMenuEl = document.createElement('div');
  tlMenuEl.id = 'timelineLayerContextMenu';
  tlMenuEl.style.position = 'fixed';
  tlMenuEl.style.zIndex = '999999';
  tlMenuEl.style.minWidth = '160px';
  tlMenuEl.style.padding = '6px';
  tlMenuEl.style.borderRadius = '8px';
  tlMenuEl.style.border = '1px solid rgba(255,255,255,0.12)';
  tlMenuEl.style.background = 'rgba(20,20,20,0.95)';
  tlMenuEl.style.backdropFilter = 'blur(6px)';
  tlMenuEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
  tlMenuEl.style.display = 'none';

  tlMenuEl.innerHTML = `
    <div class="tlctx-item" data-act="rename" style="padding:8px 10px; border-radius:6px; cursor:pointer; color:white;">Rename</div>
    <div style="height:1px; margin:6px 0; background:rgba(255,255,255,0.10);"></div>
    <div class="tlctx-item" data-act="delete" style="padding:8px 10px; border-radius:6px; cursor:pointer; color:white;">Delete</div>
  `;

  tlMenuEl.addEventListener('mouseover', (e) => {
    const it = e.target.closest('.tlctx-item');
    if (it) it.style.background = 'rgba(255,255,255,0.08)';
  });
  tlMenuEl.addEventListener('mouseout', (e) => {
    const it = e.target.closest('.tlctx-item');
    if (it) it.style.background = 'transparent';
  });

  tlMenuEl.addEventListener('mousedown', (e) => {
    // prevent menu click from closing immediately via document handler
    e.stopPropagation();
  });

  tlMenuEl.addEventListener('click', (e) => {
    const item = e.target.closest('.tlctx-item');
    if (!item) return;

    const act = item.dataset.act;
    const layerId = tlMenuLayerId;

    hideTimelineLayerMenu();
    if (!layerId) return;

    if (act === 'rename') beginTimelineLayerInlineRename(layerId);
    if (act === 'delete') removeTimelineLayer(layerId);
  });

  document.body.appendChild(tlMenuEl);

  // close on outside click / escape / scroll / resize
  document.addEventListener('mousedown', () => hideTimelineLayerMenu());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTimelineLayerMenu(); }, true);
  window.addEventListener('scroll', hideTimelineLayerMenu, true);
  window.addEventListener('resize', hideTimelineLayerMenu);

  return tlMenuEl;
}

function showTimelineLayerMenu(x, y, layerId) {
  const m = ensureTimelineLayerMenu();
  tlMenuLayerId = layerId;

  m.style.display = 'block';

  // keep inside viewport
  const pad = 6;
  const rect = m.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - pad;
  const maxY = window.innerHeight - rect.height - pad;
  m.style.left = Math.max(pad, Math.min(x, maxX)) + 'px';
  m.style.top = Math.max(pad, Math.min(y, maxY)) + 'px';
}

function hideTimelineLayerMenu() {
  if (!tlMenuEl) return;
  tlMenuEl.style.display = 'none';
  tlMenuLayerId = null;
}

function beginTimelineLayerInlineRename(layerId) {
  if (!layerId) return;

  const row = timelineLayers?.querySelector(`.timeline-layer[data-layer-id="${layerId}"]`);
  const nameEl = row?.querySelector('.tl-name');
  if (!nameEl) return;

  const oldName = nameEl.textContent || '';

  isRenamingLayer = true;
  nameEl.contentEditable = 'true';
  nameEl.classList.add('editing');
  nameEl.focus();

  const sel = window.getSelection();
  sel.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  sel.addRange(range);

  const cleanup = () => {
    nameEl.contentEditable = 'false';
    nameEl.classList.remove('editing');
    nameEl.onkeydown = null;
    nameEl.onblur = null;
    isRenamingLayer = false;
  };

  nameEl.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      nameEl.textContent = oldName;
      nameEl.blur();
    }
  };

  nameEl.onblur = () => {
    const newName = nameEl.textContent.trim();
    nameEl.textContent = newName || oldName || 'Layer';

    // optional: persist name on dataset/SVG group (harmless if unused)
    row.dataset.layerName = nameEl.textContent;
    const g = ensureTimelineSVGGroup?.(layerId);
    if (g) g.dataset.layerName = nameEl.textContent;

    cleanup();
  };
}
