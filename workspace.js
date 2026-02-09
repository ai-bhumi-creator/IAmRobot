// workspace.js (FULL UPDATED FILE)
// NOTE: Only additions/changes are:
// 1) syncPickerGlobals() function + initial call
// 2) syncPickerGlobals() calls anywhere selection globals change
// Everything else is your code as-is.

// ===============================
// Canvas + Context
// ===============================
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const canvasContainer = document.querySelector(".canvas-container");

// ===============================
// Tool element declarations
// ===============================
const selectionTool = document.getElementById("selectionTool");
const subselectionTool = document.getElementById("subselectionTool");
const penTool = document.getElementById("penTool");
const rectangleTool = document.getElementById("rectangleTool");
const ovalTool = document.getElementById("ovalTool");

// ===============================
// Stage (internal coords always 0,0)
// ===============================
const stage = {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
  bg: "#ffffff",
};

// ===============================
// View (camera) incl. zoom
// ===============================
const view = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  minScale: 0.25,
  maxScale: 4,
};

// ===============================
// Image selection state (imported images)
// ===============================
let selectedImageInstanceId = null;
let isImageSelected = false;
let isImgDragging = false;
let isImgScaling = false;
let isImgRotating = false;
let imgDragStart = { x: 0, y: 0 };
let imgInitialState = null;
let activeImgScaleHandle = 0; // 1 TL,2 TR,3 BR,4 BL

function centerStageInView(dpr = 1) {
  // If your view math is in "CSS pixels", use (canvas.width / dpr)
  const vw = canvas.width / dpr;
  const vh = canvas.height / dpr;

  view.offsetX = (vw - stage.width * view.scale) / 2;
  view.offsetY = (vh - stage.height * view.scale) / 2;
}

function resizeCanvasToViewport() {
  const rect = canvasContainer.getBoundingClientRect();

  // Optional: crisp rendering on HiDPI screens
  const dpr = window.devicePixelRatio || 1;

  // Set the internal pixel buffer size
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  // Make the canvas visually match the container size
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";

  centerStageInView(dpr);
}

// ===============================
// Tool state
// ===============================
let activeTool = "selection";

// Pen tool state
let penToolState = {
  isDrawing: false,
  points: [],
  tempLine: null,
  activeAnchor: null,
  hoverAnchor: null,
  anchors: [],
  paths: [],
  mode: "corner",
  controlPoints: [],
  isClosing: false,
  hoverPoint: null,
};

// Selection state (subselection)
let selectedPath = null;
let selectedAnchor = null;
let selectedHandle = null;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragOffset = { x: 0, y: 0 };

// Marquee state
let isMarquee = false;
let marqueeStart = { x: 0, y: 0 };
let marqueeNow = { x: 0, y: 0 };
let clickStartPos = { x: 0, y: 0 };
let isPotentialMarquee = false;
const MARQUEE_MIN_DRAG = 6;

// Rectangle tool state ✅
let isRectDrawing = false;
let rectStart = { x: 0, y: 0 }; // world/stage
let rectNow = { x: 0, y: 0 }; // world/stage

// Oval tool state
let isOvalDrawing = false;
let ovalStart = { x: 0, y: 0 }; // world/stage
let ovalNow = { x: 0, y: 0 }; // world/stage

// Middle-mouse pan state
let isPanning = false;
let panStart = { x: 0, y: 0 };
let viewStart = { x: 0, y: 0 };

// SVG selection state for drawn paths
let selectedSvgGroup = null; // index of selected path group
let isSvgSelected = false;
let isSvgDragging = false;
let isSvgScaling = false;
let isSvgRotating = false;
let svgDragStart = { x: 0, y: 0 };
let svgInitialState = null;
let hoveredSvg = null;
let activeScaleHandle = 0; // 1: TL, 2: TR, 3: BR, 4: BL

// Store transformation data for each path
let pathTransformations = []; // [{x,y,scaleX,scaleY,rotation,strokeWidth,pivotX,pivotY}, ...]

// Key modifiers
let isCtrlKeyPressed = false;
let isShiftKeyPressed = false;

// ===============================
// Svg delete
// ===============================
function ensureStoreLayerFrame(layerIndex, frame) {
  window.timelineStore = window.timelineStore || { layers: [] };
  window.timelineStore.layers = window.timelineStore.layers || [];
  while (window.timelineStore.layers.length <= layerIndex) {
    window.timelineStore.layers.push({ frames: {} });
  }
  const layer = window.timelineStore.layers[layerIndex];
  layer.frames = layer.frames || {};
  return layer.frames[String(frame)] || null;
}

function commitActiveSvgToTimelineStore() {
  const frame = window.timelineCurrentFrame || 1;
  const layerIndex = window.timelineGetActiveLayer?.() ?? 0;

  window.timelineStore = window.timelineStore || { layers: [] };
  window.timelineStore.layers = window.timelineStore.layers || [];
  while (window.timelineStore.layers.length <= layerIndex) {
    window.timelineStore.layers.push({ frames: {} });
  }

  const layer = window.timelineStore.layers[layerIndex];
  layer.frames = layer.frames || {};

  // If nothing left, remove the keyframe data entirely
  if (!penToolState.paths || penToolState.paths.length === 0) {
    delete layer.frames[String(frame)];
    return { frame, layerIndex };
  }

  // Save a snapshot of current SVG content for this frame/layer
  layer.frames[String(frame)] = {
    paths: JSON.parse(JSON.stringify(penToolState.paths)),
    transforms: JSON.parse(JSON.stringify(pathTransformations)),
  };

  return { frame, layerIndex };
}

// ===============================
// Timeline storage: per layer + frame
// ===============================
window.timelineStore = window.timelineStore || { layers: [] };

// Each layer: { frames: { [frameNumber]: { paths: [], transforms: [] } } }
function ensureStoreLayer(layerIndex) {
  const store = window.timelineStore;
  while (store.layers.length <= layerIndex) {
    store.layers.push({ frames: {} });
  }
  return store.layers[layerIndex];
}

function ensureStoreFrame(layerIndex, frameNumber) {
  const layer = ensureStoreLayer(layerIndex);
  const f = String(frameNumber);
  if (!layer.frames[f]) layer.frames[f] = { paths: [], transforms: [] };
  return layer.frames[f];
}

// Load (activeLayer, currentFrame) into the editor arrays
function loadTimelineFrameLayer(frameNumber, layerIndex) {
  const fr = ensureStoreFrame(layerIndex, frameNumber);

  // Point editor arrays at THIS frame/layer data
  penToolState.paths = fr.paths;
  pathTransformations = fr.transforms;

  // Reset selections (Flash-like; switching frames/layers clears selection)
  selectedPath = null;
  selectedAnchor = null;
  selectedHandle = null;
  isSvgSelected = false;
  selectedSvgGroup = null;

  syncPickerGlobals();
  window.flashColorPickerSyncFromSelection?.();
}

// Called from timeline.js whenever playhead or active layer changes
window.onTimelineChanged = (frame, layer) => {
  loadTimelineFrameLayer(frame || 1, layer || 0);
  updatePropertiesPanel?.();
  draw();
};

// Called from timeline.js when a new layer is created
window.onTimelineLayerAdded = (newLayerIndex) => {
  ensureStoreLayer(newLayerIndex);
};

// ===============================
// ✅ EXPOSE STATE TO COLOR PICKER
// ===============================
function syncPickerGlobals() {
  window.penToolState = penToolState;

  // subselection selection
  window.selectedPath = selectedPath;

  // selection tool "SVG" selection (your path-group selection)
  window.selectedSvgGroup = selectedSvgGroup;
  window.isSvgSelected = isSvgSelected;
}
// call once at start
syncPickerGlobals();

// ===============================
// Tool switching (safe)
// ===============================
selectionTool?.addEventListener("click", () => {
  activeTool = "selection";
  penToolState.isDrawing = false;
  penToolState.points = [];
  penToolState.tempLine = null;

  canvas.style.cursor = "default";

  isRectDrawing = false;

  // If something is selected in Subselection, show selection rectangle for it in Selection
  if (selectedPath !== null) {
    isSvgSelected = true;
    selectedSvgGroup = selectedPath;

    syncPickerGlobals();
    window.flashColorPickerSyncFromSelection?.();

    if (!pathTransformations[selectedSvgGroup]) {
      initializePathTransform(selectedSvgGroup);
    }
    getPathBoundingBox(selectedSvgGroup);
  } else {
    // ensure globals accurate
    syncPickerGlobals();
    window.flashColorPickerSyncFromSelection?.();
  }

  // Selection tool doesn't use anchor selection
  selectedAnchor = null;
  selectedHandle = null;
  isDragging = false;

  updatePropertiesPanel?.();
  draw();
});

subselectionTool?.addEventListener("click", () => {
  activeTool = "subselection";
  penToolState.isDrawing = false;
  penToolState.points = [];
  penToolState.tempLine = null;

  canvas.style.cursor = "default";

  isRectDrawing = false;

  // If something is selected in Selection tool, show anchors for it in Subselection
  if (isSvgSelected && selectedSvgGroup !== null) {
    selectedPath = selectedSvgGroup;

    syncPickerGlobals();
    window.flashColorPickerSyncFromSelection?.();
  } else if (selectedPath === null) {
    selectedPath = null;
    syncPickerGlobals();
    window.flashColorPickerSyncFromSelection?.();
  }

  selectedAnchor = null;
  selectedHandle = null;
  isDragging = false;

  updatePropertiesPanel?.();
  draw();
});

penTool?.addEventListener("click", () => {
  activeTool = "pen";
  penToolState.isDrawing = false;
  penToolState.points = [];
  penToolState.tempLine = null;
  selectedPath = null;
  selectedAnchor = null;
  selectedHandle = null;
  isSvgSelected = false;
  selectedSvgGroup = null;

  syncPickerGlobals();
  window.flashColorPickerSyncFromSelection?.();

  canvas.style.cursor = "none";

  isRectDrawing = false;

  updatePropertiesPanel?.();
  draw();
});

rectangleTool?.addEventListener("click", () => {
  activeTool = "rectangle";
  penToolState.isDrawing = false;
  penToolState.points = [];
  penToolState.tempLine = null;

  // Turn off selection rectangle while drawing rectangles
  isSvgSelected = false;
  selectedSvgGroup = null;

  syncPickerGlobals();
  window.flashColorPickerSyncFromSelection?.();

  canvas.style.cursor = "none";

  isRectDrawing = false;

  selectedAnchor = null;
  selectedHandle = null;
  isDragging = false;

  updatePropertiesPanel?.();
  draw();
});

ovalTool?.addEventListener("click", () => {
  activeTool = "oval";
  penToolState.isDrawing = false;
  penToolState.points = [];
  penToolState.tempLine = null;

  // Turn off selection rectangle while drawing ovals
  isSvgSelected = false;
  selectedSvgGroup = null;

  syncPickerGlobals();
  window.flashColorPickerSyncFromSelection?.();

  canvas.style.cursor = "none";

  isOvalDrawing = false;

  selectedAnchor = null;
  selectedHandle = null;
  isDragging = false;

  updatePropertiesPanel?.();
  draw();
});

// ===============================
// Coordinate helpers
// ===============================
function getCanvasMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function screenToStage(mx, my) {
  return {
    x: (mx - view.offsetX) / view.scale,
    y: (my - view.offsetY) / view.scale,
  };
}

function getMarqueeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  return { x, y, w, h };
}

function distance(p1, p2) {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

function pointsAreClose(p1, p2, threshold = 5) {
  return distance(p1, p2) < threshold / view.scale;
}

function distanceToSegment(p, v, w) {
  const l2 = distance(v, w) ** 2;
  if (l2 === 0) return distance(p, v);

  const t = Math.max(
    0,
    Math.min(1, ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2)
  );
  const projection = {
    x: v.x + t * (w.x - v.x),
    y: v.y + t * (w.y - v.y),
  };

  return distance(p, projection);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function worldToLocalPoint(pathIndex, wx, wy) {
  const t = pathTransformations[pathIndex];
  if (!t) return { x: wx, y: wy };

  const cx = t.pivotX ?? 0;
  const cy = t.pivotY ?? 0;

  // remove translation
  let x = wx - (t.x ?? 0);
  let y = wy - (t.y ?? 0);

  // to pivot
  x -= cx;
  y -= cy;

  // inverse rotate
  const r = -(t.rotation ?? 0);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;

  // inverse scale
  const sx = t.scaleX ?? 1;
  const sy = t.scaleY ?? 1;

  // avoid divide by zero
  const lsx = sx === 0 ? 1e-6 : sx;
  const lsy = sy === 0 ? 1e-6 : sy;

  x = rx / lsx;
  y = ry / lsy;

  // back from pivot
  return { x: x + cx, y: y + cy };
}

// ===============================
// Transform helpers (constant stroke)
// ===============================

// Local bbox including control points
function getLocalBBox(pathIndex) {
  const path = penToolState.paths[pathIndex];
  if (!path || path.points.length === 0) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const add = (x, y) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const p of path.points) {
    add(p.x, p.y);
    if (p.outControl) add(p.x + p.outControl.x, p.y + p.outControl.y);
    if (p.inControl) add(p.x + p.inControl.x, p.y + p.inControl.y);
  }

  const w = maxX - minX;
  const h = maxY - minY;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: w,
    height: h,
    centerX: minX + w / 2,
    centerY: minY + h / 2,
  };
}

function initializePathTransform(pathIndex) {
  if (pathTransformations[pathIndex]) return pathTransformations[pathIndex];

  const local = getLocalBBox(pathIndex);
  if (!local) return null;

  const transform = {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    strokeWidth: 2,
    pivotX: local.centerX,
    pivotY: local.centerY,
  };

  pathTransformations[pathIndex] = transform;
  return transform;
}

function applyPathTransformToPoint(pathIndex, x, y) {
  const t = pathTransformations[pathIndex];
  if (!t) return { x, y };

  const cx = t.pivotX ?? 0;
  const cy = t.pivotY ?? 0;

  // to pivot
  let px = x - cx;
  let py = y - cy;

  // scale
  px *= t.scaleX ?? 1;
  py *= t.scaleY ?? 1;

  // rotate
  const r = t.rotation ?? 0;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rx = px * cos - py * sin;
  const ry = px * sin + py * cos;

  // back + translate
  return {
    x: rx + cx + (t.x ?? 0),
    y: ry + cy + (t.y ?? 0),
  };
}

function buildTransformedPath2D(pathIndex) {
  const path = penToolState.paths[pathIndex];
  if (!path || path.points.length < 2) return null;

  const P = (x, y) => applyPathTransformToPoint(pathIndex, x, y);
  const p2d = new Path2D();

  const first = path.points[0];
  const p0 = P(first.x, first.y);
  p2d.moveTo(p0.x, p0.y);

  for (let i = 1; i < path.points.length; i++) {
    const prev = path.points[i - 1];
    const cur = path.points[i];

    // ✅ Bezier only when curve is enabled on either endpoint
    const hasBezier =
      (prev.curve || cur.curve) &&
      prev.outControl &&
      cur.inControl &&
      (prev.outControl.x || prev.outControl.y || cur.inControl.x || cur.inControl.y);

    if (hasBezier) {
      const cp1 = P(prev.x + prev.outControl.x, prev.y + prev.outControl.y);
      const cp2 = P(cur.x + cur.inControl.x, cur.y + cur.inControl.y);
      const end = P(cur.x, cur.y);
      p2d.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
    } else {
      const end = P(cur.x, cur.y);
      p2d.lineTo(end.x, end.y);
    }
  }

  if (path.closed && path.points.length >= 3) {
    const last = path.points[path.points.length - 1];
    const first2 = path.points[0];

    const hasBezier =
      (last.curve || first2.curve) &&
      last.outControl &&
      first2.inControl &&
      (last.outControl.x || last.outControl.y || first2.inControl.x || first2.inControl.y);

    if (hasBezier) {
      const cp1 = P(last.x + last.outControl.x, last.y + last.outControl.y);
      const cp2 = P(first2.x + first2.inControl.x, first2.y + first2.inControl.y);
      const end = P(first2.x, first2.y);
      p2d.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
    } else {
      const end = P(first2.x, first2.y);
      p2d.lineTo(end.x, end.y);
    }
  }

  return p2d;
}

function getPathBoundingBox(pathIndex) {
  const path = penToolState.paths[pathIndex];
  if (!path || path.points.length < 2) return null;

  if (!pathTransformations[pathIndex]) initializePathTransform(pathIndex);
  const t = pathTransformations[pathIndex];

  const STEP = 0.02;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const addWorld = (lx, ly) => {
    const w = applyPathTransformToPoint(pathIndex, lx, ly);
    minX = Math.min(minX, w.x);
    minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x);
    maxY = Math.max(maxY, w.y);
  };

  const bezierPoint = (p0, p1, p2, p3, tt) => {
    const u = 1 - tt;
    const uu = u * u;
    const tt2 = tt * tt;
    const uuu = uu * u;
    const ttt = tt2 * tt;

    return {
      x: uuu * p0.x + 3 * uu * tt * p1.x + 3 * u * tt2 * p2.x + ttt * p3.x,
      y: uuu * p0.y + 3 * uu * tt * p1.y + 3 * u * tt2 * p2.y + ttt * p3.y,
    };
  };

  for (let i = 0; i < path.points.length - 1; i++) {
    const a = path.points[i];
    const b = path.points[i + 1];

    const hasBezier =
      (a.curve || b.curve) &&
      a.outControl &&
      b.inControl &&
      (a.outControl.x || a.outControl.y || b.inControl.x || b.inControl.y);

    if (hasBezier) {
      const p0 = { x: a.x, y: a.y };
      const p1 = { x: a.x + a.outControl.x, y: a.y + a.outControl.y };
      const p2 = { x: b.x + b.inControl.x, y: b.y + b.inControl.y };
      const p3 = { x: b.x, y: b.y };

      for (let tt = 0; tt <= 1; tt += STEP) {
        const p = bezierPoint(p0, p1, p2, p3, tt);
        addWorld(p.x, p.y);
      }
    } else {
      addWorld(a.x, a.y);
      addWorld(b.x, b.y);
    }
  }

  if (path.closed && path.points.length >= 3) {
    const a = path.points[path.points.length - 1];
    const b = path.points[0];

    const hasBezier =
      (a.curve || b.curve) &&
      a.outControl &&
      b.inControl &&
      (a.outControl.x || a.outControl.y || b.inControl.x || b.inControl.y);

    if (hasBezier) {
      const p0 = { x: a.x, y: a.y };
      const p1 = { x: a.x + a.outControl.x, y: a.y + a.outControl.y };
      const p2 = { x: b.x + b.inControl.x, y: b.y + b.inControl.y };
      const p3 = { x: b.x, y: b.y };

      for (let tt = 0; tt <= 1; tt += STEP) {
        const p = bezierPoint(p0, p1, p2, p3, tt);
        addWorld(p.x, p.y);
      }
    } else {
      addWorld(a.x, a.y);
      addWorld(b.x, b.y);
    }
  }

  const stroke = (t?.strokeWidth ?? 2) / view.scale;
  const pad = stroke * 0.5;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  // ✅ FIX: keep the RED center handle at the VISUAL center (not the current pivot)
  const local = getLocalBBox(pathIndex);
  const visualCenterWorld = local
    ? applyPathTransformToPoint(pathIndex, local.centerX, local.centerY)
    : applyPathTransformToPoint(pathIndex, t.pivotX ?? 0, t.pivotY ?? 0);

  // keep pivot world separately (used by rotation math)
  const pivotWorld = applyPathTransformToPoint(pathIndex, t.pivotX ?? 0, t.pivotY ?? 0);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,

    // visual center for UI (red circle)
    centerX: visualCenterWorld.x,
    centerY: visualCenterWorld.y,

    // pivot world for rotation math
    pivotWorldX: pivotWorld.x,
    pivotWorldY: pivotWorld.y,

    transform: t,
  };
}

// ✅ When a layer becomes locked, clear any active selections/transform boxes on that layer
window.onTimelineLayerLockChanged = function onTimelineLayerLockChanged(layerIndex, locked) {
  if (!locked) return;

  const activeLayer = window.timelineGetActiveLayer?.() ?? 0;
  if ((layerIndex | 0) !== (activeLayer | 0)) return;

  // Clear SVG selection + transform state
  isSvgSelected = false;
  selectedSvgGroup = null;
  selectedPath = null;
  selectedAnchor = null;
  selectedHandle = null;

  isSvgDragging = false;
  isSvgScaling = false;
  isSvgRotating = false;
  isDragging = false;

  // Clear marquee / potential selection visuals
  isPotentialMarquee = false;
  isMarquee = false;

  // Clear Image selection + transform state (so box/handles disappear)
  isImageSelected = false;
  selectedImageInstanceId = null;
  isImgDragging = false;
  isImgScaling = false;
  isImgRotating = false;
  activeImgScaleHandle = 0;

  // Stop any drawing states
  penToolState.isDrawing = false;
  isRectDrawing = false;
  isOvalDrawing = false;

  // Sync UI
  syncPickerGlobals();
  window.flashColorPickerSyncFromSelection?.();
  updatePropertiesPanel?.();

  draw();
};

window.workspaceHasSvgAt = function workspaceHasSvgAt(frame, layerIndex) {
  const f = frame | 0;
  const l = layerIndex | 0;

  // If we're asking about the CURRENT active frame/layer,
  // also consider the live edit state (penToolState)
  const curF = window.timelineCurrentFrame ?? 1;
  const curL = window.timelineGetActiveLayer?.() ?? 0;

  if (f === (curF | 0) && l === (curL | 0)) {
    if (window.penToolState?.paths && window.penToolState.paths.length > 0) return true;
    // if penToolState isn't global in your file, remove "window." and just use penToolState
  }

  // Saved keyframe SVG in timelineStore
  const fr = window.timelineStore?.layers?.[l]?.frames?.[String(f)];
  return !!(fr && Array.isArray(fr.paths) && fr.paths.length > 0);
};

// ===============================
// Rectangle tool helpers ✅ (handles visible)
// ===============================
function drawRectanglePreview() {
  if (!isRectDrawing) return;

  const left = Math.min(rectStart.x, rectNow.x);
  const top = Math.min(rectStart.y, rectNow.y);
  const right = Math.max(rectStart.x, rectNow.x);
  const bottom = Math.max(rectStart.y, rectNow.y);

  const w = right - left;
  const h = bottom - top;

  ctx.save();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.lineWidth = 1.5 / view.scale;
  ctx.setLineDash([6 / view.scale, 4 / view.scale]);
  ctx.strokeRect(left, top, w, h);

  ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
  ctx.fillRect(left, top, w, h);

  ctx.restore();
}

function finishRectanglePath() {
  const left = Math.min(rectStart.x, rectNow.x);
  const top = Math.min(rectStart.y, rectNow.y);
  const right = Math.max(rectStart.x, rectNow.x);
  const bottom = Math.max(rectStart.y, rectNow.y);

  const w = right - left;
  const h = bottom - top;

  if (w < 2 / view.scale || h < 2 / view.scale) return null;

  // ✅ visible handles, rectangle stays straight until curve is enabled
  const k = clamp(Math.min(w, h) * 0.25, 18 / view.scale, 50 / view.scale);

  const pts = [
    // TL
    { x: left, y: top, curve: false, inControl: { x: 0, y: +k }, outControl: { x: +k, y: 0 } },
    // TR
    { x: right, y: top, curve: false, inControl: { x: -k, y: 0 }, outControl: { x: 0, y: +k } },
    // BR
    { x: right, y: bottom, curve: false, inControl: { x: 0, y: -k }, outControl: { x: -k, y: 0 } },
    // BL
    { x: left, y: bottom, curve: false, inControl: { x: +k, y: 0 }, outControl: { x: 0, y: -k } },
  ];

  const path = { points: pts, closed: true };
  ensurePathStyle(path);
  path.style.fillEnabled = true; // rectangles should fill by default

  const pathIndex = penToolState.paths.length;
  penToolState.paths.push(path);

  initializePathTransform(pathIndex);

  // ready for subselection edits
  selectedPath = pathIndex;
  selectedAnchor = null;
  selectedHandle = null;

  syncPickerGlobals();
  window.flashColorPickerSyncFromSelection?.();

  getPathBoundingBox(pathIndex);
  return pathIndex;
}

// ===============================
// Oval tool helpers ✅
// ===============================
function drawOvalPreview() {
  if (!isOvalDrawing) return;

  const left = Math.min(ovalStart.x, ovalNow.x);
  const top = Math.min(ovalStart.y, ovalNow.y);
  const right = Math.max(ovalStart.x, ovalNow.x);
  const bottom = Math.max(ovalStart.y, ovalNow.y);

  const w = right - left;
  const h = bottom - top;
  const centerX = left + w / 2;
  const centerY = top + h / 2;
  const radiusX = w / 2;
  const radiusY = h / 2;

  ctx.save();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.lineWidth = 1.5 / view.scale;
  ctx.setLineDash([6 / view.scale, 4 / view.scale]);

  // Draw oval using bezier curves (approximation)
  ctx.beginPath();

  // Magic constant for circle approximation with bezier curves
  const k = 0.5522847498;
  const ox = radiusX * k;
  const oy = radiusY * k;

  // Starting point at rightmost point
  ctx.moveTo(centerX + radiusX, centerY);

  // Top-right quadrant
  ctx.bezierCurveTo(
    centerX + radiusX, centerY - oy,
    centerX + ox, centerY - radiusY,
    centerX, centerY - radiusY
  );

  // Top-left quadrant
  ctx.bezierCurveTo(
    centerX - ox, centerY - radiusY,
    centerX - radiusX, centerY - oy,
    centerX - radiusX, centerY
  );

  // Bottom-left quadrant
  ctx.bezierCurveTo(
    centerX - radiusX, centerY + oy,
    centerX - ox, centerY + radiusY,
    centerX, centerY + radiusY
  );

  // Bottom-right quadrant
  ctx.bezierCurveTo(
    centerX + ox, centerY + radiusY,
    centerX + radiusX, centerY + oy,
    centerX + radiusX, centerY
  );

  ctx.stroke();

  ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
  ctx.fill();
  ctx.restore();
}

function finishOvalPath() {
  const left = Math.min(ovalStart.x, ovalNow.x);
  const top = Math.min(ovalStart.y, ovalNow.y);
  const right = Math.max(ovalStart.x, ovalNow.x);
  const bottom = Math.max(ovalStart.y, ovalNow.y);

  const w = right - left;
  const h = bottom - top;

  if (w < 2 / view.scale || h < 2 / view.scale) return null;

  const centerX = left + w / 2;
  const centerY = top + h / 2;
  const radiusX = w / 2;
  const radiusY = h / 2;

  // Magic constant for circle approximation with bezier curves
  const k = 0.5522847498;
  const ox = radiusX * k;
  const oy = radiusY * k;

  // Create 4 points for the oval (right, top, left, bottom)
  const pts = [
    // Right point (0°)
    {
      x: centerX + radiusX,
      y: centerY,
      curve: true,
      // Out control points upward
      outControl: { x: 0, y: -oy },
      // In control points downward
      inControl: { x: 0, y: oy }
    },
    // Top point (90°)
    {
      x: centerX,
      y: centerY - radiusY,
      curve: true,
      // Out control points left
      outControl: { x: -ox, y: 0 },
      // In control points right
      inControl: { x: ox, y: 0 }
    },
    // Left point (180°)
    {
      x: centerX - radiusX,
      y: centerY,
      curve: true,
      // Out control points downward
      outControl: { x: 0, y: oy },
      // In control points upward
      inControl: { x: 0, y: -oy }
    },
    // Bottom point (270°)
    {
      x: centerX,
      y: centerY + radiusY,
      curve: true,
      // Out control points right
      outControl: { x: ox, y: 0 },
      // In control points left
      inControl: { x: -ox, y: 0 }
    }
  ];

  const path = { points: pts, closed: true };

  ensurePathStyle(path);
  path.style.fillEnabled = true; // ovals should fill by default

  const pathIndex = penToolState.paths.length;
  penToolState.paths.push(path);

  initializePathTransform(pathIndex);

  // ready for subselection edits
  selectedPath = pathIndex;
  selectedAnchor = null;
  selectedHandle = null;

  syncPickerGlobals();
  window.flashColorPickerSyncFromSelection?.();

  getPathBoundingBox(pathIndex);
  return pathIndex;
}

// ===============================
// Drawing
// ===============================
function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);

  // Stage background
  ctx.fillStyle = stage.bg;
  ctx.fillRect(0, 0, stage.width, stage.height);

  // ✅ draw all layers by layer order (NOT active-on-top)
  drawAllLayersAtCurrentFrame();

  if (activeTool === "pen") {
    drawPenPreview();
    drawAnchors();
  }

  if (activeTool === "rectangle") {
    drawRectanglePreview();
  }

  if (activeTool === "oval") {
    drawOvalPreview();
  }

  if (activeTool === "subselection") {
    drawSelectedPathAnchors();
  }

  if (activeTool === "selection" && isSvgSelected && selectedSvgGroup !== null) {
    drawSvgSelection();
  }

  if (activeTool === "selection" && isImageSelected && selectedImageInstanceId) {
    drawImageSelection();
  }

  drawMarquee();
  ctx.restore();

  // ALWAYS draw crosshair on top (screen-space)
  drawCrosshairOverlay();
}

function drawPaths() {
  penToolState.paths.forEach((path, pathIndex) => {
    if (!path || path.points.length < 2) return;

    const p2d = buildTransformedPath2D(pathIndex);
    if (!p2d) return;

    const t = pathTransformations[pathIndex];
    const baseStrokeWidth = t ? t.strokeWidth : 2;
    let lw = Math.max(0.5, baseStrokeWidth / view.scale);

    const st = ensurePathStyle(path);

    const isSelected =
      (selectedPath === pathIndex && activeTool === "subselection") ||
      (isSvgSelected && selectedSvgGroup === pathIndex);

    // Fill (only meaningful for closed paths)
    if (path.closed && st.fillEnabled && st.fill && st.fill !== "none" && st.fillA > 0) {
      const frgb = hexToRgbSafe(st.fill);
      ctx.fillStyle = `rgba(${frgb.r},${frgb.g},${frgb.b},${clamp01(st.fillA)})`;
      ctx.setLineDash([]);
      ctx.fill(p2d);
    }

    // Stroke
    const strokeHex = isSelected ? "#0066cc" : (st.stroke || "#000000");
    const strokeA = clamp01(isSelected ? 1 : (st.strokeA ?? 1));

    if (isSelected) lw = Math.max(1, (baseStrokeWidth * 1.5) / view.scale);

    const rgb = hexToRgbSafe(strokeHex);
    ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${strokeA})`;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
    ctx.stroke(p2d);
  });
}

function applyPathTransformToPoint_ForArrays(pathsArr, transformsArr, pathIndex, x, y) {
  const t = transformsArr?.[pathIndex];
  if (!t) return { x, y };

  const cx = t.pivotX ?? 0;
  const cy = t.pivotY ?? 0;

  let px = x - cx;
  let py = y - cy;

  px *= t.scaleX ?? 1;
  py *= t.scaleY ?? 1;

  const r = t.rotation ?? 0;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rx = px * cos - py * sin;
  const ry = px * sin + py * cos;

  return {
    x: rx + cx + (t.x ?? 0),
    y: ry + cy + (t.y ?? 0),
  };
}

function buildTransformedPath2D_ForArrays(pathsArr, transformsArr, pathIndex) {
  const path = pathsArr?.[pathIndex];
  if (!path || path.points.length < 2) return null;

  const P = (x, y) => applyPathTransformToPoint_ForArrays(pathsArr, transformsArr, pathIndex, x, y);
  const p2d = new Path2D();

  const first = path.points[0];
  const p0 = P(first.x, first.y);
  p2d.moveTo(p0.x, p0.y);

  for (let i = 1; i < path.points.length; i++) {
    const prev = path.points[i - 1];
    const cur = path.points[i];

    const hasBezier =
      (prev.curve || cur.curve) &&
      prev.outControl &&
      cur.inControl &&
      (prev.outControl.x || prev.outControl.y || cur.inControl.x || cur.inControl.y);

    if (hasBezier) {
      const cp1 = P(prev.x + prev.outControl.x, prev.y + prev.outControl.y);
      const cp2 = P(cur.x + cur.inControl.x, cur.y + cur.inControl.y);
      const end = P(cur.x, cur.y);
      p2d.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
    } else {
      const end = P(cur.x, cur.y);
      p2d.lineTo(end.x, end.y);
    }
  }

  if (path.closed && path.points.length >= 3) {
    const last = path.points[path.points.length - 1];
    const first2 = path.points[0];

    const hasBezier =
      (last.curve || first2.curve) &&
      last.outControl &&
      first2.inControl &&
      (last.outControl.x || last.outControl.y || first2.inControl.x || first2.inControl.y);

    if (hasBezier) {
      const cp1 = P(last.x + last.outControl.x, last.y + last.outControl.y);
      const cp2 = P(first2.x + first2.inControl.x, first2.y + first2.inControl.y);
      const end = P(first2.x, first2.y);
      p2d.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y);
    } else {
      const end = P(first2.x, first2.y);
      p2d.lineTo(end.x, end.y);
    }
  }

  return p2d;
}

// ===============================
// Draw non-active layers (view only)
// ===============================
function drawAllLayersAtCurrentFrame() {
  const frame = window.timelineCurrentFrame || 1;
  const activeLayer = window.timelineGetActiveLayer?.() ?? 0;

  const store = window.timelineStore;
  if (!store || !store.layers) return;

  // Flash-style: layer 0 is topmost, so draw from bottom -> top (highest index down to 0).
  for (let layerIndex = store.layers.length - 1; layerIndex >= 0; layerIndex--) {
    // ✅ Eye: skip hidden layers
    if (store.layers[layerIndex]?.visible === false) continue;

    if (layerIndex === activeLayer) {
      // active layer uses editor arrays (paths + transforms already loaded)
      drawPaths();
      continue;
    }

    const fr = store.layers[layerIndex]?.frames?.[String(frame)];
    if (!fr || !fr.paths || fr.paths.length === 0) continue;

    fr.paths.forEach((path, pathIndex) => {
      if (!path || path.points.length < 2) return;

      const p2d = buildTransformedPath2D_ForArrays(fr.paths, fr.transforms, pathIndex);
      if (!p2d) return;

      const t = fr.transforms?.[pathIndex];
      const baseStrokeWidth = t ? t.strokeWidth : 2;
      const lw = Math.max(0.5, baseStrokeWidth / view.scale);

      const st = ensurePathStyle(path);

      // Fill
      if (path.closed && st.fillEnabled && st.fill && st.fill !== "none" && st.fillA > 0) {
        const frgb = hexToRgbSafe(st.fill);
        ctx.fillStyle = `rgba(${frgb.r},${frgb.g},${frgb.b},${clamp01(st.fillA)})`;
        ctx.setLineDash([]);
        ctx.fill(p2d);
      }

      // Stroke
      const strokeHex = st.stroke || "#000000";
      const strokeA = clamp01(st.strokeA ?? 1);
      const rgb = hexToRgbSafe(strokeHex);

      ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${strokeA})`;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([]);
      ctx.stroke(p2d);
    });
  }
}

function drawSvgSelection() {
  if (selectedSvgGroup === null || !penToolState.paths[selectedSvgGroup]) return;

  const bbox = getPathBoundingBox(selectedSvgGroup);
  if (!bbox) return;

  ctx.save();

  ctx.strokeStyle = "#0066ff";
  ctx.lineWidth = 2 / view.scale;
  ctx.setLineDash([5 / view.scale, 3 / view.scale]);
  ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);

  // Rotation handle (top-center)
  ctx.fillStyle = "#ff9900";
  ctx.beginPath();
  ctx.arc(bbox.x + bbox.width / 2, bbox.y - 15 / view.scale, 10 / view.scale, 0, Math.PI * 2);
  ctx.fill();

  // Scale handles
  const handleSize = 10 / view.scale;
  const handles = [
    { x: bbox.x, y: bbox.y }, // TL
    { x: bbox.x + bbox.width, y: bbox.y }, // TR
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height }, // BR
    { x: bbox.x, y: bbox.y + bbox.height }, // BL
  ];

  handles.forEach((h, index) => {
    ctx.fillStyle = "#00cc00";
    if (isSvgScaling && activeScaleHandle === index + 1) ctx.fillStyle = "#ff4444";
    ctx.beginPath();
    ctx.rect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
    ctx.fill();
  });

  // Center handle ✅ stays in center now
  ctx.fillStyle = "#ff4444";
  ctx.beginPath();
  ctx.arc(bbox.centerX, bbox.centerY, 10 / view.scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawImageSelection() {
  if (!isImageSelected || !selectedImageInstanceId) return;

  const inst = getImageInstanceById(selectedImageInstanceId);
  if (!inst) return;

  const bbox = getImageBBoxWorld(inst);
  if (!bbox) return;

  ctx.save();

  ctx.strokeStyle = "#0066ff";
  ctx.lineWidth = 2 / view.scale;
  ctx.setLineDash([5 / view.scale, 3 / view.scale]);
  ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);

  // Rotation handle (top-center)
  ctx.fillStyle = "#ff9900";
  ctx.beginPath();
  ctx.arc(bbox.x + bbox.width / 2, bbox.y - 15 / view.scale, 10 / view.scale, 0, Math.PI * 2);
  ctx.fill();

  // Scale handles
  const handleSize = 10 / view.scale;
  const handles = [
    { x: bbox.x, y: bbox.y }, // TL
    { x: bbox.x + bbox.width, y: bbox.y }, // TR
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height }, // BR
    { x: bbox.x, y: bbox.y + bbox.height }, // BL
  ];

  handles.forEach((h, idx) => {
    ctx.fillStyle = "#00cc00";
    if (isImgScaling && activeImgScaleHandle === idx + 1) ctx.fillStyle = "#ff4444";
    ctx.beginPath();
    ctx.rect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
    ctx.fill();
  });

  // Center handle
  ctx.fillStyle = "#ff4444";
  ctx.beginPath();
  ctx.arc(bbox.centerX, bbox.centerY, 10 / view.scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ===============================
// Hit testing for SVG selection
// ===============================
function isPointOnPath(mousePoint, pathIndex) {
  const path = penToolState.paths[pathIndex];
  if (!path || path.points.length < 2) return false;

  let localPoint = worldToLocalPoint(pathIndex, mousePoint.x, mousePoint.y);

  for (let i = 0; i < path.points.length; i++) {
    const currentPoint = path.points[i];
    const nextPoint = path.points[(i + 1) % path.points.length];

    const hasBezier =
      (currentPoint.curve || nextPoint.curve) &&
      currentPoint.outControl &&
      nextPoint.inControl &&
      (currentPoint.outControl.x ||
        currentPoint.outControl.y ||
        nextPoint.inControl.x ||
        nextPoint.inControl.y);

    if (hasBezier) {
      const cp1x = currentPoint.x + currentPoint.outControl.x;
      const cp1y = currentPoint.y + currentPoint.outControl.y;
      const cp2x = nextPoint.x + nextPoint.inControl.x;
      const cp2y = nextPoint.y + nextPoint.inControl.y;

      for (let t = 0; t <= 1; t += 0.05) {
        const t1 = 1 - t;
        const x =
          t1 * t1 * t1 * currentPoint.x +
          3 * t1 * t1 * t * cp1x +
          3 * t1 * t * t * cp2x +
          t * t * t * nextPoint.x;
        const y =
          t1 * t1 * t1 * currentPoint.y +
          3 * t1 * t1 * t * cp1y +
          3 * t1 * t * t * cp2y +
          t * t * t * nextPoint.y;

        if (Math.sqrt((localPoint.x - x) ** 2 + (localPoint.y - y) ** 2) < 8 / view.scale) {
          return true;
        }
      }
    } else {
      if (distanceToSegment(localPoint, currentPoint, nextPoint) < 8 / view.scale) return true;
    }
  }

  return false;
}

function isPointNearRotationHandle(point, pathIndex) {
  const bbox = getPathBoundingBox(pathIndex);
  if (!bbox) return false;

  const rotationHandle = { x: bbox.x + bbox.width / 2, y: bbox.y - 15 / view.scale };
  return pointsAreClose(point, rotationHandle, 12);
}

function isPointNearScaleHandle(point, pathIndex) {
  const bbox = getPathBoundingBox(pathIndex);
  if (!bbox) return false;

  const scaleHandles = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    { x: bbox.x, y: bbox.y + bbox.height },
  ];

  for (let i = 0; i < scaleHandles.length; i++) {
    if (pointsAreClose(point, scaleHandles[i], 10)) return i + 1;
  }
  return 0;
}

function isPointNearCenterHandle(point, pathIndex) {
  const bbox = getPathBoundingBox(pathIndex);
  if (!bbox) return false;

  // ✅ uses visual center
  return pointsAreClose(point, { x: bbox.centerX, y: bbox.centerY }, 10);
}

// ===============================
// Image hit testing + bbox (stage/world coords)
// ===============================
function getImageInstanceById(id) {
  const arr = window.stageImageInstances || [];
  return arr.find((it) => it.id === id) || null;
}

function worldToImageLocal(inst, wx, wy) {
  // Convert world point into image local space (0..w, 0..h) with rotation/scale about center
  const cx = inst.x + inst.w / 2;
  const cy = inst.y + inst.h / 2;

  let x = wx - cx;
  let y = wy - cy;

  const r = -(inst.rotation || 0);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;

  const sx = inst.scaleX || 1;
  const sy = inst.scaleY || 1;
  const lsx = sx === 0 ? 1e-6 : sx;
  const lsy = sy === 0 ? 1e-6 : sy;

  const lx = rx / lsx + inst.w / 2;
  const ly = ry / lsy + inst.h / 2;
  return { x: lx, y: ly };
}

function imageLocalToWorld(inst, lx, ly) {
  const cx = inst.x + inst.w / 2;
  const cy = inst.y + inst.h / 2;

  let x = lx - inst.w / 2;
  let y = ly - inst.h / 2;

  x *= inst.scaleX || 1;
  y *= inst.scaleY || 1;

  const r = inst.rotation || 0;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;

  return { x: rx + cx, y: ry + cy };
}

function getImageBBoxWorld(inst) {
  // Axis-aligned bbox in world space based on 4 transformed corners
  const p1 = imageLocalToWorld(inst, 0, 0);
  const p2 = imageLocalToWorld(inst, inst.w, 0);
  const p3 = imageLocalToWorld(inst, inst.w, inst.h);
  const p4 = imageLocalToWorld(inst, 0, inst.h);

  const xs = [p1.x, p2.x, p3.x, p4.x];
  const ys = [p1.y, p2.y, p3.y, p4.y];

  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    // world center
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function isPointOnImage(mouseWorld, inst) {
  const lp = worldToImageLocal(inst, mouseWorld.x, mouseWorld.y);
  return lp.x >= 0 && lp.x <= inst.w && lp.y >= 0 && lp.y <= inst.h;
}

function isPointNearImageRotationHandle(mouseWorld, inst) {
  const bbox = getImageBBoxWorld(inst);
  const handle = { x: bbox.x + bbox.width / 2, y: bbox.y - 15 / view.scale };
  return pointsAreClose(mouseWorld, handle, 12);
}

function isPointNearImageScaleHandle(mouseWorld, inst) {
  const bbox = getImageBBoxWorld(inst);
  const handles = [
    { x: bbox.x, y: bbox.y }, // TL
    { x: bbox.x + bbox.width, y: bbox.y }, // TR
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height }, // BR
    { x: bbox.x, y: bbox.y + bbox.height }, // BL
  ];
  for (let i = 0; i < handles.length; i++) {
    if (pointsAreClose(mouseWorld, handles[i], 10)) return i + 1;
  }
  return 0;
}

function isPointNearImageCenterHandle(mouseWorld, inst) {
  const bbox = getImageBBoxWorld(inst);
  return pointsAreClose(mouseWorld, { x: bbox.centerX, y: bbox.centerY }, 10);
}

function pickTopmostImageInstance(mouseWorld) {
  const arr = window.stageImageInstances || [];
  // last drawn should win (topmost)
  for (let i = arr.length - 1; i >= 0; i--) {
    const inst = arr[i];
    if (isPointOnImage(mouseWorld, inst)) return inst;
  }
  return null;
}

// ===============================
// Cross-layer hit test helpers (Flash-style)
// ===============================
function worldToLocalPoint_ForArrays(transformsArr, pathIndex, wx, wy) {
  const t = transformsArr?.[pathIndex];
  if (!t) return { x: wx, y: wy };

  const cx = t.pivotX ?? 0;
  const cy = t.pivotY ?? 0;

  // remove translation
  let x = wx - (t.x ?? 0);
  let y = wy - (t.y ?? 0);

  // to pivot
  x -= cx;
  y -= cy;

  // inverse rotate
  const r = -(t.rotation ?? 0);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;

  // inverse scale
  const sx = t.scaleX ?? 1;
  const sy = t.scaleY ?? 1;
  const lsx = sx === 0 ? 1e-6 : sx;
  const lsy = sy === 0 ? 1e-6 : sy;

  // back from pivot
  return { x: rx / lsx + cx, y: ry / lsy + cy };
}

function isPointOnPath_ForArrays(pathsArr, transformsArr, mousePointWorld, pathIndex) {
  const path = pathsArr?.[pathIndex];
  if (!path || path.points.length < 2) return false;

  const localPoint = worldToLocalPoint_ForArrays(transformsArr, pathIndex, mousePointWorld.x, mousePointWorld.y);

  for (let i = 0; i < path.points.length; i++) {
    const currentPoint = path.points[i];
    const nextPoint = path.points[(i + 1) % path.points.length];

    const hasBezier =
      (currentPoint.curve || nextPoint.curve) &&
      currentPoint.outControl &&
      nextPoint.inControl &&
      (currentPoint.outControl.x ||
        currentPoint.outControl.y ||
        nextPoint.inControl.x ||
        nextPoint.inControl.y);

    if (hasBezier) {
      const cp1x = currentPoint.x + currentPoint.outControl.x;
      const cp1y = currentPoint.y + currentPoint.outControl.y;
      const cp2x = nextPoint.x + nextPoint.inControl.x;
      const cp2y = nextPoint.y + nextPoint.inControl.y;

      for (let t = 0; t <= 1; t += 0.05) {
        const t1 = 1 - t;
        const x =
          t1 * t1 * t1 * currentPoint.x +
          3 * t1 * t1 * t * cp1x +
          3 * t1 * t * t * cp2x +
          t * t * t * nextPoint.x;
        const y =
          t1 * t1 * t1 * currentPoint.y +
          3 * t1 * t1 * t * cp1y +
          3 * t1 * t * t * cp2y +
          t * t * t * nextPoint.y;

        if (Math.sqrt((localPoint.x - x) ** 2 + (localPoint.y - y) ** 2) < 8 / view.scale) {
          return true;
        }
      }
    } else {
      if (distanceToSegment(localPoint, currentPoint, nextPoint) < 8 / view.scale) return true;
    }
  }

  return false;
}

// Returns { layerIndex, pathIndex } for the TOPMOST hit (Flash-like)
function pickTopmostPathAcrossLayers(mousePointWorld) {
  const frame = window.timelineCurrentFrame || 1;
  const store = window.timelineStore;
  if (!store?.layers?.length) return null;

  // Flash-style: layer 0 is topmost, so hit-test from top -> bottom (0 up).
  for (let layerIndex = 0; layerIndex < store.layers.length; layerIndex++) {
    const fr = store.layers[layerIndex]?.frames?.[String(frame)];
    if (!fr?.paths?.length) continue;

    for (let i = fr.paths.length - 1; i >= 0; i--) {
      if (isPointOnPath_ForArrays(fr.paths, fr.transforms, mousePointWorld, i)) {
        return { layerIndex, pathIndex: i };
      }
    }
  }

  return null;
}

function pickTopmostPathAcrossLayersForSubselection(mousePointWorld) {
  const frame = window.timelineCurrentFrame || 1;
  const store = window.timelineStore;
  if (!store?.layers?.length) return null;

  // Flash-style: layer 0 is topmost, so hit-test from top -> bottom (0 up).
  for (let layerIndex = 0; layerIndex < store.layers.length; layerIndex++) {
    const fr = store.layers[layerIndex]?.frames?.[String(frame)];
    if (!fr?.paths?.length) continue;

    // We want topmost path, but also need to know if click hit an anchor/handle
    for (let i = fr.paths.length - 1; i >= 0; i--) {
      const path = fr.paths[i];
      if (!path || path.points.length < 2) continue;

      // Convert click to this path's local space
      const localPoint = worldToLocalPoint_ForArrays(fr.transforms, i, mousePointWorld.x, mousePointWorld.y);

      // Check anchors/handles first (so you can immediately drag them)
      for (let j = 0; j < path.points.length; j++) {
        const anchor = path.points[j];

        if (!anchor.outControl) anchor.outControl = { x: 20, y: 0 };
        if (!anchor.inControl) anchor.inControl = { x: -20, y: 0 };

        // anchor hit
        if (pointsAreClose(localPoint, anchor, 12)) {
          return { layerIndex, pathIndex: i, anchorIndex: j, handle: null };
        }

        // out handle hit
        const outPt = { x: anchor.x + anchor.outControl.x, y: anchor.y + anchor.outControl.y };
        if (pointsAreClose(localPoint, outPt, 10)) {
          return { layerIndex, pathIndex: i, anchorIndex: j, handle: "out" };
        }

        // in handle hit
        const inPt = { x: anchor.x + anchor.inControl.x, y: anchor.y + anchor.inControl.y };
        if (pointsAreClose(localPoint, inPt, 10)) {
          return { layerIndex, pathIndex: i, anchorIndex: j, handle: "in" };
        }
      }

      // Otherwise, hit-test stroke
      if (isPointOnPath_ForArrays(fr.paths, fr.transforms, mousePointWorld, i)) {
        return { layerIndex, pathIndex: i, anchorIndex: null, handle: null };
      }
    }
  }

  return null;
}

// ===============================
// Subselection tool logic
// ===============================
function drawSelectedPathAnchors() {
  if (activeTool !== "subselection") return;
  if (selectedPath === null) return;

  const path = penToolState.paths[selectedPath];
  if (!path) return;

  const pathIndex = selectedPath;

  path.points.forEach((point, pointIndex) => {
    const isSelected = selectedAnchor === pointIndex;

    const wAnchor = applyPathTransformToPoint(pathIndex, point.x, point.y);
    const screenX = wAnchor.x * view.scale + view.offsetX;
    const screenY = wAnchor.y * view.scale + view.offsetY;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const anchorSize = 8;
    ctx.fillStyle = isSelected ? "#ff0000" : "#0066cc";
    ctx.beginPath();
    ctx.arc(screenX, screenY, anchorSize, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screenX, screenY, anchorSize, 0, Math.PI * 2);
    ctx.stroke();

    const prevPoint =
      pointIndex > 0 ? path.points[pointIndex - 1] : path.closed ? path.points[path.points.length - 1] : null;
    const nextPoint =
      pointIndex < path.points.length - 1 ? path.points[pointIndex + 1] : path.closed ? path.points[0] : null;

    if (!point.outControl) {
      if (nextPoint) {
        const dx = nextPoint.x - point.x;
        const dy = nextPoint.y - point.y;
        point.outControl = { x: dx * 0.3, y: dy * 0.3 };
      } else {
        point.outControl = { x: 20, y: 0 };
      }
    }

    if (!point.inControl) {
      if (prevPoint) {
        const dx = point.x - prevPoint.x;
        const dy = point.y - prevPoint.y;
        point.inControl = { x: -dx * 0.3, y: -dy * 0.3 };
      } else {
        point.inControl = { x: -20, y: 0 };
      }
    }

    const outW = applyPathTransformToPoint(pathIndex, point.x + point.outControl.x, point.y + point.outControl.y);
    const inW = applyPathTransformToPoint(pathIndex, point.x + point.inControl.x, point.y + point.inControl.y);

    const outCpScreenX = outW.x * view.scale + view.offsetX;
    const outCpScreenY = outW.y * view.scale + view.offsetY;
    const inCpScreenX = inW.x * view.scale + view.offsetX;
    const inCpScreenY = inW.y * view.scale + view.offsetY;

    // out handle
    ctx.strokeStyle = isSelected && selectedHandle === "out" ? "#ff4444" : "rgba(255, 100, 100, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(screenX, screenY);
    ctx.lineTo(outCpScreenX, outCpScreenY);
    ctx.stroke();

    ctx.fillStyle = isSelected && selectedHandle === "out" ? "#ff4444" : "rgba(255, 100, 100, 0.9)";
    ctx.beginPath();
    ctx.arc(outCpScreenX, outCpScreenY, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(outCpScreenX, outCpScreenY, 6, 0, Math.PI * 2);
    ctx.stroke();

    // in handle
    ctx.strokeStyle = isSelected && selectedHandle === "in" ? "#4444ff" : "rgba(100, 100, 255, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(screenX, screenY);
    ctx.lineTo(inCpScreenX, inCpScreenY);
    ctx.stroke();

    ctx.fillStyle = isSelected && selectedHandle === "in" ? "#4444ff" : "rgba(100, 100, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(inCpScreenX, inCpScreenY, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(inCpScreenX, inCpScreenY, 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  });
}

function selectPathAtPoint(point) {
  for (let i = 0; i < penToolState.paths.length; i++) {
    const path = penToolState.paths[i];
    if (!path) continue;

    let localPoint = worldToLocalPoint(i, point.x, point.y);

    for (let j = 0; j < path.points.length; j++) {
      const anchor = path.points[j];

      if (!anchor.outControl) anchor.outControl = { x: 20, y: 0 };
      if (!anchor.inControl) anchor.inControl = { x: -20, y: 0 };

      if (pointsAreClose(localPoint, anchor, 12)) {
        selectedPath = i;
        selectedAnchor = j;
        selectedHandle = null;

        syncPickerGlobals();
        window.flashColorPickerSyncFromSelection?.();
        return true;
      }

      const outCpPoint = { x: anchor.x + anchor.outControl.x, y: anchor.y + anchor.outControl.y };
      if (pointsAreClose(localPoint, outCpPoint, 10)) {
        selectedPath = i;
        selectedAnchor = j;
        selectedHandle = "out";

        syncPickerGlobals();
        window.flashColorPickerSyncFromSelection?.();
        return true;
      }

      const inCpPoint = { x: anchor.x + anchor.inControl.x, y: anchor.y + anchor.inControl.y };
      if (pointsAreClose(localPoint, inCpPoint, 10)) {
        selectedPath = i;
        selectedAnchor = j;
        selectedHandle = "in";

        syncPickerGlobals();
        window.flashColorPickerSyncFromSelection?.();
        return true;
      }
    }

    if (isPointNearPath(localPoint, path)) {
      selectedPath = i;
      selectedAnchor = null;
      selectedHandle = null;

      syncPickerGlobals();
      window.flashColorPickerSyncFromSelection?.();
      return true;
    }
  }

  selectedPath = null;
  selectedAnchor = null;
  selectedHandle = null;

  syncPickerGlobals();
  window.flashColorPickerSyncFromSelection?.();
  return false;
}

function isPointNearPath(point, path) {
  if (!path || path.points.length < 2) return false;

  // First check bounding box for quick rejection
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of path.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  minX -= 10 / view.scale;
  minY -= 10 / view.scale;
  maxX += 10 / view.scale;
  maxY += 10 / view.scale;

  if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) return false;

  // Check each segment (including curves)
  for (let i = 0; i < path.points.length; i++) {
    const p1 = path.points[i];
    const p2 = path.points[(i + 1) % path.points.length];

    // Check if this segment has bezier curves
    const hasBezier =
      (p1.curve || p2.curve) &&
      p1.outControl && p2.inControl &&
      (p1.outControl.x || p1.outControl.y || p2.inControl.x || p2.inControl.y);

    if (hasBezier) {
      // Check distance to bezier curve
      const cp1 = { x: p1.x + p1.outControl.x, y: p1.y + p1.outControl.y };
      const cp2 = { x: p2.x + p2.inControl.x, y: p2.y + p2.inControl.y };

      // Sample points along the bezier curve to check distance
      for (let t = 0; t <= 1; t += 0.1) {
        const u = 1 - t;
        const tt = t * t;
        const uu = u * u;
        const uuu = uu * u;
        const ttt = tt * t;

        const x = uuu * p1.x + 3 * uu * t * cp1.x + 3 * u * tt * cp2.x + ttt * p2.x;
        const y = uuu * p1.y + 3 * uu * t * cp1.y + 3 * u * tt * cp2.y + ttt * p2.y;

        if (Math.sqrt((point.x - x) ** 2 + (point.y - y) ** 2) < 10 / view.scale) {
          return true;
        }
      }
    } else {
      // Check distance to straight line segment
      if (distanceToSegment(point, p1, p2) < 10 / view.scale) return true;
    }
  }

  return false;
}

function moveSelectedHandle(dx, dy) {
  if (selectedPath === null || selectedAnchor === null || !selectedHandle) return;

  const path = penToolState.paths[selectedPath];
  const point = path.points[selectedAnchor];

  if (!point.outControl) point.outControl = { x: 20, y: 0 };
  if (!point.inControl) point.inControl = { x: -20, y: 0 };

  // dragging a handle makes this point a curve point
  point.curve = true;

  if (selectedHandle === "out") {
    point.outControl.x += dx;
    point.outControl.y += dy;

    if (!isCtrlKeyPressed && !isShiftKeyPressed) {
      point.inControl.x = -point.outControl.x;
      point.inControl.y = -point.outControl.y;
    }
  } else if (selectedHandle === "in") {
    point.inControl.x += dx;
    point.inControl.y += dy;

    if (!isCtrlKeyPressed && !isShiftKeyPressed) {
      point.outControl.x = -point.inControl.x;
      point.outControl.y = -point.inControl.y;
    }
  }

  getPathBoundingBox(selectedPath);
}

// ===============================
// Pen tool
// ===============================
function addPenPoint(x, y) {
  if (penToolState.points.length > 0) {
    const newPoint = { x, y };
    for (const point of penToolState.points) {
      if (pointsAreClose(point, newPoint, 3)) return false;
    }
  }

  const point = { x, y };

  if (penToolState.mode === "curve") {
    point.curve = true;

    if (penToolState.points.length > 0) {
      const lastPoint = penToolState.points[penToolState.points.length - 1];
      const dx = x - lastPoint.x;
      const dy = y - lastPoint.y;

      if (!lastPoint.outControl) lastPoint.outControl = { x: dx * 0.3, y: dy * 0.3 };
      point.inControl = { x: -dx * 0.3, y: -dy * 0.3 };
    }
  }

  penToolState.points.push(point);
  penToolState.isDrawing = true;
  return true;
}

function finishPenPath(closePath = false) {
  if (penToolState.points.length < 2) {
    penToolState.points = [];
    penToolState.isDrawing = false;
    penToolState.tempLine = null;
    return;
  }

  if (penToolState.points.length >= 2) {
    const firstPoint = penToolState.points[0];
    const lastPoint = penToolState.points[penToolState.points.length - 1];
    if (pointsAreClose(firstPoint, lastPoint, 5)) {
      closePath = true;
      penToolState.points.pop();
    }
  }

  const cleanedPoints = [];
  for (let i = 0; i < penToolState.points.length; i++) {
    if (i === 0) cleanedPoints.push({ ...penToolState.points[i] });
    else {
      const prevPoint = cleanedPoints[cleanedPoints.length - 1];
      const currentPoint = penToolState.points[i];
      if (!pointsAreClose(prevPoint, currentPoint, 3)) cleanedPoints.push({ ...currentPoint });
    }
  }

  if (cleanedPoints.length < 2) {
    penToolState.points = [];
    penToolState.isDrawing = false;
    penToolState.tempLine = null;
    return;
  }

  // ensure in/out controls
  cleanedPoints.forEach((point, index) => {
    const prevPoint = index > 0 ? cleanedPoints[index - 1] : closePath ? cleanedPoints[cleanedPoints.length - 1] : null;
    const nextPoint = index < cleanedPoints.length - 1 ? cleanedPoints[index + 1] : closePath ? cleanedPoints[0] : null;

    if (!point.outControl) {
      if (nextPoint) {
        const dx = nextPoint.x - point.x;
        const dy = nextPoint.y - point.y;
        point.outControl = { x: dx * 0.3, y: dy * 0.3 };
      } else point.outControl = { x: 20, y: 0 };
    }

    if (!point.inControl) {
      if (prevPoint) {
        const dx = point.x - prevPoint.x;
        const dy = point.y - prevPoint.y;
        point.inControl = { x: -dx * 0.3, y: -dy * 0.3 };
      } else point.inControl = { x: -20, y: 0 };
    }
  });

  if (closePath && cleanedPoints.length >= 3) {
    const firstPoint = cleanedPoints[0];
    const lastPoint = cleanedPoints[cleanedPoints.length - 1];

    if (firstPoint.curve && lastPoint.curve) {
      const dx = firstPoint.x - lastPoint.x;
      const dy = firstPoint.y - lastPoint.y;

      if (!lastPoint.outControl) lastPoint.outControl = { x: dx * 0.3, y: dy * 0.3 };
      if (!firstPoint.inControl) firstPoint.inControl = { x: -dx * 0.3, y: -dy * 0.3 };
    }
  }

  const path = { points: cleanedPoints, closed: closePath };

  ensurePathStyle(path);
  path.style.fillEnabled = !!closePath; // fill only if closed

  const pathIndex = penToolState.paths.length;
  penToolState.paths.push(path);

  initializePathTransform(pathIndex);

  penToolState.points = [];
  penToolState.isDrawing = false;
  penToolState.tempLine = null;
  penToolState.hoverPoint = null;

  // (optional) you might want to refresh globals after creation
  syncPickerGlobals();

  const frame = window.timelineCurrentFrame || 1;
  const layer = window.timelineGetActiveLayer?.() ?? 0;
  window.timelineAddFrameContent?.(frame, layer, { dot: true }); // ✅ show dot when drawing
}

function checkCloseToFirstPoint(mousePoint) {
  if (penToolState.points.length < 2) return false;
  return pointsAreClose(penToolState.points[0], mousePoint, 10);
}

function drawPenPreview() {
  ctx.save();

  if (penToolState.points.length > 0 && penToolState.tempLine) {
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 1 / view.scale;
    ctx.setLineDash([5 / view.scale, 5 / view.scale]);

    ctx.beginPath();
    const lastPoint = penToolState.points[penToolState.points.length - 1];
    ctx.moveTo(lastPoint.x, lastPoint.y);

    if (penToolState.mode === "curve" && penToolState.tempLine.curve) {
      const cp1x = lastPoint.x + (lastPoint.outControl?.x || 0);
      const cp1y = lastPoint.y + (lastPoint.outControl?.y || 0);
      const cp2x = penToolState.tempLine.x + (penToolState.tempLine.inControl?.x || 0);
      const cp2y = penToolState.tempLine.y + (penToolState.tempLine.inControl?.y || 0);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, penToolState.tempLine.x, penToolState.tempLine.y);
    } else {
      ctx.lineTo(penToolState.tempLine.x, penToolState.tempLine.y);
    }
    ctx.stroke();
  }

  if (penToolState.points.length >= 2 && penToolState.hoverPoint) {
    const firstPoint = penToolState.points[0];
    if (pointsAreClose(firstPoint, penToolState.hoverPoint, 10)) {
      ctx.strokeStyle = "rgba(0, 150, 255, 0.8)";
      ctx.lineWidth = 2 / view.scale;
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(
        penToolState.points[penToolState.points.length - 1].x,
        penToolState.points[penToolState.points.length - 1].y
      );
      ctx.lineTo(firstPoint.x, firstPoint.y);
      ctx.stroke();

      ctx.fillStyle = "rgba(0, 150, 255, 0.3)";
      ctx.beginPath();
      ctx.arc(firstPoint.x, firstPoint.y, 8 / view.scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawAnchors() {
  ctx.save();

  penToolState.points.forEach((point, index) => {
    const size = 6 / view.scale;
    const isActive = index === penToolState.points.length - 1;

    ctx.fillStyle = isActive ? "#ff4444" : "#000000";
    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5 / view.scale;
    ctx.beginPath();
    ctx.arc(point.x, point.y, size, 0, Math.PI * 2);
    ctx.stroke();

    if (point.curve) {
      if (point.outControl) {
        ctx.strokeStyle = "rgba(255, 100, 100, 0.7)";
        ctx.lineWidth = 1 / view.scale;
        ctx.setLineDash([2 / view.scale, 2 / view.scale]);

        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x + point.outControl.x, point.y + point.outControl.y);
        ctx.stroke();

        ctx.fillStyle = "rgba(255, 100, 100, 0.9)";
        ctx.beginPath();
        ctx.arc(point.x + point.outControl.x, point.y + point.outControl.y, 4 / view.scale, 0, Math.PI * 2);
        ctx.fill();
      }

      if (point.inControl) {
        ctx.strokeStyle = "rgba(100, 100, 255, 0.7)";
        ctx.lineWidth = 1 / view.scale;
        ctx.setLineDash([2 / view.scale, 2 / view.scale]);

        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x + point.inControl.x, point.y + point.inControl.y);
        ctx.stroke();

        ctx.fillStyle = "rgba(100, 100, 255, 0.9)";
        ctx.beginPath();
        ctx.arc(point.x + point.inControl.x, point.y + point.inControl.y, 4 / view.scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  ctx.restore();
}

// ===============================
// Input: pointer events
// ===============================
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 1) e.preventDefault();
});

canvas.addEventListener("pointerdown", (e) => {
  const isLocked = (idx) => window.timelineIsLayerLocked?.(idx) === true;
  const activeLayerNow = window.timelineGetActiveLayer?.() ?? 0;

  // Middle mouse => pan viewport (ALWAYS allowed)
  if (e.pointerType === "mouse" && e.button === 1) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);

    const mousePos = getCanvasMousePos(e);

    lastMouseScreen = { x: mousePos.x, y: mousePos.y };
    hasMouse = true;

    isPanning = true;
    canvas.style.cursor = "grabbing";

    panStart = { x: mousePos.x, y: mousePos.y };
    viewStart = { x: view.offsetX, y: view.offsetY };

    isMarquee = false;
    penToolState.isDrawing = false;
    isDragging = false;
    isSvgDragging = false;
    isSvgScaling = false;
    isSvgRotating = false;
    isRectDrawing = false;
    draw();
    return;
  }

  // Subselection tool
  if (activeTool === "subselection") {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    canvas.setPointerCapture(e.pointerId);

    const mousePos = getCanvasMousePos(e);
    const pWorld = screenToStage(mousePos.x, mousePos.y);

    // Deselect SVG selection (so anchors show)
    if (isSvgSelected) {
      isSvgSelected = false;
      selectedSvgGroup = null;
      syncPickerGlobals();
      window.flashColorPickerSyncFromSelection?.();
    }

    let hit = pickTopmostPathAcrossLayersForSubselection(pWorld);

    // ✅ LOCK: ignore hits on locked layers
    if (hit && isLocked(hit.layerIndex)) hit = null;

    if (hit) {
      // Flash: clicking anything activates that layer
      window.timelineSetActiveLayer?.(hit.layerIndex);
      window.onTimelineChanged?.(window.timelineCurrentFrame || 1, hit.layerIndex);

      selectedPath = hit.pathIndex;
      selectedAnchor = hit.anchorIndex;
      selectedHandle = hit.handle;

      syncPickerGlobals();
      window.flashColorPickerSyncFromSelection?.();

      // ✅ LOCK: if the target layer is locked, do not start dragging
      if (isLocked(hit.layerIndex)) {
        isDragging = false;
        draw();
        return;
      }

      isDragging = true;

      const pLocal = worldToLocalPoint(selectedPath, pWorld.x, pWorld.y);
      dragStart = { x: pLocal.x, y: pLocal.y };

      if (selectedAnchor !== null) {
        const path = penToolState.paths[selectedPath];
        const point = path.points[selectedAnchor];

        if (!point.outControl) point.outControl = { x: 20, y: 0 };
        if (!point.inControl) point.inControl = { x: -20, y: 0 };

        if (selectedHandle === "out") {
          dragOffset = {
            x: point.x + point.outControl.x - pLocal.x,
            y: point.y + point.outControl.y - pLocal.y,
          };
        } else if (selectedHandle === "in") {
          dragOffset = {
            x: point.x + point.inControl.x - pLocal.x,
            y: point.y + point.inControl.y - pLocal.y,
          };
        } else {
          dragOffset = { x: point.x - pLocal.x, y: point.y - pLocal.y };
        }
      } else {
        dragOffset = { x: 0, y: 0 };
      }
    } else {
      isDragging = false;
      selectedPath = null;
      selectedAnchor = null;
      selectedHandle = null;

      syncPickerGlobals();
      window.flashColorPickerSyncFromSelection?.();
    }

    draw();
    return;
  }

  // ✅ LOCK: drawing tools cannot operate on locked active layer
  if (activeTool === "pen" || activeTool === "rectangle" || activeTool === "oval") {
    const layer = window.timelineGetActiveLayer?.() ?? 0;
    if (isLocked(layer)) return;
  }

  // Pen tool
  if (activeTool === "pen") {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    canvas.setPointerCapture(e.pointerId);
    const mousePos = getCanvasMousePos(e);
    const p = screenToStage(mousePos.x, mousePos.y);

    if (isSvgSelected) {
      isSvgSelected = false;
      selectedSvgGroup = null;
      syncPickerGlobals();
      window.flashColorPickerSyncFromSelection?.();
    }

    if (penToolState.points.length >= 2 && checkCloseToFirstPoint(p)) finishPenPath(true);
    else addPenPoint(p.x, p.y);

    draw();
    return;
  }

  // Rectangle tool ✅
  if (activeTool === "rectangle") {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    canvas.setPointerCapture(e.pointerId);
    const mousePos = getCanvasMousePos(e);
    const p = screenToStage(mousePos.x, mousePos.y);

    isSvgSelected = false;
    selectedSvgGroup = null;
    syncPickerGlobals();
    window.flashColorPickerSyncFromSelection?.();

    selectedAnchor = null;
    selectedHandle = null;
    isDragging = false;

    isRectDrawing = true;
    rectStart = { x: p.x, y: p.y };
    rectNow = { x: p.x, y: p.y };

    draw();
    return;
  }

  // Oval tool ✅
  if (activeTool === "oval") {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    canvas.setPointerCapture(e.pointerId);
    const mousePos = getCanvasMousePos(e);
    const p = screenToStage(mousePos.x, mousePos.y);

    isSvgSelected = false;
    selectedSvgGroup = null;
    syncPickerGlobals();
    window.flashColorPickerSyncFromSelection?.();

    selectedAnchor = null;
    selectedHandle = null;
    isDragging = false;

    isOvalDrawing = true;
    ovalStart = { x: p.x, y: p.y };
    ovalNow = { x: p.x, y: p.y };

    draw();
    return;
  }

  // Selection tool (SVG transform)
  if (activeTool === "selection") {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    canvas.setPointerCapture(e.pointerId);
    const mousePos = getCanvasMousePos(e);
    const p = screenToStage(mousePos.x, mousePos.y);

    // ✅ If selected image belongs to locked layer, disable image editing
    if (isImageSelected && selectedImageInstanceId) {
      const instSel = getImageInstanceById(selectedImageInstanceId);
      if (instSel && isLocked(instSel.layerIndex ?? activeLayerNow)) {
        isImageSelected = false;
        selectedImageInstanceId = null;
        isImgDragging = false;
        isImgScaling = false;
        isImgRotating = false;
        activeImgScaleHandle = 0;
      }
    }

    // ✅ If selected SVG belongs to locked active layer, disable svg editing
    if (isSvgSelected && selectedSvgGroup !== null) {
      const curLayer = window.timelineGetActiveLayer?.() ?? 0;
      if (isLocked(curLayer)) {
        isSvgDragging = false;
        isSvgScaling = false;
        isSvgRotating = false;
      }
    }

    // ✅ 0) If an image is already selected, allow clicking its handles even outside the image
    if (isImageSelected && selectedImageInstanceId) {
      const instSel = getImageInstanceById(selectedImageInstanceId);
      if (instSel && !isLocked(instSel.layerIndex ?? activeLayerNow)) {
        if (isPointNearImageRotationHandle(p, instSel)) {
          isImgRotating = true;
          isImgDragging = false;
          isImgScaling = false;
          activeImgScaleHandle = 0;
          imgDragStart = { x: p.x, y: p.y };
          imgInitialState = { ...instSel };
          draw();
          return;
        }

        const sh = isPointNearImageScaleHandle(p, instSel);
        if (sh > 0) {
          isImgScaling = true;
          isImgDragging = false;
          isImgRotating = false;
          activeImgScaleHandle = sh;
          imgDragStart = { x: p.x, y: p.y };
          imgInitialState = { ...instSel };
          draw();
          return;
        }

        if (isPointNearImageCenterHandle(p, instSel)) {
          isImgDragging = true;
          isImgScaling = false;
          isImgRotating = false;
          imgDragStart = { x: p.x, y: p.y };
          imgInitialState = { ...instSel };
          draw();
          return;
        }
      }
    }

    // ✅ FIRST: image selection (images are drawn on top of vectors)
    let hitImg = pickTopmostImageInstance(p);

    // ✅ LOCK: ignore images on locked layers
    if (hitImg && isLocked(hitImg.layerIndex ?? activeLayerNow)) hitImg = null;

    if (hitImg) {
      isSvgSelected = false;
      selectedSvgGroup = null;
      selectedPath = null;
      selectedAnchor = null;
      selectedHandle = null;

      isImageSelected = true;
      selectedImageInstanceId = hitImg.id;

      // handle checks
      if (isPointNearImageRotationHandle(p, hitImg)) {
        isImgRotating = true;
        isImgDragging = false;
        isImgScaling = false;
        imgDragStart = { x: p.x, y: p.y };
        imgInitialState = { ...hitImg };
        draw();
        return;
      }

      const scaleHandle = isPointNearImageScaleHandle(p, hitImg);
      if (scaleHandle > 0) {
        isImgScaling = true;
        isImgDragging = false;
        isImgRotating = false;
        activeImgScaleHandle = scaleHandle;
        imgDragStart = { x: p.x, y: p.y };
        imgInitialState = { ...hitImg };
        draw();
        return;
      }

      if (isPointNearImageCenterHandle(p, hitImg) || isPointOnImage(p, hitImg)) {
        isImgDragging = true;
        isImgScaling = false;
        isImgRotating = false;
        imgDragStart = { x: p.x, y: p.y };
        imgInitialState = { ...hitImg };
        draw();
        return;
      }
    }

    clickStartPos = { x: mousePos.x, y: mousePos.y };
    let clickedOnSomething = false;

    // Handle checks for current selection (ONLY if active layer not locked)
    if (isSvgSelected && selectedSvgGroup !== null && !isLocked(window.timelineGetActiveLayer?.() ?? 0)) {
      const pathIndex = selectedSvgGroup;

      if (isPointNearRotationHandle(p, pathIndex)) {
        isSvgRotating = true;
        isSvgDragging = false;
        isSvgScaling = false;
        svgDragStart = { x: p.x, y: p.y };

        const t = pathTransformations[pathIndex];
        if (t) {
          const local = getLocalBBox(pathIndex);
          if (local) {
            const newPivotX = local.centerX;
            const newPivotY = local.centerY;

            const before = applyPathTransformToPoint(pathIndex, newPivotX, newPivotY);
            t.pivotX = newPivotX;
            t.pivotY = newPivotY;
            const after = applyPathTransformToPoint(pathIndex, newPivotX, newPivotY);

            t.x = (t.x ?? 0) + (before.x - after.x);
            t.y = (t.y ?? 0) + (before.y - after.y);
          }
        }

        svgInitialState = { ...pathTransformations[pathIndex] };
        clickedOnSomething = true;
        draw();
        return;
      }

      const scaleHandle = isPointNearScaleHandle(p, pathIndex);
      if (scaleHandle > 0) {
        isSvgScaling = true;
        isSvgDragging = false;
        isSvgRotating = false;
        activeScaleHandle = scaleHandle;
        svgDragStart = { x: p.x, y: p.y };

        if (!pathTransformations[pathIndex]) initializePathTransform(pathIndex);
        const t = pathTransformations[pathIndex];
        if (t) {
          const bbox = getPathBoundingBox(pathIndex);
          if (bbox) {
            let oppositeX, oppositeY;

            switch (scaleHandle) {
              case 1: oppositeX = bbox.x + bbox.width; oppositeY = bbox.y + bbox.height; break;
              case 2: oppositeX = bbox.x;             oppositeY = bbox.y + bbox.height; break;
              case 3: oppositeX = bbox.x;             oppositeY = bbox.y;               break;
              case 4: oppositeX = bbox.x + bbox.width; oppositeY = bbox.y;              break;
            }

            const localOpp = worldToLocalPoint(pathIndex, oppositeX, oppositeY);

            const before = applyPathTransformToPoint(pathIndex, localOpp.x, localOpp.y);
            t.pivotX = localOpp.x;
            t.pivotY = localOpp.y;
            const after = applyPathTransformToPoint(pathIndex, localOpp.x, localOpp.y);

            t.x = (t.x ?? 0) + (before.x - after.x);
            t.y = (t.y ?? 0) + (before.y - after.y);
          }
        }

        svgInitialState = { ...pathTransformations[pathIndex] };
        clickedOnSomething = true;
        draw();
        return;
      }

      if (isPointNearCenterHandle(p, pathIndex)) {
        isSvgDragging = true;
        isSvgScaling = false;
        isSvgRotating = false;
        svgDragStart = { x: p.x, y: p.y };
        svgInitialState = { ...pathTransformations[pathIndex] };
        clickedOnSomething = true;
        draw();
        return;
      }

      if (isPointOnPath(p, pathIndex)) {
        isSvgDragging = true;
        isSvgScaling = false;
        isSvgRotating = false;
        svgDragStart = { x: p.x, y: p.y };
        svgInitialState = { ...pathTransformations[pathIndex] };
        clickedOnSomething = true;
        draw();
        return;
      }
    }

    // Select a new path by stroke (ANY layer can be selected), but NOT locked layers
    if (!clickedOnSomething) {
      let hit = pickTopmostPathAcrossLayers(p);

      // ✅ LOCK: ignore locked layer hits
      if (hit && isLocked(hit.layerIndex)) hit = null;

      if (hit) {
        window.timelineSetActiveLayer?.(hit.layerIndex);
        window.onTimelineChanged?.(window.timelineCurrentFrame || 1, hit.layerIndex);

        // ✅ after activating, if layer locked, do not select
        if (isLocked(hit.layerIndex)) {
          draw();
          return;
        }

        isSvgSelected = true;
        selectedSvgGroup = hit.pathIndex;

        isSvgDragging = true;
        isSvgScaling = false;
        isSvgRotating = false;

        svgDragStart = { x: p.x, y: p.y };
        if (!pathTransformations[hit.pathIndex]) initializePathTransform(hit.pathIndex);
        svgInitialState = { ...pathTransformations[hit.pathIndex] };

        selectedPath = null;
        selectedAnchor = null;
        selectedHandle = null;

        syncPickerGlobals();
        window.flashColorPickerSyncFromSelection?.();

        updatePropertiesPanel?.();
        draw();
        return;
      }
    }

    // Clicked empty => deselect + potential marquee
    if (!clickedOnSomething) {
      isSvgSelected = false;
      selectedSvgGroup = null;
      selectedPath = null;
      selectedAnchor = null;
      selectedHandle = null;

      isImageSelected = false;
      selectedImageInstanceId = null;
      isImgDragging = false;
      isImgScaling = false;
      isImgRotating = false;
      activeImgScaleHandle = 0;

      syncPickerGlobals();
      window.flashColorPickerSyncFromSelection?.();

      updatePropertiesPanel?.();

      isPotentialMarquee = true;
      isMarquee = false;
      marqueeStart = p;
      marqueeNow = p;

      penToolState.isDrawing = false;
      isDragging = false;
      isSvgDragging = false;
      isSvgScaling = false;
      isSvgRotating = false;
      isRectDrawing = false;
    }

    draw();
    return;
  }

  // Other tools => marquee
  if (e.pointerType === "mouse" && e.button !== 0) return;

  canvas.setPointerCapture(e.pointerId);
  const mousePos = getCanvasMousePos(e);
  const p = screenToStage(mousePos.x, mousePos.y);

  isMarquee = true;
  marqueeStart = p;
  marqueeNow = p;

  penToolState.isDrawing = false;
  isDragging = false;
  isSvgDragging = false;
  isSvgScaling = false;
  isSvgRotating = false;
  isRectDrawing = false;
  draw();
});

canvas.addEventListener("pointerleave", () => {
  hasMouse = false;
  draw();
});

canvas.addEventListener("pointermove", (e) => {
  // track mouse in SCREEN (canvas pixel) coords
  const m = getCanvasMousePos(e);
  lastMouseScreen = { x: m.x, y: m.y };
  hasMouse = true;

  const mousePos = getCanvasMousePos(e);
  const mousePoint = screenToStage(mousePos.x, mousePos.y);

  // ===============================
// Image transform drag/scale/rotate (Selection tool)
// ===============================
if (activeTool === "selection" && (isImgDragging || isImgScaling || isImgRotating) && selectedImageInstanceId) {
  const inst = getImageInstanceById(selectedImageInstanceId);
  if (!inst || !imgInitialState) return;

  const dx = mousePoint.x - imgDragStart.x;
  const dy = mousePoint.y - imgDragStart.y;

  if (isImgDragging) {
    inst.x = imgInitialState.x + dx;
    inst.y = imgInitialState.y + dy;
  } else if (isImgRotating) {
    const bbox = getImageBBoxWorld(inst);
    const cx = bbox.centerX;
    const cy = bbox.centerY;

    const startAngle = Math.atan2(imgDragStart.y - cy, imgDragStart.x - cx);
    const curAngle = Math.atan2(mousePoint.y - cy, mousePoint.x - cx);

    inst.rotation = (imgInitialState.rotation || 0) + (curAngle - startAngle);
  } else if (isImgScaling) {
    const bbox0 = getImageBBoxWorld(imgInitialState);
    if (!bbox0) return;

    let oppositeX, oppositeY;

    switch (activeImgScaleHandle) {
      case 1: oppositeX = bbox0.x + bbox0.width; oppositeY = bbox0.y + bbox0.height; break; // TL => BR
      case 2: oppositeX = bbox0.x;               oppositeY = bbox0.y + bbox0.height; break; // TR => BL
      case 3: oppositeX = bbox0.x;               oppositeY = bbox0.y;                break; // BR => TL
      case 4: oppositeX = bbox0.x + bbox0.width; oppositeY = bbox0.y;                break; // BL => TR
      default: return;
    }

    const originalW = Math.abs(oppositeX - imgDragStart.x);
    const originalH = Math.abs(oppositeY - imgDragStart.y);

    const newW = Math.abs(oppositeX - mousePoint.x);
    const newH = Math.abs(oppositeY - mousePoint.y);

    const sfx = originalW > 0 ? newW / originalW : 1;
    const sfy = originalH > 0 ? newH / originalH : 1;

    if (isShiftKeyPressed) {
      const uni = (sfx + sfy) / 2;
      inst.scaleX = Math.max(0.1, (imgInitialState.scaleX || 1) * uni);
      inst.scaleY = Math.max(0.1, (imgInitialState.scaleY || 1) * uni);
    } else {
      inst.scaleX = Math.max(0.1, (imgInitialState.scaleX || 1) * sfx);
      inst.scaleY = Math.max(0.1, (imgInitialState.scaleY || 1) * sfy);
    }
  }

  draw();
  return;
}

  // ✅ NEW: if crosshair should show, redraw on hover too
  if ((activeTool === "rectangle" && !isRectDrawing) || (activeTool === "oval" && !isOvalDrawing)) {
    draw();
    // don't return — let other logic run if needed
  }

  // pan
  if (isPanning) {
    const dx = mousePos.x - panStart.x;
    const dy = mousePos.y - panStart.y;
    view.offsetX = viewStart.x + dx;
    view.offsetY = viewStart.y + dy;
    draw();
    return;
  }

  // rectangle preview drag
  if (activeTool === "rectangle" && isRectDrawing) {
    rectNow = mousePoint;
    draw();
    return;
  }

  // SVG transform drag/scale/rotate
  if (activeTool === "selection" && (isSvgDragging || isSvgScaling || isSvgRotating) && selectedSvgGroup !== null) {
    const transform = pathTransformations[selectedSvgGroup];
    if (!transform) return;

    const dx = mousePoint.x - svgDragStart.x;
    const dy = mousePoint.y - svgDragStart.y;

    if (isSvgDragging) {
      transform.x = svgInitialState.x + dx;
      transform.y = svgInitialState.y + dy;
      updatePropertiesPanel?.();
    } else if (isSvgRotating) {
      const bbox = getPathBoundingBox(selectedSvgGroup);
      if (!bbox) return;

      // ✅ use pivot world for rotation math
      const centerX = bbox.pivotWorldX;
      const centerY = bbox.pivotWorldY;

      const startAngle = Math.atan2(svgDragStart.y - centerY, svgDragStart.x - centerX);
      const currentAngle = Math.atan2(mousePoint.y - centerY, mousePoint.x - centerX);

      transform.rotation = svgInitialState.rotation + (currentAngle - startAngle);
    } else if (isSvgScaling) {
      const initialBbox = getPathBoundingBox(selectedSvgGroup);
      if (!initialBbox) return;

      let oppositeX, oppositeY;

      switch (activeScaleHandle) {
        case 1:
          oppositeX = initialBbox.x + initialBbox.width;
          oppositeY = initialBbox.y + initialBbox.height;
          break;
        case 2:
          oppositeX = initialBbox.x;
          oppositeY = initialBbox.y + initialBbox.height;
          break;
        case 3:
          oppositeX = initialBbox.x;
          oppositeY = initialBbox.y;
          break;
        case 4:
          oppositeX = initialBbox.x + initialBbox.width;
          oppositeY = initialBbox.y;
          break;
        default:
          return;
      }

      const newX = mousePoint.x;
      const newY = mousePoint.y;

      const originalWidth = Math.abs(oppositeX - svgDragStart.x);
      const originalHeight = Math.abs(oppositeY - svgDragStart.y);

      const newWidth = Math.abs(oppositeX - newX);
      const newHeight = Math.abs(oppositeY - newY);

      const scaleFactorX = originalWidth > 0 ? newWidth / originalWidth : 1;
      const scaleFactorY = originalHeight > 0 ? newHeight / originalHeight : 1;

      if (isShiftKeyPressed) {
        const uniformScale = (scaleFactorX + scaleFactorY) / 2;
        transform.scaleX = Math.max(0.1, svgInitialState.scaleX * uniformScale);
        transform.scaleY = Math.max(0.1, svgInitialState.scaleY * uniformScale);
      } else {
        transform.scaleX = Math.max(0.1, svgInitialState.scaleX * scaleFactorX);
        transform.scaleY = Math.max(0.1, svgInitialState.scaleY * scaleFactorY);
      }

      // ✅ IMPORTANT: do NOT change transform.x/y while scaling.
      updatePropertiesPanel?.();
    }

    getPathBoundingBox(selectedSvgGroup);
    draw();
    return;
  }

  // Subselection dragging ✅ FIX: set curve=true when dragging handles
  if (activeTool === "subselection" && isDragging) {
    const pWorld = mousePoint; // already stage/world coords
    const pLocal = worldToLocalPoint(selectedPath, pWorld.x, pWorld.y);

    if (selectedPath !== null && selectedAnchor !== null) {
      const path = penToolState.paths[selectedPath];
      const pt = path.points[selectedAnchor];

      if (!pt.outControl) pt.outControl = { x: 20, y: 0 };
      if (!pt.inControl) pt.inControl = { x: -20, y: 0 };

      if (selectedHandle === "out") {
        pt.curve = true;

        const newX = pLocal.x + dragOffset.x;
        const newY = pLocal.y + dragOffset.y;
        pt.outControl.x = newX - pt.x;
        pt.outControl.y = newY - pt.y;

        if (!isCtrlKeyPressed && !isShiftKeyPressed) {
          pt.inControl.x = -pt.outControl.x;
          pt.inControl.y = -pt.outControl.y;
        }
      } else if (selectedHandle === "in") {
        pt.curve = true;

        const newX = pLocal.x + dragOffset.x;
        const newY = pLocal.y + dragOffset.y;
        pt.inControl.x = newX - pt.x;
        pt.inControl.y = newY - pt.y;

        if (!isCtrlKeyPressed && !isShiftKeyPressed) {
          pt.outControl.x = -pt.inControl.x;
          pt.outControl.y = -pt.inControl.y;
        }
      } else {
        // Move anchor ONLY (local space)
        pt.x = pLocal.x + dragOffset.x;
        pt.y = pLocal.y + dragOffset.y;
      }

      getPathBoundingBox(selectedPath);
    }

    draw();
    return;
  }

  // Pen preview
  if (activeTool === "pen") {
    penToolState.hoverPoint = mousePoint;

    if (penToolState.isDrawing && penToolState.points.length > 0) {
      penToolState.tempLine = { x: mousePoint.x, y: mousePoint.y };

      if (penToolState.mode === "curve") {
        const lastPoint = penToolState.points[penToolState.points.length - 1];
        const dx = mousePoint.x - lastPoint.x;
        const dy = mousePoint.y - lastPoint.y;

        if (!lastPoint.outControl) lastPoint.outControl = { x: dx * 0.3, y: dy * 0.3 };

        penToolState.tempLine.curve = true;
        penToolState.tempLine.inControl = { x: -dx * 0.3, y: -dy * 0.3 };
      }
    }

    draw();
    return;
  }

  // Marquee start threshold
  if (activeTool === "selection" && isPotentialMarquee && !isMarquee && !isSvgSelected) {
    const dx = mousePos.x - clickStartPos.x;
    const dy = mousePos.y - clickStartPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= MARQUEE_MIN_DRAG) {
      isMarquee = true;
      isPotentialMarquee = false;
      marqueeNow = mousePoint;
      draw();
      return;
    }
  }

  // oval preview drag
  if (activeTool === "oval" && isOvalDrawing) {
    ovalNow = mousePoint;
    draw();
    return;
  }

  if (isMarquee && activeTool === "selection") {
    marqueeNow = mousePoint;
    draw();
    return;
  }
});

canvas.addEventListener("pointerenter", (e) => {
  const m = getCanvasMousePos(e);
  lastMouseScreen = { x: m.x, y: m.y };
  hasMouse = true;
  draw();
});

canvas.addEventListener("pointerup", (e) => {
  if (isPanning) {
    isPanning = false;

    // ✅ restore cursor when pan ends
    canvas.style.cursor =
      activeTool === "pen" || activeTool === "rectangle" || activeTool === "oval" ? "none" : "default";

    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch { }
    draw();
    return;
  }

  if (activeTool === "subselection") {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    isDragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch { }
    draw();
    return;
  }

  if (activeTool === "pen") {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch { }
    draw();
    return;
  }

  // Rectangle finish
  if (activeTool === "rectangle") {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    if (isRectDrawing) {
      isRectDrawing = false;

      const created = finishRectanglePath();
      if (created != null) {
        const frame = window.timelineCurrentFrame || 1;
        const layer = window.timelineGetActiveLayer?.() ?? 0;
        window.timelineAddFrameContent?.(frame, layer, { dot: true });
      }

      updatePropertiesPanel?.();
      draw();
    }

    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch { }
    return;
  }

  // Oval finish
  if (activeTool === "oval") {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    if (isOvalDrawing) {
      isOvalDrawing = false;

      const created = finishOvalPath();
      if (created != null) {
        const frame = window.timelineCurrentFrame || 1;
        const layer = window.timelineGetActiveLayer?.() ?? 0;
        window.timelineAddFrameContent?.(frame, layer, { dot: true });
      }

      updatePropertiesPanel?.();
      draw();
    }

    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch { }
    return;
  }

  if (activeTool === "selection") {
    if (e.pointerType === "mouse" && e.button !== 0) return;

    // ✅ OPTIONAL: after scaling, restore pivot to local bbox center (no jump)
    if (selectedSvgGroup !== null && isSvgScaling) {
      const t = pathTransformations[selectedSvgGroup];
      const local = getLocalBBox(selectedSvgGroup);
      if (t && local) {
        const newPivotX = local.centerX;
        const newPivotY = local.centerY;

        const before = applyPathTransformToPoint(selectedSvgGroup, newPivotX, newPivotY);
        t.pivotX = newPivotX;
        t.pivotY = newPivotY;
        const after = applyPathTransformToPoint(selectedSvgGroup, newPivotX, newPivotY);

        t.x = (t.x ?? 0) + (before.x - after.x);
        t.y = (t.y ?? 0) + (before.y - after.y);
      }
    }

    isSvgDragging = false;
    isSvgScaling = false;
    isSvgRotating = false;
    activeScaleHandle = 0;

    isImgDragging = false;
    isImgScaling = false;
    isImgRotating = false;
    activeImgScaleHandle = 0;

    isPotentialMarquee = false;

    if (isMarquee) {
      isMarquee = false;
      draw();

      const rect = getMarqueeRect(marqueeStart, marqueeNow);

      for (let i = 0; i < penToolState.paths.length; i++) {
        const bbox = getPathBoundingBox(i);
        if (!bbox) continue;

        if (
          rect.x < bbox.x + bbox.width &&
          rect.x + rect.w > bbox.x &&
          rect.y < bbox.y + bbox.height &&
          rect.y + rect.h > bbox.y
        ) {
          isSvgSelected = true;
          selectedSvgGroup = i;
          if (!pathTransformations[i]) initializePathTransform(i);

          syncPickerGlobals();
          window.flashColorPickerSyncFromSelection?.();

          updatePropertiesPanel?.();
          break;
        }
      }
    }

    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch { }
    draw();
    return;
  }

  if (isMarquee) {
    isMarquee = false;
    draw();
  }

  try {
    canvas.releasePointerCapture(e.pointerId);
  } catch { }
});

canvas.addEventListener("contextmenu", (e) => {
  if (activeTool === "pen" && penToolState.isDrawing) {
    e.preventDefault();
    finishPenPath();
    draw();
    return false;
  }
});

canvas.addEventListener("dblclick", (e) => {
  if (activeTool === "pen" && penToolState.isDrawing) {
    e.preventDefault();

    const mousePos = getCanvasMousePos(e);
    const p = screenToStage(mousePos.x, mousePos.y);

    if (penToolState.points.length >= 2 && checkCloseToFirstPoint(p)) finishPenPath(true);
    else finishPenPath();

    draw();
  }
});

canvas.addEventListener("lostpointercapture", () => {
  if (isPanning || isMarquee || isPotentialMarquee) {
    isPanning = false;
    isMarquee = false;
    isPotentialMarquee = false;
    draw();
  }

  if (isDragging) {
    isDragging = false;
    draw();
  }

  if (isSvgDragging || isSvgScaling || isSvgRotating) {
    isSvgDragging = false;
    isSvgScaling = false;
    isSvgRotating = false;
    activeScaleHandle = 0;
    updatePropertiesPanel?.();
    draw();
  }

  if (isRectDrawing) {
    isRectDrawing = false;
    draw();
  }

  if (isOvalDrawing) {
    isOvalDrawing = false;
    draw();
  }
});

// ===============================
// Marquee drawing (stage coords)
// ===============================
function drawMarquee() {
  if (!isMarquee) return;

  const r = getMarqueeRect(marqueeStart, marqueeNow);

  ctx.save();
  ctx.lineWidth = 1 / view.scale;
  ctx.setLineDash([6 / view.scale, 4 / view.scale]);

  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.fillStyle = "rgba(0,0,0,0.08)";

  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

// ===============================
// Wheel zoom
// ===============================
canvas.addEventListener("wheel", (e) => {
    e.preventDefault();

    const mousePos = getCanvasMousePos(e);
    const mouseX = mousePos.x;
    const mouseY = mousePos.y;

    const before = screenToStage(mouseX, mouseY);

    const zoomFactor = Math.exp(-e.deltaY * 0.001);
    const newScale = clamp(view.scale * zoomFactor, view.minScale, view.maxScale);
    if (newScale === view.scale) return;

    view.scale = newScale;
    view.offsetX = mouseX - before.x * view.scale;
    view.offsetY = mouseY - before.y * view.scale;

    draw();
  },
  { passive: false }
);

window.addEventListener("resize", () => {
  resizeCanvasToViewport();
  draw();
});

// ===============================
// Key events
// ===============================
document.addEventListener("keydown", (e) => {
  if (e.key === "Control") isCtrlKeyPressed = true;
  if (e.key === "Shift") isShiftKeyPressed = true;

  // Convert selected anchor to curve
  if ((e.key === "c" || e.key === "C") && activeTool === "subselection") {
    if (selectedPath !== null && selectedAnchor !== null) {
      const path = penToolState.paths[selectedPath];
      const point = path.points[selectedAnchor];

      if (!point.curve) {
        point.curve = true;
        if (!point.outControl) point.outControl = { x: 30, y: 0 };
        if (!point.inControl) point.inControl = { x: -30, y: 0 };
        draw();
      }
    }
  }

  if (activeTool === "pen") {
    if (e.key === "Escape") {
      penToolState.points = [];
      penToolState.isDrawing = false;
      penToolState.tempLine = null;
      draw();
    }
    if (e.key === "Enter") {
      finishPenPath();
      draw();
    }
    if (e.key === "c" || e.key === "C") {
      penToolState.mode = penToolState.mode === "corner" ? "curve" : "corner";
    }
  }

  if (activeTool === "subselection" && (e.key === "Delete")) {
    if (selectedPath !== null && selectedAnchor !== null) {
      const path = penToolState.paths[selectedPath];

      if (path.points.length > 2) {
        path.points.splice(selectedAnchor, 1);

        if (path.closed && path.points.length < 3) path.closed = false;

        selectedAnchor = null;
        selectedHandle = null;
        getPathBoundingBox(selectedPath);
        draw();
      } else if (path.points.length === 2) {
        penToolState.paths.splice(selectedPath, 1);
        pathTransformations.splice(selectedPath, 1);
        selectedPath = null;
        selectedAnchor = null;
        selectedHandle = null;

        syncPickerGlobals();
        window.flashColorPickerSyncFromSelection?.();
        draw();
      }
    } else if (selectedPath !== null && selectedAnchor === null) {
      penToolState.paths.splice(selectedSvgGroup, 1);
      pathTransformations.splice(selectedSvgGroup, 1);

      isSvgSelected = false;
      selectedSvgGroup = null;

      // ✅ HERE (after splice, before draw)
      const { frame, layerIndex } = commitActiveSvgToTimelineStore();
      window.timelineRecomputeDot?.(frame, layerIndex);

      draw();
    }
  }

  if (activeTool === "selection" && (e.key === "Delete")) {
    // ✅ Delete selected image instance (does NOT delete library asset)
    if (isImageSelected && selectedImageInstanceId) {
      window.stageDeleteImageInstance?.(selectedImageInstanceId);
      isImageSelected = false;
      selectedImageInstanceId = null;
      draw();
      return;
    }

    if (isSvgSelected && selectedSvgGroup !== null) {
      penToolState.paths.splice(selectedSvgGroup, 1);
      pathTransformations.splice(selectedSvgGroup, 1);

      isSvgSelected = false;
      selectedSvgGroup = null;
      syncPickerGlobals();
      window.flashColorPickerSyncFromSelection?.();

      // ✅ NEW: save updated SVG state into timelineStore and recompute dot
      const { frame, layerIndex } = commitActiveSvgToTimelineStore();
      window.timelineRecomputeDot?.(frame, layerIndex); // or recomputeTimelineDot(frame, layerIndex)

      draw();
    }
  }

  if ((e.key === "g" || e.key === "G") && e.ctrlKey && activeTool === "selection") {
    e.preventDefault();
  }
});

document.addEventListener("keyup", (e) => {
  if (e.key === "Control") isCtrlKeyPressed = false;
  if (e.key === "Shift") isShiftKeyPressed = false;
});

// ===============================
// Init
// ===============================
resizeCanvasToViewport();

// ✅ initialize editor to (frame 1, layer 0)
loadTimelineFrameLayer(window.timelineCurrentFrame || 1, window.timelineGetActiveLayer?.() ?? 0);

// ===============================
// ✅ Expose needed bits for other modules (library_images.js)
// ===============================
window.ctx = ctx;
window.view = view;
window.draw = draw;
window.drawAllLayersAtCurrentFrame = drawAllLayersAtCurrentFrame;
window.screenToStage = screenToStage;

draw();
