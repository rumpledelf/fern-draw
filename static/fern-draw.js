const fernEditor = document.querySelector("[data-svg-editor]");

const FERN_SVG_NS = "http://www.w3.org/2000/svg";
const FERN_EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
const FERN_MAX_LOCAL_FILE_BYTES = 10 * 1024 * 1024;
const FERN_DEFAULT_COLORS = [
  "#000000", "#FFFFFF", "#8FC7E8", "#416A9B", "#78A568", "#9A704F",
  "#8B9291", "#D58FA3", "#C9655A", "#D98B4A", "#9278AD", "#E0BD58",
];
const FERN_AUTOSAVE_KEY = "fern_draw_autosave_v1";
const FERN_PALETTE_STORAGE_KEY = "fern_draw_palette_v1";
const FERN_TOOLBAR_COLORS_STORAGE_KEY = "fern_draw_toolbar_colors_v1";
const FERN_LOADED_COLOR_SET_STORAGE_KEY = "fern_draw_loaded_color_set_v1";

function fern_autoSaveLocal() {
  if (!fernActiveSvg) {
    return;
  }
  try {
    const content = fern_cleanForSave();
    const payload = {
      content,
      fileName: fernCurrentFileName,
      timestamp: Date.now(),
    };
    localStorage.setItem(FERN_AUTOSAVE_KEY, JSON.stringify(payload));
  } catch (_e) {}
}

function fern_clearAutoSaveLocal() {
  try {
    localStorage.removeItem(FERN_AUTOSAVE_KEY);
  } catch (_e) {}
}

function fern_loadAutoSavedDraft() {
  try {
    const raw = localStorage.getItem(FERN_AUTOSAVE_KEY);
    if (!raw) {
      return false;
    }
    const payload = JSON.parse(raw);
    if (payload && payload.content && payload.content.trim().length > 0) {
      fern_loadLocalSvg(payload.content, payload.fileName || "untitled.svg");
      fern_setEditorStatus(`Restored draft: ${payload.fileName || "untitled.svg"}`);
      return true;
    }
  } catch (_e) {}
  return false;
}
const FERN_COMMON_ATTRS = ["stroke", "stroke-width", "fill", "opacity"];
const FERN_SHAPE_ATTRS = {
  path: [],
  rect: ["x", "y", "width", "height", "rx"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2"],
  text: ["x", "y"],
  polygon: ["points"],
  polyline: ["points"],
};

let fernActiveSvg = null;
let fernSelectedElement = null;
let fernCurrentFileName = "untitled.svg";
let fernLocalFileHandle = null;
let fernOriginalSvgContent = FERN_EMPTY_SVG;
let fernDragState = null;
let fernPointDragState = null;
let fernGridGroup = null;
let fernSelectedPointIndex = null;
let fernSelectedNodeIndices = new Set();
const fernToolbarColors = { fill: "#ffffff", stroke: "#000000" };
let fernPaletteColors = [...FERN_DEFAULT_COLORS];
let fernPaletteDraftColors = null;
let fernActivePaletteSlot = 0;
let fernToolbarEditRole = "";
let fernToolbarEditSource = "toolbar";
let fernLoadedColorSetId = "";
let fernLoadedColorSetName = "";
let fernPaletteDraftLoadedColorSetId = "";
let fernPaletteDraftLoadedColorSetName = "";
let fernSessionAuthenticated = Boolean(
  document.body && document.body.dataset && document.body.dataset.fernAuthenticated === "true"
);
let fernUndoStack = [];
let fernRedoStack = [];
let fernPendingHistoryState = null;
let fernDocumentViewBox = null;
let fernZoomLevel = 1;
let fernZoomCenter = null;
let fernPanState = null;
let fernSpacePressed = false;
let fernAddNodeMode = false;
let fernDrawPathMode = false;
let fernPathBuildingPoints = [];
let fernDrawingPathElement = null;

function fern_saveLocalPalette() {
  try {
    localStorage.setItem(FERN_PALETTE_STORAGE_KEY, JSON.stringify(fernPaletteColors));
  } catch (_e) {}
}

function fern_loadLocalPalette() {
  try {
    const raw = localStorage.getItem(FERN_PALETTE_STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const colors = JSON.parse(raw);
    if (!Array.isArray(colors) || colors.length !== FERN_DEFAULT_COLORS.length) {
      return false;
    }
    const normalized = colors.map((color) => fern_normalizePaletteColor(color));
    if (normalized.some((color) => !color)) {
      return false;
    }
    fernPaletteColors = normalized;
    return true;
  } catch (_e) {
    return false;
  }
}

function fern_saveToolbarColors() {
  try {
    localStorage.setItem(FERN_TOOLBAR_COLORS_STORAGE_KEY, JSON.stringify(fernToolbarColors));
  } catch (_e) {}
}

function fern_loadToolbarColors() {
  try {
    const raw = localStorage.getItem(FERN_TOOLBAR_COLORS_STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const saved = JSON.parse(raw);
    const fill = fern_normalizePaletteColor(saved.fill);
    const stroke = fern_normalizePaletteColor(saved.stroke);
    if (!fill || !stroke) {
      return false;
    }
    fernToolbarColors.fill = fill;
    fernToolbarColors.stroke = stroke;
    return true;
  } catch (_e) {
    return false;
  }
}

function fern_saveLoadedColorSet() {
  try {
    if (fernLoadedColorSetId && fernLoadedColorSetName) {
      localStorage.setItem(
        FERN_LOADED_COLOR_SET_STORAGE_KEY,
        JSON.stringify({ id: fernLoadedColorSetId, name: fernLoadedColorSetName })
      );
    } else {
      localStorage.removeItem(FERN_LOADED_COLOR_SET_STORAGE_KEY);
    }
  } catch (_e) {}
}

function fern_loadLoadedColorSet() {
  try {
    const raw = localStorage.getItem(FERN_LOADED_COLOR_SET_STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const saved = JSON.parse(raw);
    if (!saved.id || !saved.name) {
      return false;
    }
    fernLoadedColorSetId = String(saved.id);
    fernLoadedColorSetName = String(saved.name);
    return true;
  } catch (_e) {
    return false;
  }
}

function fern_activateDrawPathMode() {
  fernDrawPathMode = true;
  fernPathBuildingPoints = [];
  fernDrawingPathElement = null;
  if (fernActiveSvg) {
    fernActiveSvg.classList.add("is-drawing-path");
  }
  fern_setEditorStatus("Click canvas to place path points. Double-click to close path.");
}

function fern_updateDrawingPath(currentPointer = null) {
  if (!fernDrawingPathElement || fernPathBuildingPoints.length === 0) {
    return;
  }
  let d = `M ${fernPathBuildingPoints[0].x} ${fernPathBuildingPoints[0].y}`;
  for (let i = 1; i < fernPathBuildingPoints.length; i += 1) {
    d += ` L ${fernPathBuildingPoints[i].x} ${fernPathBuildingPoints[i].y}`;
  }
  if (currentPointer) {
    d += ` L ${fern_snap(currentPointer.x)} ${fern_snap(currentPointer.y)}`;
  }
  fernDrawingPathElement.setAttribute("d", d);
}

function fern_finishDrawPath(closed = true) {
  if (!fernDrawPathMode) {
    return;
  }
  if (fernDrawingPathElement && fernPathBuildingPoints.length > 1) {
    let d = `M ${fernPathBuildingPoints[0].x} ${fernPathBuildingPoints[0].y}`;
    for (let i = 1; i < fernPathBuildingPoints.length; i += 1) {
      d += ` L ${fernPathBuildingPoints[i].x} ${fernPathBuildingPoints[i].y}`;
    }
    if (closed) {
      d += " Z";
    }
    fernDrawingPathElement.setAttribute("d", d);
    fern_selectElement(fernDrawingPathElement);
    fern_commitHistory();
    fern_setEditorStatus(closed ? "Closed path created." : "Open path created.");
  } else if (fernDrawingPathElement) {
    fernDrawingPathElement.remove();
    fern_selectElement(null);
  }
  fernDrawPathMode = false;
  fernPathBuildingPoints = [];
  fernDrawingPathElement = null;
  if (fernActiveSvg) {
    fernActiveSvg.classList.remove("is-drawing-path");
  }
}

function fern_snap(value) {
  return Math.round(value);
}

function fern_setEditorStatus(message) {
  const status = fernEditor.querySelector("[data-editor-status]");
  if (status) {
    status.textContent = message;
  }
}

function fern_setCoordinateReadout(x = null, y = null) {
  const readout = fernEditor.querySelector("[data-coordinate-readout]");
  if (!readout) {
    return;
  }

  if (Number.isFinite(x) && Number.isFinite(y)) {
    readout.textContent = `${fern_snap(x)}, ${fern_snap(y)}`;
  } else {
    readout.textContent = "--, --";
  }
}

function fern_editableElements(svg = fernActiveSvg) {
  if (!svg) {
    return [];
  }

  return [...svg.querySelectorAll(Object.keys(FERN_SHAPE_ATTRS).join(","))].filter((element) => (
    !element.closest("[data-editor-handles]") && !element.closest("[data-editor-grid]")
  ));
}

function fern_captureEditorState() {
  if (!fernActiveSvg) {
    return null;
  }

  const clone = fernActiveSvg.cloneNode(true);
  clone.querySelectorAll("[data-editor-handles], [data-editor-grid]").forEach((element) => element.remove());
  clone.querySelectorAll(".is-svg-selected").forEach((element) => element.classList.remove("is-svg-selected"));
  const elements = fern_editableElements();

  return {
    markup: clone.innerHTML,
    selectedElementIndex: elements.indexOf(fernSelectedElement),
    fernSelectedPointIndex,
    fernSelectedNodeIndices: [...fernSelectedNodeIndices],
  };
}

function fern_updateHistoryControls() {
  const undoElements = fernEditor.querySelectorAll('[data-action="fern_undo"]');
  const redoElements = fernEditor.querySelectorAll('[data-action="fern_redo"]');

  const canUndo = fernUndoStack.length > 0;
  const canRedo = fernRedoStack.length > 0;

  undoElements.forEach((element) => {
    if ("disabled" in element) {
      element.disabled = !canUndo;
    }
    element.classList.toggle("is-disabled", !canUndo);
  });

  redoElements.forEach((element) => {
    if ("disabled" in element) {
      element.disabled = !canRedo;
    }
    element.classList.toggle("is-disabled", !canRedo);
  });
}

function fern_beginHistory() {
  if (!fernPendingHistoryState) {
    fernPendingHistoryState = fern_captureEditorState();
  }
}

function fern_commitHistory() {
  if (!fernPendingHistoryState) {
    return;
  }

  const current = fern_captureEditorState();
  if (current && current.markup !== fernPendingHistoryState.markup) {
    fernUndoStack.push(fernPendingHistoryState);
    if (fernUndoStack.length > 100) {
      fernUndoStack.shift();
    }
    fernRedoStack = [];
  }
  fernPendingHistoryState = null;
  fern_updateHistoryControls();
  fern_autoSaveLocal();
}

function fern_restoreEditorState(state) {
  if (!fernActiveSvg || !state) {
    return;
  }

  fern_clearHandles();
  fernActiveSvg.innerHTML = state.markup;
  fernGridGroup = null;
  fernSelectedElement = null;
  fernSelectedPointIndex = null;
  fernSelectedNodeIndices = new Set();
  fern_renderGrid();

  const element = fern_editableElements()[state.selectedElementIndex] || null;
  fern_selectElement(element);
  if (element) {
    fernSelectedPointIndex = state.fernSelectedPointIndex;
    fernSelectedNodeIndices = new Set(state.fernSelectedNodeIndices);
    fern_renderPointHandles();
  }
}

function fern_undo() {
  const state = fernUndoStack.pop();
  if (!state) {
    return;
  }

  fernRedoStack.push(fern_captureEditorState());
  fern_restoreEditorState(state);
  fern_updateHistoryControls();
  fern_setEditorStatus("Undid edit.");
}

function fern_redo() {
  const state = fernRedoStack.pop();
  if (!state) {
    return;
  }

  fernUndoStack.push(fern_captureEditorState());
  fern_restoreEditorState(state);
  fern_updateHistoryControls();
  fern_setEditorStatus("Redid edit.");
}

function fern_escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function fern_getCanvasPoint(event) {
  const point = fernActiveSvg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(fernActiveSvg.getScreenCTM().inverse());
}

function fern_getTagName(element) {
  return element.tagName.toLowerCase().replace(/^svg:/, "");
}

function fern_formatNumber(value) {
  return Number.parseFloat(value.toFixed(2)).toString();
}

function fern_numericAttr(element, attr, fallback = 0) {
  const value = Number.parseFloat(element.getAttribute(attr));
  return Number.isFinite(value) ? value : fallback;
}

function fern_setNumericAttr(element, attr, value) {
  element.setAttribute(attr, fern_formatNumber(value));
}

function fern_nodeModeKey(ref) {
  if (!ref) {
    return "";
  }
  if (ref.xRef) {
    return String(ref.xRef.tokenIndex);
  }
  if (ref.yRef) {
    return String(ref.yRef.tokenIndex);
  }
  return "";
}

function fern_getNodeModeOverrides(element) {
  try {
    return JSON.parse(element.getAttribute("data-node-modes") || "{}");
  } catch (_error) {
    return {};
  }
}

function fern_setNodeModeOverride(element, ref, mode) {
  const key = fern_nodeModeKey(ref);
  if (!key) {
    return;
  }

  const modes = fern_getNodeModeOverrides(element);
  modes[key] = mode;
  element.setAttribute("data-node-modes", JSON.stringify(modes));
}

function fern_hasSmoothControlGeometry(anchor) {
  if (!anchor.controls || anchor.controls.length < 2) {
    return false;
  }

  const [first, second] = anchor.controls;
  const firstX = first.x - anchor.x;
  const firstY = first.y - anchor.y;
  const secondX = second.x - anchor.x;
  const secondY = second.y - anchor.y;
  const cross = firstX * secondY - firstY * secondX;
  const scale = Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY);
  const dot = firstX * secondX + firstY * secondY;
  return scale > 0 && dot < 0 && Math.abs(cross) / scale < 0.02;
}

function fern_selectableTarget(target) {
  if (!fernActiveSvg || target === fernActiveSvg || !fernActiveSvg.contains(target)) {
    return null;
  }
  if (target.closest("[data-editor-handles]") || target.closest("[data-editor-grid]")) {
    return null;
  }

  const group = target.closest("g");
  if (group && group !== fernActiveSvg && !group.closest("[data-editor-handles]") && !group.closest("[data-editor-grid]")) {
    if (fernSelectedElement === group) {
      const tag = fern_getTagName(target);
      return (FERN_SHAPE_ATTRS[tag] || tag === "circle") ? target : group;
    }
    return group;
  }

  const tag = fern_getTagName(target);
  return (FERN_SHAPE_ATTRS[tag] || tag === "circle" || tag === "g") ? target : null;
}

function fern_clearHandles() {
  if (!fernActiveSvg) {
    return;
  }

  for (const group of fernActiveSvg.querySelectorAll("[data-editor-handles]")) {
    group.remove();
  }
}

function fern_renderGrid() {
  if (!fernActiveSvg) {
    return;
  }

  if (fernGridGroup) {
    fernGridGroup.remove();
  }

  const viewBox = fern_getViewBox();
  fernGridGroup = document.createElementNS(FERN_SVG_NS, "g");
  fernGridGroup.setAttribute("data-editor-grid", "");
  fernGridGroup.setAttribute("aria-hidden", "true");

  for (let value = viewBox.x; value <= viewBox.x + viewBox.width; value += 1) {
    const isMajor = (value - viewBox.x) % 10 === 0;
    const vertical = document.createElementNS(FERN_SVG_NS, "line");
    vertical.setAttribute("x1", value);
    vertical.setAttribute("y1", viewBox.y);
    vertical.setAttribute("x2", value);
    vertical.setAttribute("y2", viewBox.y + viewBox.height);
    vertical.setAttribute("class", isMajor ? "svg-grid-line svg-grid-major" : "svg-grid-line");
    fernGridGroup.append(vertical);

    const horizontal = document.createElementNS(FERN_SVG_NS, "line");
    horizontal.setAttribute("x1", viewBox.x);
    horizontal.setAttribute("y1", value);
    horizontal.setAttribute("x2", viewBox.x + viewBox.width);
    horizontal.setAttribute("y2", value);
    horizontal.setAttribute("class", isMajor ? "svg-grid-line svg-grid-major" : "svg-grid-line");
    fernGridGroup.append(horizontal);
  }

  const centerV = document.createElementNS(FERN_SVG_NS, "line");
  centerV.setAttribute("x1", viewBox.cx);
  centerV.setAttribute("y1", viewBox.y);
  centerV.setAttribute("x2", viewBox.cx);
  centerV.setAttribute("y2", viewBox.y + viewBox.height);
  centerV.setAttribute("class", "svg-grid-center");
  fernGridGroup.append(centerV);

  const centerH = document.createElementNS(FERN_SVG_NS, "line");
  centerH.setAttribute("x1", viewBox.x);
  centerH.setAttribute("y1", viewBox.cy);
  centerH.setAttribute("x2", viewBox.x + viewBox.width);
  centerH.setAttribute("y2", viewBox.cy);
  centerH.setAttribute("class", "svg-grid-center");
  fernGridGroup.append(centerH);

  fernActiveSvg.prepend(fernGridGroup);
}

function fern_selectElement(element) {
  if (fernSelectedElement) {
    fernSelectedElement.classList.remove("is-svg-selected");
  }

  fern_clearHandles();
  fernSelectedElement = element;
  fernSelectedPointIndex = null;
  fernSelectedNodeIndices = new Set();

  if (fernSelectedElement) {
    fernSelectedElement.classList.add("is-svg-selected");
  }

  fern_renderInspector();
  fern_renderPointHandles();
  fern_setCoordinateReadout();
  fern_syncToolbarColors();
}

function fern_fieldTemplate(attr, value, multiline = false) {
  if (multiline) {
    return `
      <label>
        <span>${attr}</span>
        <textarea data-attr="${attr}" spellcheck="false">${value}</textarea>
      </label>
    `;
  }

  return `
    <label>
      <span>${attr}</span>
      <input data-attr="${attr}" value="${value}">
    </label>
  `;
}

let fernCanvasBgMode = "dark";

function fern_colorToHex(colorStr, fallback = "#ffffff") {
  if (!colorStr || colorStr === "none" || colorStr === "transparent") {
    return fallback;
  }
  colorStr = colorStr.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(colorStr)) {
    return colorStr;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(colorStr)) {
    return `#${colorStr[1]}${colorStr[1]}${colorStr[2]}${colorStr[2]}${colorStr[3]}${colorStr[3]}`;
  }
  try {
    const dummy = document.createElement("div");
    dummy.style.color = colorStr;
    document.body.appendChild(dummy);
    const cs = window.getComputedStyle(dummy).color;
    dummy.remove();
    const match = cs.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
    if (match) {
      const r = Number.parseInt(match[1], 10).toString(16).padStart(2, "0");
      const g = Number.parseInt(match[2], 10).toString(16).padStart(2, "0");
      const b = Number.parseInt(match[3], 10).toString(16).padStart(2, "0");
      return `#${r}${g}${b}`;
    }
  } catch (e) {
    // Return fallback if DOM query fails
  }
  return fallback;
}

function fern_syncToolbarColors() {
  for (const swatch of fernEditor.querySelectorAll("[data-toolbar-swatch]")) {
    const color = fernToolbarColors[swatch.dataset.toolbarSwatch] || "#ffffff";
    swatch.style.backgroundColor = color;
  }
}

function fern_setToolbarColor(role, value, updateDefaults = true) {
  const color = fern_colorToHex(value, fernToolbarColors[role] || "#ffffff").toUpperCase();
  if (updateDefaults) {
    fernToolbarColors[role] = color;
    fern_saveToolbarColors();
    fern_syncToolbarColors();
    fern_setEditorStatus(`${role === "fill" ? "Fill" : "Stroke"} color set for the next shape.`);
    return;
  }
  if (!fernSelectedElement) {
    fern_setEditorStatus(`Select a shape to edit its ${role} color.`);
    return;
  }
  fern_beginHistory();
  fernSelectedElement.setAttribute(role, color);
  fern_commitHistory();
  fern_autoSaveLocal();
  fern_renderInspector();
  fern_setEditorStatus(`${role === "fill" ? "Fill" : "Stroke"} color updated.`);
}

function fern_normalizePaletteColor(value) {
  const color = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase();
  }
  return "";
}

function fern_hexToHsv(value) {
  const color = fern_normalizePaletteColor(value) || "#000000";
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }
  if (hue < 0) {
    hue += 360;
  }
  return { h: hue, s: max ? delta / max : 0, v: max };
}

function fern_hsvToHex({ h, s, v }) {
  const chroma = v * s;
  const segment = (h / 60) % 6;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const match = v - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (segment < 1) [red, green, blue] = [chroma, x, 0];
  else if (segment < 2) [red, green, blue] = [x, chroma, 0];
  else if (segment < 3) [red, green, blue] = [0, chroma, x];
  else if (segment < 4) [red, green, blue] = [0, x, chroma];
  else if (segment < 5) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];
  return `#${[red, green, blue].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function fern_renderInlineColorPicker(dialog, color, surfaceSelector, thumbSelector, hueSelector) {
  const surface = dialog.querySelector(surfaceSelector);
  const thumb = dialog.querySelector(thumbSelector);
  const hue = dialog.querySelector(hueSelector);
  if (!surface || !thumb) {
    return;
  }
  const hsv = fern_hexToHsv(color);
  surface.style.background = `linear-gradient(to top, #000000, transparent), linear-gradient(to right, #FFFFFF, hsl(${hsv.h} 100% 50%))`;
  thumb.style.left = `${hsv.s * 100}%`;
  thumb.style.top = `${(1 - hsv.v) * 100}%`;
  if (hue) {
    hue.value = String(Math.round(hsv.h));
  }
}

function fern_paletteEditorColors() {
  return fernPaletteDraftColors || fernPaletteColors;
}

function fern_renderPaletteEditor() {
  const dialog = fernEditor.querySelector("[data-color-dialog]");
  if (!dialog) {
    return;
  }
  const slots = dialog.querySelector("[data-palette-slots]");
  const activeLabel = dialog.querySelector("[data-active-color-label]");
  const activeSwatch = dialog.querySelector("[data-active-color-swatch]");
  const hex = dialog.querySelector("[data-palette-hex]");
  const title = dialog.querySelector("h2");
  const colors = fern_paletteEditorColors();
  if (slots) {
    slots.innerHTML = colors.map((color, index) => `
      <button class="draw-palette-slot${index === fernActivePaletteSlot ? " is-active" : ""}" type="button" data-palette-slot="${index}">
        <span class="draw-palette-swatch" style="background: ${color}"></span>
        <span>Color ${index + 1}</span>
      </button>
    `).join("");
  }
  if (activeLabel) {
    activeLabel.textContent = `Color ${fernActivePaletteSlot + 1}`;
  }
  const activeColor = colors[fernActivePaletteSlot] || "#000000";
  if (hex) {
    hex.value = activeColor;
  }
  if (activeSwatch) {
    activeSwatch.style.backgroundColor = activeColor;
  }
  if (title) {
    const loadedName = fernPaletteDraftColors ? fernPaletteDraftLoadedColorSetName : fernLoadedColorSetName;
    const loadedId = fernPaletteDraftColors ? fernPaletteDraftLoadedColorSetId : fernLoadedColorSetId;
    title.textContent = fernSessionAuthenticated && loadedId && loadedName
      ? `Edit colors - ${loadedName}`
      : "Edit colors";
  }
  fern_renderInlineColorPicker(dialog, activeColor, "[data-palette-picker-surface]", "[data-palette-picker-thumb]", "[data-palette-picker-hue]");
}

function fern_setActivePaletteSlot(index) {
  fernActivePaletteSlot = Math.max(0, Math.min(fern_paletteEditorColors().length - 1, Number(index) || 0));
  fern_renderPaletteEditor();
}

function fern_updateActivePaletteColor(value, rerender = true) {
  const color = fern_normalizePaletteColor(value);
  if (!color) {
    fern_setEditorStatus("Enter a six-digit hex color.");
    return;
  }
  const colors = fern_paletteEditorColors();
  colors[fernActivePaletteSlot] = color;
  if (!fernPaletteDraftColors) {
    fern_saveLocalPalette();
  }
  const dialog = fernEditor.querySelector("[data-color-dialog]");
  if (rerender) {
    fern_renderPaletteEditor();
  } else if (dialog) {
    const activeSwatch = dialog.querySelector(`[data-palette-slot="${fernActivePaletteSlot}"] .draw-palette-swatch`);
    const detailSwatch = dialog.querySelector("[data-active-color-swatch]");
    if (activeSwatch) {
      activeSwatch.style.background = color;
    }
    if (detailSwatch) {
      detailSwatch.style.backgroundColor = color;
    }
    fern_renderInlineColorPicker(dialog, color, "[data-palette-picker-surface]", "[data-palette-picker-thumb]", "[data-palette-picker-hue]");
  }
}

function fern_renderToolbarColorEditor() {
  const dialog = fernEditor.querySelector("[data-toolbar-color-dialog]");
  if (!dialog || !fernToolbarEditRole) {
    return;
  }
  const color = fernToolbarColors[fernToolbarEditRole] || "#FFFFFF";
  const title = dialog.querySelector("h2");
  const hex = dialog.querySelector("[data-toolbar-color-hex]");
  const choices = dialog.querySelector("[data-toolbar-color-choices]");
  if (title) {
    title.textContent = `Edit ${fernToolbarEditRole === "fill" ? "Fill" : "Stroke"} color`;
  }
  if (hex) {
    hex.value = color;
  }
  fern_renderInlineColorPicker(dialog, color, "[data-toolbar-color-picker-surface]", "[data-toolbar-color-picker-thumb]", "[data-toolbar-color-picker-hue]");
  if (choices) {
    choices.innerHTML = fernPaletteColors.map((paletteColor, index) => `
      <button class="draw-palette-choice" type="button" data-toolbar-color-choice="${index}" title="Use Color ${index + 1}">
        <span class="draw-palette-swatch" style="background: ${paletteColor}"></span>
      </button>
    `).join("");
  }
}

function fern_updateToolbarColorFromValue(value, rerender = true) {
  const color = fern_normalizePaletteColor(value);
  if (!color) {
    fern_setEditorStatus("Enter a six-digit hex color.");
    return;
  }
  if (fernToolbarEditRole) {
    fern_setToolbarColor(fernToolbarEditRole, color, fernToolbarEditSource === "toolbar");
    const dialog = fernEditor.querySelector("[data-toolbar-color-dialog]");
    if (rerender) {
      fern_renderToolbarColorEditor();
    } else if (dialog) {
      fern_renderInlineColorPicker(dialog, color, "[data-toolbar-color-picker-surface]", "[data-toolbar-color-picker-thumb]", "[data-toolbar-color-picker-hue]");
    }
  }
}

function fern_applyToolbarPaletteChoice(index) {
  const color = fernPaletteColors[Number(index)];
  if (color && fernToolbarEditRole) {
    fern_setToolbarColor(fernToolbarEditRole, color, fernToolbarEditSource === "toolbar");
    fern_renderToolbarColorEditor();
  }
}

function fern_renderColorSetAccess() {
  const controls = fernEditor.querySelector("[data-color-set-account-controls]");
  const loginMessage = fernEditor.querySelector("[data-color-set-login-message]");
  const saveAccount = fernEditor.querySelector("[data-color-set-save-account]");
  if (controls) {
    controls.hidden = !fernSessionAuthenticated;
  }
  if (loginMessage) {
    loginMessage.hidden = fernSessionAuthenticated;
  }
  if (saveAccount) {
    saveAccount.hidden = !fernSessionAuthenticated;
  }
  fernEditor.querySelectorAll("[data-account-only]").forEach((element) => {
    element.hidden = !fernSessionAuthenticated;
  });
}

async function fern_refreshSession() {
  const sharedSessionAuthenticated = Boolean(
    document.body && document.body.dataset && document.body.dataset.fernAuthenticated === "true"
  );
  fernSessionAuthenticated = sharedSessionAuthenticated;
  try {
    const response = await fetch("/account/color-sets/", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const contentType = response.headers.get("content-type") || "";
    if (response.redirected || !response.ok || contentType.indexOf("application/json") === -1) {
      throw new Error("Session unavailable.");
    }
    fernSessionAuthenticated = true;
  } catch (_error) {
    fernSessionAuthenticated = sharedSessionAuthenticated;
  }
  fern_renderColorSetAccess();
}

function fern_getCookie(name) {
  const prefix = `${name}=`;
  const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : "";
}

async function fern_getAccountColorSetRequest() {
  const csrfResponse = await fetch("/account/color-sets/", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const contentType = csrfResponse.headers.get("content-type") || "";
  if (csrfResponse.redirected || contentType.indexOf("application/json") === -1) {
    throw new Error("Sign in to use saved colors.");
  }
  return {
    "X-CSRFToken": decodeURIComponent(fern_getCookie("csrftoken")),
  };
}

async function fern_refreshSavedColorSets() {
  try {
    const response = await fetch("/account/color-sets/", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const contentType = response.headers.get("content-type") || "";
    if (response.redirected || contentType.indexOf("application/json") === -1) {
      throw new Error("Sign in to use saved colors.");
    }
    const payload = await response.json();
    const select = fernEditor.querySelector("[data-saved-color-set]");
    const loadedId = fernPaletteDraftColors ? fernPaletteDraftLoadedColorSetId : fernLoadedColorSetId;
    if (select) {
      select.innerHTML = '<option value="">Choose a saved color set</option>';
      payload.color_sets.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.name;
        option.selected = item.id === loadedId;
        select.append(option);
      });
    }
  } catch (error) {
    fern_setEditorStatus(error.message || "Could not load saved colors.");
  }
}

async function fern_saveColorSet() {
  const colors = fern_paletteEditorColors();
  const loadedId = fernPaletteDraftColors ? fernPaletteDraftLoadedColorSetId : fernLoadedColorSetId;
  const loadedName = fernPaletteDraftColors ? fernPaletteDraftLoadedColorSetName : fernLoadedColorSetName;
  let name = loadedName;
  if (!loadedId) {
    name = window.prompt("Name this color set", fernCurrentFileName.replace(/\.svg$/i, "") || "Draw colors");
    if (!name || !name.trim()) {
      return;
    }
  }
  try {
    const csrfHeaders = await fern_getAccountColorSetRequest();
    const isUpdate = Boolean(loadedId);
    const url = isUpdate ? `/account/color-sets/${loadedId}/` : "/account/color-sets/";
    const saveResponse = await fetch(url, {
      method: isUpdate ? "PUT" : "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...csrfHeaders,
      },
      body: JSON.stringify({ name: name.trim(), colors, originating_tool_id: "draw" }),
    });
    const payload = await saveResponse.json();
    if (!saveResponse.ok) {
      throw new Error(payload.message || "Could not save the color set.");
    }
    if (fernPaletteDraftColors) {
      fernPaletteDraftLoadedColorSetId = payload.id;
      fernPaletteDraftLoadedColorSetName = payload.name;
    } else {
      fernLoadedColorSetId = payload.id;
      fernLoadedColorSetName = payload.name;
      fern_saveLoadedColorSet();
    }
    fern_renderPaletteEditor();
    await fern_refreshSavedColorSets();
    fern_setEditorStatus(`Saved ${payload.name} to your account library.`);
  } catch (error) {
    fern_setEditorStatus(error.message || "Could not save the color set.");
  }
}

async function fern_loadColorSet() {
  const select = fernEditor.querySelector("[data-saved-color-set]");
  const id = select ? select.value : "";
  if (!id) {
    fern_setEditorStatus("Choose a saved color set to load.");
    return;
  }
  try {
    const response = await fetch(`/account/color-sets/${id}/`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.colors) || payload.colors.length !== 12) {
      throw new Error(payload.message || "Could not load the color set.");
    }
    const loadedColors = payload.colors.map((color) => fern_normalizePaletteColor(color));
    if (fernPaletteDraftColors) {
      fernPaletteDraftColors = loadedColors;
      fernPaletteDraftLoadedColorSetId = payload.id;
      fernPaletteDraftLoadedColorSetName = payload.name;
    } else {
      fernPaletteColors = loadedColors;
      fernLoadedColorSetId = payload.id;
      fernLoadedColorSetName = payload.name;
      fern_saveLoadedColorSet();
      fern_saveLocalPalette();
    }
    fernActivePaletteSlot = 0;
    fern_renderPaletteEditor();
    fern_setEditorStatus(`Loaded ${payload.name}.`);
  } catch (error) {
    fern_setEditorStatus(error.message || "Could not load the color set.");
  }
}

async function fern_openColorEditor() {
  const dialog = fernEditor.querySelector("[data-color-dialog]");
  if (!dialog) {
    return;
  }
  fernToolbarEditRole = "";
  fernPaletteDraftColors = [...fernPaletteColors];
  fernPaletteDraftLoadedColorSetId = fernLoadedColorSetId;
  fernPaletteDraftLoadedColorSetName = fernLoadedColorSetName;
  await fern_refreshSession();
  fern_renderPaletteEditor();
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  if (fernSessionAuthenticated) {
    await fern_refreshSavedColorSets();
  }
}

function fern_commitColorEditor() {
  if (fernPaletteDraftColors) {
    fernPaletteColors = [...fernPaletteDraftColors];
    fernLoadedColorSetId = fernPaletteDraftLoadedColorSetId;
    fernLoadedColorSetName = fernPaletteDraftLoadedColorSetName;
    fern_saveLocalPalette();
    fern_saveLoadedColorSet();
  }
  fernPaletteDraftColors = null;
  fernPaletteDraftLoadedColorSetId = "";
  fernPaletteDraftLoadedColorSetName = "";
  fern_closeColorEditor();
}

function fern_cancelColorEditor() {
  fernPaletteDraftColors = null;
  fernPaletteDraftLoadedColorSetId = "";
  fernPaletteDraftLoadedColorSetName = "";
  fern_closeColorEditor();
}

function fern_openToolbarColorEditor(role, source = "toolbar") {
  const dialog = fernEditor.querySelector("[data-toolbar-color-dialog]");
  if (!dialog || !["fill", "stroke"].includes(role)) {
    return;
  }
  fernToolbarEditRole = role;
  fernToolbarEditSource = source;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  fern_renderToolbarColorEditor();
  window.requestAnimationFrame(() => {
    if (dialog.open || dialog.hasAttribute("open")) {
      fern_renderToolbarColorEditor();
    }
  });
}

function fern_closeColorEditor() {
  const dialog = fernEditor.querySelector("[data-color-dialog]");
  if (dialog && typeof dialog.close === "function") {
    dialog.close();
  } else if (dialog) {
    dialog.removeAttribute("open");
  }
  fernToolbarEditRole = "";
}
function fern_closeToolbarColorEditor() {
  const dialog = fernEditor.querySelector("[data-toolbar-color-dialog]");
  if (dialog && typeof dialog.close === "function") {
    dialog.close();
  } else if (dialog) {
    dialog.removeAttribute("open");
  }
  fernToolbarEditRole = "";
  fernToolbarEditSource = "toolbar";
}

function fern_setCanvasBackground(mode) {
  fernCanvasBgMode = mode;
  const canvas = fernEditor.querySelector("[data-svg-canvas]");
  if (!canvas) {
    return;
  }
  canvas.classList.remove("is-bg-dark", "is-bg-light", "is-bg-checkerboard");
  canvas.classList.add(`is-bg-${mode}`);
  fernEditor.querySelectorAll("[data-canvas-bg]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.canvasBg === mode);
  });
}

function fern_moveLayer(direction) {
  if (!fernSelectedElement || !fernActiveSvg) {
    return;
  }
  const parent = fernSelectedElement.parentElement;
  if (!parent) {
    return;
  }

  if (direction === "up" && fernSelectedElement.nextElementSibling) {
    const next = fernSelectedElement.nextElementSibling;
    if (!next.hasAttribute("data-editor-grid") && !next.hasAttribute("data-editor-handles")) {
      next.after(fernSelectedElement);
    }
  } else if (direction === "down" && fernSelectedElement.previousElementSibling) {
    fernSelectedElement.previousElementSibling.before(fernSelectedElement);
  } else if (direction === "top") {
    const handles = parent.querySelector("[data-editor-grid], [data-editor-handles]");
    if (handles) {
      handles.before(fernSelectedElement);
    } else {
      parent.append(fernSelectedElement);
    }
  } else if (direction === "bottom") {
    const first = parent.firstElementChild;
    if (first && first !== fernSelectedElement) {
      first.before(fernSelectedElement);
    }
  }
}

function fern_groupSelected() {
  if (!fernSelectedElement || !fernActiveSvg) {
    return;
  }
  const parent = fernSelectedElement.parentElement;
  const group = document.createElementNS(FERN_SVG_NS, "g");
  parent.insertBefore(group, fernSelectedElement);
  group.appendChild(fernSelectedElement);
  fern_selectElement(group);
}

function fern_ungroupSelected() {
  if (!fernSelectedElement || fern_getTagName(fernSelectedElement) !== "g") {
    return;
  }
  const parent = fernSelectedElement.parentElement;
  const children = [...fernSelectedElement.children];
  children.forEach((child) => parent.insertBefore(child, fernSelectedElement));
  fernSelectedElement.remove();
  if (children.length > 0) {
    fern_selectElement(children[0]);
  } else {
    fern_selectElement(null);
  }
}

function fern_renderInspector() {
  const inspector = fernEditor.querySelector("[data-inspector]");
  if (!inspector) {
    return;
  }

  if (!fernSelectedElement) {
    const viewBox = fern_getViewBox();
    inspector.innerHTML = `
      <div class="field-label">Document &amp; Canvas</div>
      <div class="inspector-grid">
        <label>
          <span>Width</span>
          <input class="select-pill" type="number" data-doc-attr="viewbox-w" value="${viewBox.width}">
        </label>
        <label>
          <span>Height</span>
          <input class="select-pill" type="number" data-doc-attr="viewbox-h" value="${viewBox.height}">
        </label>
        <label>
          <span>ViewBox X</span>
          <input class="select-pill" type="number" data-doc-attr="viewbox-x" value="${viewBox.x}">
        </label>
        <label>
          <span>ViewBox Y</span>
          <input class="select-pill" type="number" data-doc-attr="viewbox-y" value="${viewBox.y}">
        </label>
      </div>

    `;
    return;
  }

  const tag = fern_getTagName(fernSelectedElement);
  const fillVal = fernSelectedElement.getAttribute("fill") || "";
  const fillIsNone = fillVal === "none";
  const fillHex = fern_colorToHex(fillVal, "#ffffff");

  const strokeVal = fernSelectedElement.getAttribute("stroke") || "";
  const strokeIsNone = strokeVal === "none" || strokeVal === "";
  const strokeHex = fern_colorToHex(strokeVal, "#ffffff");

  const fillOpacityVal = fernSelectedElement.getAttribute("fill-opacity");
  const fillOpacityPercent = Math.round(Number.parseFloat(fillOpacityVal || "1") * 100);

  const strokeOpacityVal = fernSelectedElement.getAttribute("stroke-opacity");
  const strokeOpacityPercent = Math.round(Number.parseFloat(strokeOpacityVal || "1") * 100);

  const strokeWidth = fernSelectedElement.getAttribute("stroke-width") || "1";
  const opacity = fernSelectedElement.getAttribute("opacity") || "1";
  const linecap = fernSelectedElement.getAttribute("stroke-linecap") || "butt";
  const linejoin = fernSelectedElement.getAttribute("stroke-linejoin") || "miter";
  const dasharray = fernSelectedElement.getAttribute("stroke-dasharray") || "";

  let geomFields = "";
  if (tag === "rect") {
    geomFields = `
      <label><span>X</span><input class="select-pill" type="number" data-attr="x" value="${fernSelectedElement.getAttribute("x") || "0"}"></label>
      <label><span>Y</span><input class="select-pill" type="number" data-attr="y" value="${fernSelectedElement.getAttribute("y") || "0"}"></label>
      <label><span>Width</span><input class="select-pill" type="number" data-attr="width" value="${fernSelectedElement.getAttribute("width") || "0"}"></label>
      <label><span>Height</span><input class="select-pill" type="number" data-attr="height" value="${fernSelectedElement.getAttribute("height") || "0"}"></label>
      <label><span>Corner RX</span><input class="select-pill" type="number" data-attr="rx" value="${fernSelectedElement.getAttribute("rx") || "0"}"></label>
    `;
  } else if (tag === "circle") {
    geomFields = `
      <label><span>CX</span><input class="select-pill" type="number" data-attr="cx" value="${fernSelectedElement.getAttribute("cx") || "0"}"></label>
      <label><span>CY</span><input class="select-pill" type="number" data-attr="cy" value="${fernSelectedElement.getAttribute("cy") || "0"}"></label>
      <label><span>Radius R</span><input class="select-pill" type="number" data-attr="r" value="${fernSelectedElement.getAttribute("r") || "0"}"></label>
    `;
  } else if (tag === "ellipse") {
    geomFields = `
      <label><span>CX</span><input class="select-pill" type="number" data-attr="cx" value="${fernSelectedElement.getAttribute("cx") || "0"}"></label>
      <label><span>CY</span><input class="select-pill" type="number" data-attr="cy" value="${fernSelectedElement.getAttribute("cy") || "0"}"></label>
      <label><span>RX</span><input class="select-pill" type="number" data-attr="rx" value="${fernSelectedElement.getAttribute("rx") || "0"}"></label>
      <label><span>RY</span><input class="select-pill" type="number" data-attr="ry" value="${fernSelectedElement.getAttribute("ry") || "0"}"></label>
    `;
  } else if (tag === "line") {
    geomFields = `
      <label><span>X1</span><input class="select-pill" type="number" data-attr="x1" value="${fernSelectedElement.getAttribute("x1") || "0"}"></label>
      <label><span>Y1</span><input class="select-pill" type="number" data-attr="y1" value="${fernSelectedElement.getAttribute("y1") || "0"}"></label>
      <label><span>X2</span><input class="select-pill" type="number" data-attr="x2" value="${fernSelectedElement.getAttribute("x2") || "0"}"></label>
      <label><span>Y2</span><input class="select-pill" type="number" data-attr="y2" value="${fernSelectedElement.getAttribute("y2") || "0"}"></label>
    `;
  } else if (tag === "polygon" || tag === "polyline") {
    const rawPoints = fernSelectedElement.getAttribute("points") || "";
    const pointCount = Math.floor(rawPoints.trim().split(/\s+|,/).map(Number).filter(Number.isFinite).length / 2);
    geomFields = `
      <label><span>Sides / Vertices</span><input class="select-pill" type="number" min="3" max="32" data-polygon-sides value="${pointCount || 3}"></label>
      <label style="grid-column: 1 / -1;"><span>Points</span><input class="select-pill" type="text" data-attr="points" value="${rawPoints}"></label>
    `;
  }

  inspector.innerHTML = `
    <div class="svg-editor-selected">
      <span class="element-tag-badge">&lt;${tag}&gt;</span>
      <div class="chip-row">
        <button class="chip-btn" type="button" data-action="duplicate">Copy</button>
        <button class="chip-btn chip-btn-danger" type="button" data-action="delete">Delete</button>
      </div>
    </div>

    <div class="field-label" style="margin-top: 0.6rem;">Layer &amp; Grouping</div>
    <div class="chip-row">
      <button class="chip-btn" type="button" data-layer="top" title="Bring to Front">Front</button>
      <button class="chip-btn" type="button" data-layer="up" title="Bring Forward">Forward</button>
      <button class="chip-btn" type="button" data-layer="down" title="Send Backward">Backward</button>
      <button class="chip-btn" type="button" data-layer="bottom" title="Send to Back">Back</button>
      <button class="chip-btn" type="button" data-group-action="group" title="Group into &lt;g&gt;">Group</button>
      <button class="chip-btn" type="button" data-group-action="ungroup" title="Ungroup &lt;g&gt;">Ungroup</button>
    </div>

    <div class="field-label" style="margin-top: 0.8rem;">Fill &amp; Stroke</div>
    <div class="inspector-color-row">
      <div class="color-picker-group">
        <span class="subgroup-title">Fill</span>
        <div class="color-input-wrapper">
          <button class="color-input-swatch" type="button" data-action="edit-toolbar-color" data-color-role="fill" data-color-source="selection" style="background: ${fillHex}" aria-label="Edit Fill color" ${fillIsNone ? 'disabled' : ''}></button>
          <label class="none-check-label">
            <input type="checkbox" data-attr-none="fill" ${fillIsNone ? 'checked' : ''}>
            <span>None</span>
          </label>
        </div>
        <div class="opacity-slider-wrapper">
          <span class="slider-label">Alpha</span>
          <input type="range" min="0" max="100" step="1" data-attr-opacity="fill" value="${fillOpacityPercent}" ${fillIsNone ? 'disabled' : ''}>
          <span class="slider-value" data-opacity-readout="fill">${fillOpacityPercent}%</span>
        </div>
      </div>
      <div class="color-picker-group">
        <span class="subgroup-title">Stroke</span>
        <div class="color-input-wrapper">
          <button class="color-input-swatch" type="button" data-action="edit-toolbar-color" data-color-role="stroke" data-color-source="selection" style="background: ${strokeHex}" aria-label="Edit Stroke color" ${strokeIsNone ? 'disabled' : ''}></button>
          <label class="none-check-label">
            <input type="checkbox" data-attr-none="stroke" ${strokeIsNone ? 'checked' : ''}>
            <span>None</span>
          </label>
        </div>
        <div class="opacity-slider-wrapper">
          <span class="slider-label">Alpha</span>
          <input type="range" min="0" max="100" step="1" data-attr-opacity="stroke" value="${strokeOpacityPercent}" ${strokeIsNone ? 'disabled' : ''}>
          <span class="slider-value" data-opacity-readout="stroke">${strokeOpacityPercent}%</span>
        </div>
      </div>
    </div>

    <div class="inspector-grid" style="margin-top: 0.6rem;">
      <label>
        <span>Stroke Width</span>
        <input class="select-pill" type="number" step="0.5" min="0" data-attr="stroke-width" value="${strokeWidth}">
      </label>
      <label>
        <span>Opacity</span>
        <input class="select-pill" type="number" step="0.05" min="0" max="1" data-attr="opacity" value="${opacity}">
      </label>
      <label>
        <span>Line Cap</span>
        <select class="select-pill" data-attr="stroke-linecap">
          <option value="butt" ${linecap === 'butt' ? 'selected' : ''}>butt</option>
          <option value="round" ${linecap === 'round' ? 'selected' : ''}>round</option>
          <option value="square" ${linecap === 'square' ? 'selected' : ''}>square</option>
        </select>
      </label>
      <label>
        <span>Line Join</span>
        <select class="select-pill" data-attr="stroke-linejoin">
          <option value="miter" ${linejoin === 'miter' ? 'selected' : ''}>miter</option>
          <option value="round" ${linejoin === 'round' ? 'selected' : ''}>round</option>
          <option value="bevel" ${linejoin === 'bevel' ? 'selected' : ''}>bevel</option>
        </select>
      </label>
      <label style="grid-column: 1 / -1;">
        <span>Dash Pattern</span>
        <input class="select-pill" type="text" data-attr="stroke-dasharray" value="${dasharray}" placeholder="e.g. 4 4">
      </label>
    </div>

    ${geomFields ? `<div class="field-label" style="margin-top: 0.8rem;">Geometry</div><div class="inspector-grid">${geomFields}</div>` : ''}
  `;
}

function fern_generatePolygonPoints(sides, cx = 50, cy = 50, r = 28) {
  const points = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2;
    const x = fern_snap(cx + r * Math.cos(angle));
    const y = fern_snap(cy + r * Math.sin(angle));
    points.push(`${x},${y}`);
  }
  return points.join(" ");
}

function fern_getPolygonCenterRadius(element) {
  const rawPoints = element.getAttribute("points") || "";
  const numbers = rawPoints.trim().split(/\s+|,/).map(Number).filter(Number.isFinite);
  if (numbers.length < 4) {
    return { cx: 50, cy: 50, r: 28 };
  }
  let minX = numbers[0];
  let maxX = numbers[0];
  let minY = numbers[1];
  let maxY = numbers[1];
  for (let i = 0; i < numbers.length; i += 2) {
    minX = Math.min(minX, numbers[i]);
    maxX = Math.max(maxX, numbers[i]);
    minY = Math.min(minY, numbers[i + 1]);
    maxY = Math.max(maxY, numbers[i + 1]);
  }
  const cx = fern_snap((minX + maxX) / 2);
  const cy = fern_snap((minY + maxY) / 2);
  const r = fern_snap(Math.max((maxX - minX) / 2, (maxY - minY) / 2, 10));
  return { cx, cy, r };
}

function fern_updateSelectedAttr(event) {
  const sidesInput = event.target.closest("[data-polygon-sides]");
  if (sidesInput && fernSelectedElement) {
    const sides = Math.max(3, Math.min(32, Number.parseInt(sidesInput.value, 10) || 3));
    const { cx, cy, r } = fern_getPolygonCenterRadius(fernSelectedElement);
    fern_beginHistory();
    fernSelectedElement.setAttribute("points", fern_generatePolygonPoints(sides, cx, cy, r));
    fern_renderInspector();
    fern_renderPointHandles();
    fern_commitHistory();
    return;
  }

  const input = event.target.closest("[data-attr]");
  if (!input || !fernSelectedElement) {
    return;
  }

  fern_beginHistory();
  const value = input.value.trim();
  if (value) {
    fernSelectedElement.setAttribute(input.dataset.attr, value);
  } else {
    fernSelectedElement.removeAttribute(input.dataset.attr);
  }
  fern_renderPointHandles();
  fern_commitHistory();
}

function fern_updateDocumentAttr(event) {
  const input = event.target.closest("[data-doc-attr]");
  if (!input || !fernActiveSvg) {
    return;
  }

  const attr = input.dataset.docAttr;
  const val = Number.parseFloat(input.value);
  if (!Number.isFinite(val)) {
    return;
  }

  const viewBox = fern_getViewBox();
  let { x, y, width, height } = viewBox;

  if (attr === "viewbox-w") width = Math.max(1, val);
  else if (attr === "viewbox-h") height = Math.max(1, val);
  else if (attr === "viewbox-x") x = val;
  else if (attr === "viewbox-y") y = val;

  fern_beginHistory();
  fernActiveSvg.setAttribute("viewBox", `${fern_formatNumber(x)} ${fern_formatNumber(y)} ${fern_formatNumber(width)} ${fern_formatNumber(height)}`);
  fernDocumentViewBox = fern_readViewBox(fernActiveSvg);
  fern_renderGrid();
  fern_commitHistory();
}

function fern_updateColorAttr(event) {
  const colorInput = event.target.closest("[data-attr-color]");
  const noneInput = event.target.closest("[data-attr-none]");
  const opacityInput = event.target.closest("[data-attr-opacity]");

  if (opacityInput && fernSelectedElement) {
    const targetAttr = opacityInput.dataset.attrOpacity;
    const opacityAttr = `${targetAttr}-opacity`;
    const percent = Math.max(0, Math.min(100, Number.parseInt(opacityInput.value, 10) || 0));
    const floatVal = fern_formatNumber(percent / 100);

    fern_beginHistory();
    if (percent === 100) {
      fernSelectedElement.removeAttribute(opacityAttr);
    } else {
      fernSelectedElement.setAttribute(opacityAttr, floatVal);
    }
    const readout = fernEditor.querySelector(`[data-opacity-readout="${targetAttr}"]`);
    if (readout) {
      readout.textContent = `${percent}%`;
    }
    fern_commitHistory();
    return;
  }

  if (colorInput && fernSelectedElement) {
    const attr = colorInput.dataset.attrColor;
    fern_beginHistory();
    fernSelectedElement.setAttribute(attr, colorInput.value);
    const checkbox = fernEditor.querySelector(`[data-attr-none="${attr}"]`);
    if (checkbox) {
      checkbox.checked = false;
    }
    colorInput.disabled = false;
    fern_commitHistory();
  } else if (noneInput && fernSelectedElement) {
    const attr = noneInput.dataset.attrNone;
    fern_beginHistory();
    if (noneInput.checked) {
      fernSelectedElement.setAttribute(attr, "none");
    } else {
      const picker = fernEditor.querySelector(`[data-attr-color="${attr}"]`);
      fernSelectedElement.setAttribute(attr, picker ? picker.value : "#ffffff");
    }
    fern_renderInspector();
    fern_commitHistory();
  }
}

function fern_pathTokens(d) {
  return (d.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || []).map((token) => {
    const value = Number.parseFloat(token);
    return Number.isFinite(value) && !/^[a-zA-Z]$/.test(token)
      ? { type: "number", value }
      : { type: "command", value: token };
  });
}

function fern_serializePathTokens(tokens) {
  return tokens.map((token) => token.type === "number" ? fern_formatNumber(token.value) : token.value).join(" ");
}

function fern_absolutizePath(d) {
  const tokens = fern_pathTokens(d);
  const output = [];
  let index = 0;
  let command = "";
  let currentX = 0;
  let currentY = 0;
  let subpathX = 0;
  let subpathY = 0;

  function fern_hasNumber() {
    return index < tokens.length && tokens[index].type === "number";
  }

  function fern_readNumber() {
    if (!fern_hasNumber()) {
      return null;
    }
    const value = tokens[index].value;
    index += 1;
    return value;
  }

  function fern_readPoint(relative) {
    const x = fern_readNumber();
    const y = fern_readNumber();
    if (x === null || y === null) {
      return null;
    }

    return {
      x: relative ? currentX + x : x,
      y: relative ? currentY + y : y,
    };
  }

  while (index < tokens.length) {
    if (tokens[index].type === "command") {
      command = tokens[index].value;
      index += 1;
    }

    if (!command) {
      break;
    }

    const upper = command.toUpperCase();
    const relative = command === command.toLowerCase();

    if (upper === "M") {
      const point = fern_readPoint(relative);
      if (!point) {
        break;
      }
      output.push("M", point.x, point.y);
      currentX = point.x;
      currentY = point.y;
      subpathX = point.x;
      subpathY = point.y;
      command = relative ? "l" : "L";
    } else if (upper === "L" || upper === "T") {
      const point = fern_readPoint(relative);
      if (!point) {
        break;
      }
      output.push(upper, point.x, point.y);
      currentX = point.x;
      currentY = point.y;
    } else if (upper === "H") {
      const value = fern_readNumber();
      if (value === null) {
        break;
      }
      currentX = relative ? currentX + value : value;
      output.push("L", currentX, currentY);
    } else if (upper === "V") {
      const value = fern_readNumber();
      if (value === null) {
        break;
      }
      currentY = relative ? currentY + value : value;
      output.push("L", currentX, currentY);
    } else if (upper === "C") {
      const first = fern_readPoint(relative);
      const second = fern_readPoint(relative);
      const end = fern_readPoint(relative);
      if (!first || !second || !end) {
        break;
      }
      output.push("C", first.x, first.y, second.x, second.y, end.x, end.y);
      currentX = end.x;
      currentY = end.y;
    } else if (upper === "S" || upper === "Q") {
      const control = fern_readPoint(relative);
      const end = fern_readPoint(relative);
      if (!control || !end) {
        break;
      }
      output.push(upper, control.x, control.y, end.x, end.y);
      currentX = end.x;
      currentY = end.y;
    } else if (upper === "A") {
      const rx = fern_readNumber();
      const ry = fern_readNumber();
      const rotation = fern_readNumber();
      const largeArc = fern_readNumber();
      const sweep = fern_readNumber();
      const end = fern_readPoint(relative);
      if ([rx, ry, rotation, largeArc, sweep].some((value) => value === null) || !end) {
        break;
      }
      output.push("A", rx, ry, rotation, largeArc, sweep, end.x, end.y);
      currentX = end.x;
      currentY = end.y;
    } else if (upper === "Z") {
      output.push("Z");
      currentX = subpathX;
      currentY = subpathY;
      command = "";
    } else {
      break;
    }
  }

  return output.map((token) => typeof token === "number" ? fern_formatNumber(token) : token).join(" ");
}

function fern_getPathPointRefs(element) {
  const tokens = fern_pathTokens(element.getAttribute("d") || "");
  const modeOverrides = fern_getNodeModeOverrides(element);
  const refs = [];
  let command = "";
  let index = 0;
  let currentX = 0;
  let currentY = 0;
  let currentAnchor = null;
  let subpathAnchor = null;

  function fern_readNumber() {
    if (index >= tokens.length || tokens[index].type !== "number") {
      return null;
    }
    const ref = { tokenIndex: index, value: tokens[index].value };
    index += 1;
    return ref;
  }

  function fern_addPair(role) {
    const previousAnchor = currentAnchor;
    const xRef = fern_readNumber();
    const yRef = fern_readNumber();
    if (!xRef || !yRef) {
      return null;
    }

    const relative = command === command.toLowerCase();
    const x = relative ? currentX + xRef.value : xRef.value;
    const y = relative ? currentY + yRef.value : yRef.value;
    const ref = {
      type: "path-pair",
      role,
      x,
      y,
      xRef,
      yRef,
      relative,
      tokens,
      controls: [],
      segmentStart: Math.max(0, xRef.tokenIndex - 1),
      segmentEnd: yRef.tokenIndex + 1,
    };
    refs.push(ref);
    currentX = x;
    currentY = y;
    currentAnchor = ref;
    if (role !== "M" && previousAnchor) {
      previousAnchor.outgoingSegment = role;
      ref.incomingSegment = role;
    }
    if (role === "M") {
      subpathAnchor = ref;
    }
    return ref;
  }

  function fern_addCurvePoint(role, connectTo = null) {
    const xRef = fern_readNumber();
    const yRef = fern_readNumber();
    if (!xRef || !yRef) {
      return null;
    }

    const relative = command === command.toLowerCase();
    const x = relative ? currentX + xRef.value : xRef.value;
    const y = relative ? currentY + yRef.value : yRef.value;
    const ref = { type: "path-pair", role, x, y, xRef, yRef, relative, tokens, connectTo };
    refs.push(ref);
    if (connectTo && connectTo.controls) {
      connectTo.controls.push(ref);
    }
    return ref;
  }

  while (index < tokens.length) {
    if (tokens[index].type === "command") {
      command = tokens[index].value;
      index += 1;
    }

    const upper = command.toUpperCase();
    if (upper === "M" || upper === "L" || upper === "T") {
      if (!fern_addPair(upper)) {
        break;
      }
      if (upper === "M") {
        command = command === "m" ? "l" : "L";
      }
    } else if (upper === "C") {
      const start = currentAnchor || { x: currentX, y: currentY, controls: [] };
      const first = fern_addCurvePoint("control", start);
      const second = fern_addCurvePoint("control");
      const end = fern_addCurvePoint("end");
      if (!first || !second || !end) {
        break;
      }
      end.segmentStart = Math.max(0, first.xRef.tokenIndex - 1);
      end.segmentEnd = end.yRef.tokenIndex + 1;
      second.connectTo = end;
      end.controls = [second];
      start.outgoingSegment = "C";
      end.incomingSegment = "C";
      currentX = end.x;
      currentY = end.y;
      currentAnchor = end;
    } else if (upper === "S" || upper === "Q") {
      const control = addCurvePoint("control");
      const end = addCurvePoint("end");
      if (!control || !end) {
        break;
      }
      end.segmentStart = Math.max(0, control.xRef.tokenIndex - 1);
      end.segmentEnd = end.yRef.tokenIndex + 1;
      control.connectTo = end;
      end.controls = [control];
      if (currentAnchor) {
        currentAnchor.outgoingSegment = upper;
      }
      end.incomingSegment = upper;
      currentX = end.x;
      currentY = end.y;
      currentAnchor = end;
    } else if (upper === "H") {
      const xRef = readNumber();
      if (!xRef) {
        break;
      }
      const relative = command === command.toLowerCase();
      const x = relative ? currentX + xRef.value : xRef.value;
      const previousAnchor = currentAnchor;
      currentAnchor = { type: "path-h", role: "axis", x, y: currentY, xRef, relative, tokens, controls: [], segmentStart: Math.max(0, xRef.tokenIndex - 1), segmentEnd: xRef.tokenIndex + 1, incomingSegment: "H" };
      if (previousAnchor) {
        previousAnchor.outgoingSegment = "H";
      }
      refs.push(currentAnchor);
      currentX = x;
    } else if (upper === "V") {
      const yRef = readNumber();
      if (!yRef) {
        break;
      }
      const relative = command === command.toLowerCase();
      const y = relative ? currentY + yRef.value : yRef.value;
      const previousAnchor = currentAnchor;
      currentAnchor = { type: "path-v", role: "axis", x: currentX, y, yRef, relative, tokens, controls: [], segmentStart: Math.max(0, yRef.tokenIndex - 1), segmentEnd: yRef.tokenIndex + 1, incomingSegment: "V" };
      if (previousAnchor) {
        previousAnchor.outgoingSegment = "V";
      }
      refs.push(currentAnchor);
      currentY = y;
    } else if (upper === "Z") {
      if (subpathAnchor && currentAnchor) {
        currentAnchor.outgoingSegment = "Z";
        currentAnchor.closingTo = subpathAnchor;
        currentAnchor.closingTokenIndex = index - 1;
        subpathAnchor.incomingSegment = "Z";
      }
      if (
        subpathAnchor &&
        currentAnchor &&
        currentAnchor !== subpathAnchor &&
        currentAnchor.x === subpathAnchor.x &&
        currentAnchor.y === subpathAnchor.y
      ) {
        for (const control of currentAnchor.controls || []) {
          control.connectTo = subpathAnchor;
        }
        subpathAnchor.controls.push(...(currentAnchor.controls || []));
        subpathAnchor.incomingSegment = currentAnchor.incomingSegment;
        subpathAnchor.linkedAnchors = [...(subpathAnchor.linkedAnchors || []), currentAnchor];
        currentAnchor.hiddenAnchor = true;
        currentAnchor = subpathAnchor;
      }
      command = "";
    } else {
      break;
    }
  }

  for (const ref of refs) {
    if (ref.role === "control") {
      continue;
    }
    const hasStraightConnection = [ref.incomingSegment, ref.outgoingSegment].some((segment) => (
      segment === "L" || segment === "H" || segment === "V" || segment === "T" || segment === "Z"
    ));
    ref.pointMode = modeOverrides[fern_nodeModeKey(ref)] || (
      fern_hasSmoothControlGeometry(ref) || (ref.controls && ref.controls.length === 1 && !hasStraightConnection)
        ? "smooth"
        : "corner"
    );
    if (ref.pointMode === "smooth" && ref.controls && ref.controls.length >= 2) {
      const [hidden, visible] = ref.controls;
      hidden.hiddenControl = true;
      visible.mirrorControl = hidden;
    }
  }

  return refs;
}

function fern_getPointRefs(element) {
  const tag = fern_getTagName(element);
  if (tag === "line") {
    return [
      { type: "attr-pair", xAttr: "x1", yAttr: "y1", x: fern_numericAttr(element, "x1"), y: fern_numericAttr(element, "y1") },
      { type: "attr-pair", xAttr: "x2", yAttr: "y2", x: fern_numericAttr(element, "x2"), y: fern_numericAttr(element, "y2") },
    ];
  }
  if (tag === "circle") {
    const cx = fern_numericAttr(element, "cx", 50);
    const cy = fern_numericAttr(element, "cy", 50);
    const r = fern_numericAttr(element, "r", 10);
    return [
      { type: "attr-pair", xAttr: "cx", yAttr: "cy", x: cx, y: cy },
      { type: "circle-radius", x: cx + r, y: cy, cx, cy },
    ];
  }
  if (tag === "ellipse") {
    const cx = fern_numericAttr(element, "cx", 50);
    const cy = fern_numericAttr(element, "cy", 50);
    const rx = fern_numericAttr(element, "rx", 10);
    const ry = fern_numericAttr(element, "ry", 8);
    return [
      { type: "attr-pair", xAttr: "cx", yAttr: "cy", x: cx, y: cy },
      { type: "ellipse-rx", x: cx + rx, y: cy, cx },
      { type: "ellipse-ry", x: cx, y: cy + ry, cy },
    ];
  }
  if (tag === "rect") {
    const x = fern_numericAttr(element, "x");
    const y = fern_numericAttr(element, "y");
    const width = fern_numericAttr(element, "width");
    const height = fern_numericAttr(element, "height");
    return [
      { type: "rect-corner", corner: "tl", x, y, base: { x, y, width, height } },
      { type: "rect-corner", corner: "tr", x: x + width, y, base: { x, y, width, height } },
      { type: "rect-corner", corner: "br", x: x + width, y: y + height, base: { x, y, width, height } },
      { type: "rect-corner", corner: "bl", x, y: y + height, base: { x, y, width, height } },
    ];
  }
  if (tag === "polygon" || tag === "polyline") {
    const rawPoints = element.getAttribute("points") || "";
    const numbers = rawPoints.trim().split(/\s+|,/).map(Number).filter(Number.isFinite);
    const refs = [];
    for (let i = 0; i < numbers.length; i += 2) {
      if (i + 1 < numbers.length) {
        refs.push({
          type: "points-pair",
          pointIndex: i / 2,
          x: numbers[i],
          y: numbers[i + 1],
          numbers,
        });
      }
    }
    return refs;
  }
  if (tag === "g") {
    try {
      const box = element.getBBox();
      if (box && Number.isFinite(box.x) && Number.isFinite(box.y)) {
        const x = fern_snap(box.x);
        const y = fern_snap(box.y);
        const width = fern_snap(box.width);
        const height = fern_snap(box.height);
        return [
          { type: "group-bounds", corner: "tl", x, y },
          { type: "group-bounds", corner: "tr", x: x + width, y },
          { type: "group-bounds", corner: "br", x: x + width, y: y + height },
          { type: "group-bounds", corner: "bl", x, y: y + height },
        ];
      }
    } catch (_e) {
      return [];
    }
  }
  if (tag === "path") {
    return fern_getPathPointRefs(element);
  }
  return [];
}

function fern_selectedSegmentPath(refs) {
  const segment = fern_selectedSegment(refs);
  if (!segment) {
    return null;
  }

  return `M ${fern_formatNumber(segment.start.x)} ${fern_formatNumber(segment.start.y)} ${fern_serializePathTokens(segment.end.tokens.slice(segment.end.segmentStart, segment.end.segmentEnd))}`;
}

function fern_selectedSegment(refs = fern_getPointRefs(fernSelectedElement)) {
  const anchors = refs.filter(fern_refHasPosition);
  const selectedOrdinals = anchors
    .map((anchor, ordinal) => ({ ordinal, refIndex: refs.indexOf(anchor) }))
    .filter(({ refIndex }) => fernSelectedNodeIndices.has(refIndex))
    .map(({ ordinal }) => ordinal)
    .sort((a, b) => a - b);
  if (selectedOrdinals.length !== 2 || selectedOrdinals[1] !== selectedOrdinals[0] + 1) {
    return null;
  }

  const start = anchors[selectedOrdinals[0]];
  const end = anchors[selectedOrdinals[1]];
  if (!Number.isInteger(end.segmentStart) || !Number.isInteger(end.segmentEnd)) {
    return null;
  }

  return {
    start,
    end,
    firstOrdinal: selectedOrdinals[0],
    tokens: end.tokens.slice(end.segmentStart, end.segmentEnd),
  };
}

function fern_renderPointHandles() {
  fern_clearHandles();
  if (!fernSelectedElement || !fernActiveSvg) {
    return;
  }

  const refs = fern_getPointRefs(fernSelectedElement);
  if (refs.length === 0) {
    return;
  }

  const group = document.createElementNS(FERN_SVG_NS, "g");
  group.setAttribute("data-editor-handles", "");
  const handleScale = 1 / fernZoomLevel;
  const segmentPath = fern_selectedSegmentPath(refs);
  if (segmentPath) {
    const segment = document.createElementNS(FERN_SVG_NS, "path");
    segment.setAttribute("d", segmentPath);
    segment.setAttribute("class", "svg-selected-segment");
    group.append(segment);
  }
  for (const ref of refs) {
    if (!ref.connectTo || ref.hiddenControl) {
      continue;
    }

    const guide = document.createElementNS(FERN_SVG_NS, "line");
    guide.setAttribute("x1", fern_formatNumber(ref.x));
    guide.setAttribute("y1", fern_formatNumber(ref.y));
    guide.setAttribute("x2", fern_formatNumber(ref.connectTo.x));
    guide.setAttribute("y2", fern_formatNumber(ref.connectTo.y));
    guide.setAttribute("class", "svg-control-line");
    group.append(guide);
  }
  for (const [index, ref] of refs.entries()) {
    if (ref.hiddenControl || ref.hiddenAnchor) {
      continue;
    }

    const isControl = ref.role === "control";
    const handle = document.createElementNS(FERN_SVG_NS, isControl ? "circle" : ref.pointMode === "corner" ? "polygon" : "rect");
    if (isControl) {
      handle.setAttribute("cx", fern_formatNumber(ref.x));
      handle.setAttribute("cy", fern_formatNumber(ref.y));
      handle.setAttribute("r", fern_formatNumber(1.1 * handleScale));
    } else if (ref.pointMode === "corner") {
      const radius = 2.1 * handleScale;
      handle.setAttribute("points", `${fern_formatNumber(ref.x)},${fern_formatNumber(ref.y - radius)} ${fern_formatNumber(ref.x + radius)},${fern_formatNumber(ref.y)} ${fern_formatNumber(ref.x)},${fern_formatNumber(ref.y + radius)} ${fern_formatNumber(ref.x - radius)},${fern_formatNumber(ref.y)}`);
    } else {
      const size = 3.6 * handleScale;
      handle.setAttribute("x", fern_formatNumber(ref.x - size / 2));
      handle.setAttribute("y", fern_formatNumber(ref.y - size / 2));
      handle.setAttribute("width", fern_formatNumber(size));
      handle.setAttribute("height", fern_formatNumber(size));
    }
    const selectedClass = index === fernSelectedPointIndex || fernSelectedNodeIndices.has(index) ? " is-active-point" : "";
    handle.setAttribute("class", `${isControl ? "svg-point-handle svg-point-control" : "svg-point-handle svg-point-anchor"}${selectedClass}`);
    handle.setAttribute("data-point-index", String(index));
    group.append(handle);
  }
  fernActiveSvg.append(group);
}

function fern_setPathPair(ref, x, y) {
  ref.tokens[ref.xRef.tokenIndex].value = ref.relative ? x - fernPointDragState.startCurrentX : x;
  ref.tokens[ref.yRef.tokenIndex].value = ref.relative ? y - fernPointDragState.startCurrentY : y;
}

function fern_setAbsolutePathPair(ref, x, y) {
  ref.tokens[ref.xRef.tokenIndex].value = ref.relative ? x - ref.baseX : x;
  ref.tokens[ref.yRef.tokenIndex].value = ref.relative ? y - ref.baseY : y;
}

function fern_refHasPosition(ref) {
  return ref && !ref.hiddenAnchor && ref.role !== "control" && (ref.type === "path-pair" || ref.type === "path-h" || ref.type === "path-v");
}

function fern_setAbsoluteNodePosition(ref, x, y) {
  if (ref.type === "path-pair") {
    fern_setAbsolutePathPair(ref, x, y);
    for (const linkedAnchor of ref.linkedAnchors || []) {
      fern_setAbsolutePathPair(linkedAnchor, x, y);
    }
  } else if (ref.type === "path-h") {
    ref.tokens[ref.xRef.tokenIndex].value = ref.relative ? x - ref.baseX : x;
  } else if (ref.type === "path-v") {
    ref.tokens[ref.yRef.tokenIndex].value = ref.relative ? y - ref.baseY : y;
  }
}

function fern_selectedAnchorRefs() {
  if (!fernSelectedElement || fern_getTagName(fernSelectedElement) !== "path") {
    return [];
  }

  const refs = fern_getPointRefs(fernSelectedElement);
  return [...fernSelectedNodeIndices].map((index) => refs[index]).filter(fern_refHasPosition);
}

function fern_pathCommand(command, ...values) {
  return [
    { type: "command", value: command },
    ...values.map((value) => ({ type: "number", value })),
  ];
}

function fern_selectAnchorOrdinals(ordinals) {
  const refs = fern_getPointRefs(fernSelectedElement);
  const anchors = refs.filter(fern_refHasPosition);
  fernSelectedNodeIndices = new Set(ordinals.map((ordinal) => refs.indexOf(anchors[ordinal])).filter((index) => index >= 0));
}

function fern_setSelectedSegmentMode(mode) {
  if (!fernSelectedElement || fern_getTagName(fernSelectedElement) !== "path") {
    return;
  }

  const refs = fern_getPointRefs(fernSelectedElement);
  const anchors = refs.filter(fern_refHasPosition);
  const selectedOrdinals = anchors
    .map((anchor, ordinal) => ({ anchor, ordinal, refIndex: refs.indexOf(anchor) }))
    .filter(({ refIndex }) => fernSelectedNodeIndices.has(refIndex))
    .map(({ ordinal }) => ordinal);

  if (selectedOrdinals.length !== 2) {
    fern_setEditorStatus("Select exactly two adjacent nodes.");
    return;
  }

  const [firstOrdinal, secondOrdinal] = selectedOrdinals.sort((a, b) => a - b);
  const isClosingPair = firstOrdinal === 0 && secondOrdinal === anchors.length - 1;
  if (secondOrdinal !== firstOrdinal + 1 && !isClosingPair) {
    fern_setEditorStatus("The selected nodes need one segment directly between them.");
    return;
  }

  const start = isClosingPair ? anchors[secondOrdinal] : anchors[firstOrdinal];
  const end = isClosingPair ? anchors[firstOrdinal] : anchors[secondOrdinal];
  let segmentStart = end.segmentStart;
  let segmentEnd = end.segmentEnd;

  if (isClosingPair) {
    // A closed curve can end at the starting node before its Z command. The
    // coincident endpoint is hidden, so use its token range for this edge.
    const linkedEndpoint = (end.linkedAnchors || []).find((ref) => (
      ref.role === "end" && Number.isInteger(ref.segmentStart) && Number.isInteger(ref.segmentEnd)
    ));
    if (linkedEndpoint) {
      segmentStart = linkedEndpoint.segmentStart;
      segmentEnd = linkedEndpoint.segmentEnd;
    } else if (start.closingTo === end && Number.isInteger(start.closingTokenIndex)) {
      segmentStart = start.closingTokenIndex;
      segmentEnd = start.closingTokenIndex + 1;
    }
  }

  if (!Number.isInteger(segmentStart) || !Number.isInteger(segmentEnd)) {
    fern_setEditorStatus("That segment cannot be changed here.");
    return;
  }

  const replacement = mode === "straight"
    ? fern_pathCommand("L", end.x, end.y)
    : fern_pathCommand(
      "C",
      start.x + (end.x - start.x) / 3,
      start.y + (end.y - start.y) / 3,
      start.x + ((end.x - start.x) * 2) / 3,
      start.y + ((end.y - start.y) * 2) / 3,
      end.x,
      end.y,
    );

  const tokens = fern_pathTokens(fernSelectedElement.getAttribute("d") || "");
  tokens.splice(segmentStart, segmentEnd - segmentStart, ...replacement);
  fernSelectedElement.setAttribute("d", fern_serializePathTokens(tokens));
  fernSelectedElement.removeAttribute("data-node-modes");
  fernSelectedPointIndex = null;
  fern_selectAnchorOrdinals([firstOrdinal, secondOrdinal]);
  fern_setEditorStatus(mode === "straight" ? "Segment made straight." : "Segment made curved. Drag its orange handles.");
  fern_renderPointHandles();
}

function fern_interpolate(first, second, t = 0.5) {
  return {
    x: first.x + (second.x - first.x) * t,
    y: first.y + (second.y - first.y) * t,
  };
}

function fern_pointOnSegment(segment, t) {
  const command = segment.tokens[0] && segment.tokens[0].type === "command" ? segment.tokens[0].value.toUpperCase() : "";
  const { start, end } = segment;
  if (command === "L" || command === "H" || command === "V" || command === "Z") {
    return fern_interpolate(start, end, t);
  }
  if (command === "C" && segment.tokens.length === 7) {
    const firstControl = { x: segment.tokens[1].value, y: segment.tokens[2].value };
    const secondControl = { x: segment.tokens[3].value, y: segment.tokens[4].value };
    const first = fern_interpolate(start, firstControl, t);
    const second = fern_interpolate(firstControl, secondControl, t);
    const third = fern_interpolate(secondControl, end, t);
    return fern_interpolate(fern_interpolate(first, second, t), fern_interpolate(second, third, t), t);
  }
  if (command === "Q" && segment.tokens.length === 5) {
    const control = { x: segment.tokens[1].value, y: segment.tokens[2].value };
    return fern_interpolate(fern_interpolate(start, control, t), fern_interpolate(control, end, t), t);
  }
  return null;
}

function fern_closestPathSegment(element, point) {
  const refs = fern_getPointRefs(element);
  const anchors = refs.filter((ref) => (
    ref && ref.role !== "control" && (ref.type === "path-pair" || ref.type === "path-h" || ref.type === "path-v")
  ));
  let closest = null;

  for (let index = 1; index < anchors.length; index += 1) {
    const end = anchors[index];
    if (!Number.isInteger(end.segmentStart) || !Number.isInteger(end.segmentEnd)) {
      continue;
    }
    const segment = {
      start: anchors[index - 1],
      end,
      firstOrdinal: index - 1,
      tokens: end.tokens.slice(end.segmentStart, end.segmentEnd),
    };
    for (let step = 0; step <= 64; step += 1) {
      const t = step / 64;
      const sample = fern_pointOnSegment(segment, t);
      if (!sample) {
        continue;
      }
      const distance = (sample.x - point.x) ** 2 + (sample.y - point.y) ** 2;
      if (!closest || distance < closest.distance) {
        closest = { ...segment, t, distance };
      }
    }
  }

  const closingStart = anchors[anchors.length - 1];
  if (closingStart && closingStart.closingTo) {
    const segment = {
      start: closingStart,
      end: closingStart.closingTo,
      firstOrdinal: anchors.length - 1,
      tokens: [{ type: "command", value: "Z" }],
      closing: true,
      closingTokenIndex: closingStart.closingTokenIndex,
    };
    for (let step = 0; step <= 64; step += 1) {
      const t = step / 64;
      const sample = fern_pointOnSegment(segment, t);
      const distance = (sample.x - point.x) ** 2 + (sample.y - point.y) ** 2;
      if (!closest || distance < closest.distance) {
        closest = { ...segment, t, distance };
      }
    }
  }

  return closest;
}

function fern_addNodeToSegment(segment, t = 0.5) {
  const { start, end, firstOrdinal } = segment;
  const tokens = fern_pathTokens(fernSelectedElement.getAttribute("d") || "");
  const segmentTokens = segment.tokens;
  const command = segmentTokens[0] && segmentTokens[0].type === "command" ? segmentTokens[0].value.toUpperCase() : "";
  let replacement = [];

  if (segment.closing) {
    const middle = fern_interpolate(start, end, t);
    tokens.splice(segment.closingTokenIndex, 0, ...fern_pathCommand("L", middle.x, middle.y));
    fernSelectedElement.setAttribute("d", fern_serializePathTokens(tokens));
    fernSelectedElement.removeAttribute("data-node-modes");
    fernSelectedPointIndex = null;
    fern_selectAnchorOrdinals([firstOrdinal + 1]);
    fern_setEditorStatus("Node added.");
    fern_renderPointHandles();
    return true;
  }

  if (command === "L" || command === "H" || command === "V") {
    const middle = fern_interpolate(start, end, t);
    replacement = [
      ...fern_pathCommand("L", middle.x, middle.y),
      ...fern_pathCommand("L", end.x, end.y),
    ];
  } else if (command === "C" && segmentTokens.length === 7) {
    const firstControl = { x: segmentTokens[1].value, y: segmentTokens[2].value };
    const secondControl = { x: segmentTokens[3].value, y: segmentTokens[4].value };
    const firstHalfControl = fern_interpolate(start, firstControl, t);
    const secondHalfControl = fern_interpolate(firstControl, secondControl, t);
    const thirdHalfControl = fern_interpolate(secondControl, end, t);
    const firstJoinControl = fern_interpolate(firstHalfControl, secondHalfControl, t);
    const secondJoinControl = fern_interpolate(secondHalfControl, thirdHalfControl, t);
    const middle = fern_interpolate(firstJoinControl, secondJoinControl, t);
    replacement = [
      ...fern_pathCommand("C", firstHalfControl.x, firstHalfControl.y, firstJoinControl.x, firstJoinControl.y, middle.x, middle.y),
      ...fern_pathCommand("C", secondJoinControl.x, secondJoinControl.y, thirdHalfControl.x, thirdHalfControl.y, end.x, end.y),
    ];
  } else if (command === "Q" && segmentTokens.length === 5) {
    const control = { x: segmentTokens[1].value, y: segmentTokens[2].value };
    const firstHalfControl = fern_interpolate(start, control, t);
    const secondHalfControl = fern_interpolate(control, end, t);
    const middle = fern_interpolate(firstHalfControl, secondHalfControl, t);
    replacement = [
      ...fern_pathCommand("Q", firstHalfControl.x, firstHalfControl.y, middle.x, middle.y),
      ...fern_pathCommand("Q", secondHalfControl.x, secondHalfControl.y, end.x, end.y),
    ];
  } else {
    fern_setEditorStatus("Add node supports line, cubic, and quadratic segments.");
    return;
  }

  tokens.splice(end.segmentStart, end.segmentEnd - end.segmentStart, ...replacement);
  fernSelectedElement.setAttribute("d", fern_serializePathTokens(tokens));
  fernSelectedElement.removeAttribute("data-node-modes");
  fernSelectedPointIndex = null;
  fern_selectAnchorOrdinals([firstOrdinal + 1]);
  fern_setEditorStatus("Node added.");
  fern_renderPointHandles();
  return true;
}

function fern_activateAddNodeMode() {
  fernAddNodeMode = true;
  fernActiveSvg.classList.add("is-adding-node");
  fern_setEditorStatus("Click the curve or line to split.");
}

function fern_lineToPath(line) {
  const path = document.createElementNS(FERN_SVG_NS, "path");
  for (const attribute of line.attributes) {
    if (attribute.name !== "x1" && attribute.name !== "y1" && attribute.name !== "x2" && attribute.name !== "y2") {
      path.setAttribute(attribute.name, attribute.value);
    }
  }
  path.setAttribute("d", `M ${fern_formatNumber(fern_numericAttr(line, "x1"))} ${fern_formatNumber(fern_numericAttr(line, "y1"))} L ${fern_formatNumber(fern_numericAttr(line, "x2"))} ${fern_formatNumber(fern_numericAttr(line, "y2"))}`);
  line.replaceWith(path);
  return path;
}

function fern_mergeSelectedNodes() {
  const refs = fern_selectedAnchorRefs();
  if (refs.length < 2 || !fernSelectedElement) {
    return;
  }

  const x = fern_snap(refs.reduce((sum, ref) => sum + ref.x, 0) / refs.length);
  const y = fern_snap(refs.reduce((sum, ref) => sum + ref.y, 0) / refs.length);
  for (const ref of refs) {
    fern_setAbsoluteNodePosition(ref, x, y);
  }

  fernSelectedElement.setAttribute("d", fern_serializePathTokens(refs[0].tokens));
  fern_setCoordinateReadout(x, y);
  fern_renderPointHandles();
}

function fern_deleteSelectedNodes() {
  if (!fernSelectedElement || fern_getTagName(fernSelectedElement) !== "path") {
    return;
  }

  const refs = fern_selectedAnchorRefs().filter((ref) => ref.role !== "M" && Number.isInteger(ref.segmentStart) && Number.isInteger(ref.segmentEnd));
  if (refs.length === 0) {
    return;
  }

  const tokens = fern_pathTokens(fernSelectedElement.getAttribute("d") || "");
  const removals = refs.map((ref) => ({ start: ref.segmentStart, end: ref.segmentEnd })).sort((a, b) => b.start - a.start);
  for (const removal of removals) {
    tokens.splice(removal.start, removal.end - removal.start);
  }

  fernSelectedElement.setAttribute("d", fern_serializePathTokens(tokens));
  fernSelectedNodeIndices = new Set();
  fernSelectedPointIndex = null;
  fern_renderPointHandles();
}

function fern_convertAdjacentSegmentsToCurves(element, anchor) {
  const refs = fern_getPointRefs(element);
  const anchors = refs.filter(fern_refHasPosition);
  const index = anchors.indexOf(anchor);
  if (index < 0) {
    return;
  }

  const adjacentIndices = [];
  if (index > 0) adjacentIndices.push(index - 1);
  else if (anchor.closingTo) adjacentIndices.push(anchors.length - 1);
  if (index < anchors.length - 1) adjacentIndices.push(index + 1);
  else if (anchors[0] && anchors[0].incomingSegment === "Z") adjacentIndices.push(0);

  const tokens = fern_pathTokens(element.getAttribute("d") || "");
  let modified = false;

  for (const adjIndex of adjacentIndices) {
    const start = index < adjIndex ? anchor : anchors[adjIndex];
    const end = index < adjIndex ? anchors[adjIndex] : anchor;
    if (end && Number.isInteger(end.segmentStart) && Number.isInteger(end.segmentEnd)) {
      const segTokens = end.tokens.slice(end.segmentStart, end.segmentEnd);
      const cmd = segTokens[0] && segTokens[0].type === "command" ? segTokens[0].value.toUpperCase() : "";
      if (cmd === "L" || cmd === "Z" || cmd === "H" || cmd === "V") {
        const replacement = fern_pathCommand(
          "C",
          fern_snap(start.x + (end.x - start.x) / 3),
          fern_snap(start.y + (end.y - start.y) / 3),
          fern_snap(start.x + ((end.x - start.x) * 2) / 3),
          fern_snap(start.y + ((end.y - start.y) * 2) / 3),
          end.x,
          end.y
        );
        tokens.splice(end.segmentStart, end.segmentEnd - end.segmentStart, ...replacement);
        modified = true;
      }
    }
  }

  if (modified) {
    element.setAttribute("d", fern_serializePathTokens(tokens));
  }
}

function fern_setNodeMode(mode) {
  const selectedRefs = fern_selectedAnchorRefs();
  if (!fernSelectedElement || selectedRefs.length === 0) {
    fern_setEditorStatus("Select a node first.");
    return;
  }

  for (const anchor of selectedRefs) {
    if (mode === "smooth") {
      fern_convertAdjacentSegmentsToCurves(fernSelectedElement, anchor);
    }
    fern_setNodeModeOverride(fernSelectedElement, anchor, mode);
    const updatedRefs = fern_getPointRefs(fernSelectedElement);
    const updatedAnchor = updatedRefs.find((r) => r.x === anchor.x && r.y === anchor.y) || anchor;
    const [first, second] = updatedAnchor.controls || [];
    if (mode === "smooth" && first && second) {
      const length = Math.hypot(first.x - updatedAnchor.x, first.y - updatedAnchor.y) || Math.hypot(second.x - updatedAnchor.x, second.y - updatedAnchor.y) || 8;
      const angle = Math.atan2(second.y - updatedAnchor.y, second.x - updatedAnchor.x) + Math.PI;
      fern_setAbsolutePathPair(first, fern_snap(updatedAnchor.x + Math.cos(angle) * length), fern_snap(updatedAnchor.y + Math.sin(angle) * length));
      fernSelectedElement.setAttribute("d", fern_serializePathTokens(first.tokens));
    }
  }

  fern_setEditorStatus(mode === "corner" ? "Node made corner." : "Node made smooth.");
  fern_renderPointHandles();
}

function fern_moveAttachedControls(x, y) {
  if (!fernPointDragState || fernPointDragState.anchorControls.length === 0) {
    return;
  }

  const dx = x - fernPointDragState.startX;
  const dy = y - fernPointDragState.startY;
  for (const { control, x: controlX, y: controlY } of fernPointDragState.anchorControls) {
    fern_setAbsolutePathPair(control, fern_snap(controlX + dx), fern_snap(controlY + dy));
  }
}

function fern_applyPointRef(element, ref, x, y) {
  if (ref.type === "attr-pair") {
    fern_setNumericAttr(element, ref.xAttr, x);
    fern_setNumericAttr(element, ref.yAttr, y);
  } else if (ref.type === "circle-radius") {
    const radius = Math.hypot(x - ref.cx, y - ref.cy);
    fern_setNumericAttr(element, "r", radius);
  } else if (ref.type === "ellipse-rx") {
    fern_setNumericAttr(element, "rx", Math.abs(x - ref.cx));
  } else if (ref.type === "ellipse-ry") {
    fern_setNumericAttr(element, "ry", Math.abs(y - ref.cy));
  } else if (ref.type === "rect-corner") {
    const base = ref.base;
    if (ref.corner === "tl") {
      fern_setNumericAttr(element, "x", Math.min(x, base.x + base.width));
      fern_setNumericAttr(element, "y", Math.min(y, base.y + base.height));
      fern_setNumericAttr(element, "width", Math.abs(base.x + base.width - x));
      fern_setNumericAttr(element, "height", Math.abs(base.y + base.height - y));
    } else if (ref.corner === "tr") {
      fern_setNumericAttr(element, "x", Math.min(base.x, x));
      fern_setNumericAttr(element, "y", Math.min(y, base.y + base.height));
      fern_setNumericAttr(element, "width", Math.abs(x - base.x));
      fern_setNumericAttr(element, "height", Math.abs(base.y + base.height - y));
    } else if (ref.corner === "br") {
      fern_setNumericAttr(element, "x", Math.min(base.x, x));
      fern_setNumericAttr(element, "y", Math.min(base.y, y));
      fern_setNumericAttr(element, "width", Math.abs(x - base.x));
      fern_setNumericAttr(element, "height", Math.abs(y - base.y));
    } else {
      fern_setNumericAttr(element, "x", Math.min(x, base.x + base.width));
      fern_setNumericAttr(element, "y", Math.min(base.y, y));
      fern_setNumericAttr(element, "width", Math.abs(base.x + base.width - x));
      fern_setNumericAttr(element, "height", Math.abs(y - base.y));
    }
  } else if (ref.type === "path-pair") {
    fern_setPathPair(ref, x, y);
    for (const linkedAnchor of ref.linkedAnchors || []) {
      fern_setAbsolutePathPair(linkedAnchor, x, y);
    }
    if (fern_refHasPosition(ref)) {
      fern_moveAttachedControls(x, y);
    }
    element.setAttribute("d", fern_serializePathTokens(ref.tokens));
  } else if (ref.type === "path-h") {
    ref.tokens[ref.xRef.tokenIndex].value = ref.relative ? x - fernPointDragState.startCurrentX : x;
    fern_moveAttachedControls(x, y);
    element.setAttribute("d", fern_serializePathTokens(ref.tokens));
  } else if (ref.type === "path-v") {
    ref.tokens[ref.yRef.tokenIndex].value = ref.relative ? y - fernPointDragState.startCurrentY : y;
    fern_moveAttachedControls(x, y);
    element.setAttribute("d", fern_serializePathTokens(ref.tokens));
  } else if (ref.type === "points-pair") {
    const rawPoints = element.getAttribute("points") || "";
    const numbers = rawPoints.trim().split(/\s+|,/).map(Number).filter(Number.isFinite);
    const index = ref.pointIndex * 2;
    if (index + 1 < numbers.length) {
      numbers[index] = x;
      numbers[index + 1] = y;
      const formatted = [];
      for (let i = 0; i < numbers.length; i += 2) {
        formatted.push(`${fern_formatNumber(numbers[i])},${fern_formatNumber(numbers[i + 1])}`);
      }
      element.setAttribute("points", formatted.join(" "));
    }
  }
}

function fern_translatePathData(d, dx, dy) {
  const tokens = fern_pathTokens(d);
  let index = 0;
  let command = "";

  function fern_shiftPair() {
    if (tokens[index] && tokens[index].type === "number") {
      tokens[index].value += dx;
    }
    index += 1;
    if (tokens[index] && tokens[index].type === "number") {
      tokens[index].value += dy;
    }
    index += 1;
  }

  while (index < tokens.length) {
    if (tokens[index].type === "command") {
      command = tokens[index].value.toUpperCase();
      index += 1;
    }

    if (command === "M" || command === "L" || command === "T") {
      fern_shiftPair();
    } else if (command === "C") {
      fern_shiftPair();
      fern_shiftPair();
      fern_shiftPair();
    } else if (command === "S" || command === "Q") {
      fern_shiftPair();
      fern_shiftPair();
    } else if (command === "A") {
      index += 5;
      shiftPair();
    } else if (command === "H") {
      if (tokens[index] && tokens[index].type === "number") {
        tokens[index].value += dx;
      }
      index += 1;
    } else if (command === "V") {
      if (tokens[index] && tokens[index].type === "number") {
        tokens[index].value += dy;
      }
      index += 1;
    } else if (command === "Z") {
      command = "";
    } else {
      index += 1;
    }
  }

  return fern_serializePathTokens(tokens);
}

function fern_translatePoints(points, dx, dy) {
  return points.replace(/(-?\d*\.?\d+),(-?\d*\.?\d+)/g, (_match, x, y) => `${fern_formatNumber(Number.parseFloat(x) + dx)},${fern_formatNumber(Number.parseFloat(y) + dy)}`);
}

function fern_moveElement(element, dx, dy, original) {
  dx = fern_snap(dx);
  dy = fern_snap(dy);
  const tag = fern_getTagName(element);

  if (tag === "rect") {
    fern_setNumericAttr(element, "x", original.x + dx);
    fern_setNumericAttr(element, "y", original.y + dy);
    return;
  }
  if (tag === "circle" || tag === "ellipse") {
    fern_setNumericAttr(element, "cx", original.cx + dx);
    fern_setNumericAttr(element, "cy", original.cy + dy);
    return;
  }
  if (tag === "line") {
    fern_setNumericAttr(element, "x1", original.x1 + dx);
    fern_setNumericAttr(element, "y1", original.y1 + dy);
    fern_setNumericAttr(element, "x2", original.x2 + dx);
    fern_setNumericAttr(element, "y2", original.y2 + dy);
    return;
  }
  if (tag === "text") {
    fern_setNumericAttr(element, "x", original.x + dx);
    fern_setNumericAttr(element, "y", original.y + dy);
    return;
  }
  if (tag === "path") {
    element.setAttribute("d", fern_translatePathData(original.d, dx, dy));
    return;
  }
  if (tag === "polygon" || tag === "polyline") {
    element.setAttribute("points", fern_translatePoints(original.points, dx, dy));
    return;
  }

  const prefix = `translate(${fern_formatNumber(dx)} ${fern_formatNumber(dy)})`;
  element.setAttribute("transform", original.transform ? `${prefix} ${original.transform}` : prefix);
}

function fern_translateElementBy(element, dx, dy) {
  fern_moveElement(element, dx, dy, fern_getOriginalAttrs(element));
}

function fern_getOriginalAttrs(element) {
  return {
    x: fern_numericAttr(element, "x"),
    y: fern_numericAttr(element, "y"),
    cx: fern_numericAttr(element, "cx"),
    cy: fern_numericAttr(element, "cy"),
    x1: fern_numericAttr(element, "x1"),
    y1: fern_numericAttr(element, "y1"),
    x2: fern_numericAttr(element, "x2"),
    y2: fern_numericAttr(element, "y2"),
    d: element.getAttribute("d") || "",
    points: element.getAttribute("points") || "",
    transform: element.getAttribute("transform") || "",
  };
}

function fern_getViewBox() {
  return fernDocumentViewBox || { x: 0, y: 0, width: 100, height: 100, cx: 50, cy: 50 };
}

function fern_readViewBox(svg) {
  const values = (svg.getAttribute("viewBox") || "0 0 100 100")
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  if (values.length !== 4 || !values.every(Number.isFinite)) {
    return { x: 0, y: 0, width: 100, height: 100, cx: 50, cy: 50 };
  }

  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
    cx: values[0] + values[2] / 2,
    cy: values[1] + values[3] / 2,
  };
}

function fern_applyZoom(focusSelection = false) {
  if (!fernActiveSvg) {
    return;
  }

  const viewBox = fern_getViewBox();
  if (focusSelection && fernSelectedElement) {
    const box = fernSelectedElement.getBBox();
    fernZoomCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  const width = viewBox.width / fernZoomLevel;
  const height = viewBox.height / fernZoomLevel;
  const requestedCenter = fernZoomCenter || { x: viewBox.cx, y: viewBox.cy };
  const centerX = Math.min(viewBox.x + viewBox.width - width / 2, Math.max(viewBox.x + width / 2, requestedCenter.x));
  const centerY = Math.min(viewBox.y + viewBox.height - height / 2, Math.max(viewBox.y + height / 2, requestedCenter.y));
  fernActiveSvg.setAttribute("viewBox", `${fern_formatNumber(centerX - width / 2)} ${fern_formatNumber(centerY - height / 2)} ${fern_formatNumber(width)} ${fern_formatNumber(height)}`);
  fernActiveSvg.classList.toggle("is-zoomed", fernZoomLevel > 1);
}

function fern_changeZoom(direction) {
  if (direction === "fit") {
    fernZoomLevel = 1;
    fernZoomCenter = null;
  } else {
    fernZoomLevel = Math.max(1, Math.min(8, fernZoomLevel * (direction === "in" ? 2 : 0.5)));
  }
  fern_applyZoom(direction === "in");
  fern_renderPointHandles();
  fern_setEditorStatus(fernZoomLevel === 1 ? "Fit to drawing." : `${fernZoomLevel}x zoom.`);
}

function fern_alignSelected(mode) {
  if (!fernSelectedElement || !fernActiveSvg) {
    return;
  }

  const box = fernSelectedElement.getBBox();
  const viewBox = fern_getViewBox();
  let dx = 0;
  let dy = 0;

  if (mode === "left") {
    dx = viewBox.x - box.x;
  } else if (mode === "center-x") {
    dx = viewBox.cx - (box.x + box.width / 2);
  } else if (mode === "right") {
    dx = (viewBox.x + viewBox.width) - (box.x + box.width);
  } else if (mode === "top") {
    dy = viewBox.y - box.y;
  } else if (mode === "center-y") {
    dy = viewBox.cy - (box.y + box.height / 2);
  } else if (mode === "bottom") {
    dy = (viewBox.y + viewBox.height) - (box.y + box.height);
  }

  fern_translateElementBy(fernSelectedElement, dx, dy);
  fern_renderInspector();
  fern_renderPointHandles();
}

function fern_duplicateSelected() {
  if (!fernSelectedElement || !fernActiveSvg) {
    fern_setEditorStatus("Select a shape to duplicate.");
    return;
  }

  const clone = fernSelectedElement.cloneNode(true);
  clone.classList.remove("is-svg-selected");
  fern_translateElementBy(clone, 4, 4);
  fernSelectedElement.after(clone);
  fern_selectElement(clone);
}

function fern_duplicateSelectedRadially() {
  if (!fernSelectedElement || !fernActiveSvg) {
    return;
  }

  const countInput = fernEditor.querySelector("[data-duplicate-count]");
  const count = Math.max(2, Math.min(64, Number.parseInt(countInput.value, 10) || 2));
  const viewBox = fern_getViewBox();
  const originalTransform = fernSelectedElement.getAttribute("transform") || "";
  let lastClone = fernSelectedElement;

  // The selected element is segment zero; create the remaining evenly-spaced segments.
  for (let i = 1; i < count; i += 1) {
    const clone = fernSelectedElement.cloneNode(true);
    clone.classList.remove("is-svg-selected");
    const angle = (360 / count) * i;
    const rotation = `rotate(${fern_formatNumber(angle)} ${fern_formatNumber(viewBox.cx)} ${fern_formatNumber(viewBox.cy)})`;
    clone.setAttribute("transform", originalTransform ? `${rotation} ${originalTransform}` : rotation);
    fernSelectedElement.after(clone);
    lastClone = clone;
  }

  fern_selectElement(lastClone);
}

function fern_handlePointerDown(event) {
  const handle = event.target.closest("[data-point-index]");
  const target = fern_selectableTarget(event.target);

  if (fernDrawPathMode) {
    event.preventDefault();
    const point = fern_getCanvasPoint(event);
    const snapX = fern_snap(point.x);
    const snapY = fern_snap(point.y);

    if (fernPathBuildingPoints.length === 0) {
      fern_beginHistory();
      const element = document.createElementNS(FERN_SVG_NS, "path");
      element.setAttribute("stroke", "#fff");
      element.setAttribute("stroke-width", "1");
      element.setAttribute("fill", "none");
      element.setAttribute("stroke-linejoin", "round");
      element.setAttribute("stroke-linecap", "round");
      element.setAttribute("d", `M ${snapX} ${snapY}`);
      fernActiveSvg.append(element);
      fernDrawingPathElement = element;
      fernPathBuildingPoints.push({ x: snapX, y: snapY });
      fern_selectElement(element);
      fern_setEditorStatus("Click next point. Double-click to close path.");
    } else {
      const last = fernPathBuildingPoints[fernPathBuildingPoints.length - 1];
      if (last.x !== snapX || last.y !== snapY) {
        fernPathBuildingPoints.push({ x: snapX, y: snapY });
        fern_updateDrawingPath(point);
      }
    }
    return;
  }

  if (fernAddNodeMode) {
    let path = target && (fern_getTagName(target) === "path" || fern_getTagName(target) === "line")
      ? target
      : fernSelectedElement && (fern_getTagName(fernSelectedElement) === "path" || fern_getTagName(fernSelectedElement) === "line")
        ? fernSelectedElement
        : null;
    if (!path) {
      fern_setEditorStatus("Select a path or line before placing a node.");
      return;
    }

    event.preventDefault();
    fern_beginHistory();
    if (fern_getTagName(path) === "line") {
      path = fern_lineToPath(path);
    }
    if (path !== fernSelectedElement) {
      fern_selectElement(path);
    }
    const segment = fern_closestPathSegment(path, fern_getCanvasPoint(event));
    if (segment) {
      const added = fern_addNodeToSegment(segment, segment.t);
      fern_commitHistory();
      if (added) {
        fernAddNodeMode = false;
        fernActiveSvg.classList.remove("is-adding-node");
      }
    } else {
      fern_commitHistory();
      fern_setEditorStatus("That path segment cannot be split here.");
    }
    return;
  }

  const shouldPan = fernZoomLevel > 1 && (fernSpacePressed || event.button === 1 || (!handle && !target));
  if (shouldPan) {
    event.preventDefault();
    const point = fern_getCanvasPoint(event);
    const viewBox = fern_getViewBox();
    fernPanState = {
      startPointerX: point.x,
      startPointerY: point.y,
      startCenter: fernZoomCenter || { x: viewBox.cx, y: viewBox.cy },
    };
    fernActiveSvg.classList.add("is-panning");
    fernActiveSvg.setPointerCapture(event.pointerId);
    return;
  }

  if (handle && fernSelectedElement) {
    event.stopPropagation();
    const refs = fern_getPointRefs(fernSelectedElement);
    const ref = refs[Number.parseInt(handle.dataset.pointIndex, 10)];
    if (!ref) {
      return;
    }

    const point = fern_getCanvasPoint(event);
    fernSelectedPointIndex = Number.parseInt(handle.dataset.pointIndex, 10);
    if (event.shiftKey && fern_refHasPosition(ref)) {
      if (fernSelectedNodeIndices.has(fernSelectedPointIndex)) {
        fernSelectedNodeIndices.delete(fernSelectedPointIndex);
      } else {
        fernSelectedNodeIndices.add(fernSelectedPointIndex);
      }
      fern_renderPointHandles();
      return;
    }
    fernSelectedNodeIndices = fern_refHasPosition(ref) ? new Set([fernSelectedPointIndex]) : new Set();
    fern_beginHistory();
    fernPointDragState = {
      ref,
      refs,
      mirrorControls: (event.shiftKey || Boolean(ref.mirrorControl)) && ref.role === "control",
      startPointerX: point.x,
      startPointerY: point.y,
      startX: ref.x,
      startY: ref.y,
      moved: false,
      startCurrentX: ref.x - (ref.relative ? ref.xRef ? ref.xRef.value : 0 : 0),
      startCurrentY: ref.y - (ref.relative ? ref.yRef ? ref.yRef.value : 0 : 0),
      anchorControls: fern_refHasPosition(ref)
        ? (ref.controls || []).map((control) => ({ control, x: control.x, y: control.y }))
        : [],
    };
    fernActiveSvg.setPointerCapture(event.pointerId);
    return;
  }

  if (!target) {
    fern_selectElement(null);
    return;
  }

  fern_selectElement(target);
  const point = fern_getCanvasPoint(event);
  fern_beginHistory();
  fernDragState = {
    element: target,
    startX: point.x,
    startY: point.y,
    original: fern_getOriginalAttrs(target),
  };
  fernActiveSvg.setPointerCapture(event.pointerId);
}

function fern_handlePointerMove(event) {
  const pointerPoint = fern_getCanvasPoint(event);
  fern_setCoordinateReadout(pointerPoint.x, pointerPoint.y);

  if (fernDrawPathMode && fernDrawingPathElement && fernPathBuildingPoints.length > 0) {
    const point = pointerPoint;
    fern_updateDrawingPath(point);
    fern_setCoordinateReadout(point.x, point.y);
    return;
  }

  if (fernPanState) {
    const point = pointerPoint;
    fernZoomCenter = {
      x: fernPanState.startCenter.x - (point.x - fernPanState.startPointerX),
      y: fernPanState.startCenter.y - (point.y - fernPanState.startPointerY),
    };
    fern_applyZoom();
    return;
  }

  if (fernPointDragState && fernSelectedElement) {
    const point = pointerPoint;
    const x = fern_snap(fernPointDragState.startX + point.x - fernPointDragState.startPointerX);
    const y = fern_snap(fernPointDragState.startY + point.y - fernPointDragState.startPointerY);
    fernPointDragState.moved = fernPointDragState.moved || x !== fernPointDragState.startX || y !== fernPointDragState.startY;
    fern_applyPointRef(fernSelectedElement, fernPointDragState.ref, x, y);
    if (fernPointDragState.mirrorControls && fernPointDragState.ref.connectTo) {
      const anchor = fernPointDragState.ref.connectTo;
      const paired = fernPointDragState.ref.mirrorControl || fernPointDragState.refs.find((candidate) => (
        candidate !== fernPointDragState.ref &&
        candidate.role === "control" &&
        candidate.connectTo === anchor
      ));
      if (paired) {
        fern_setAbsolutePathPair(paired, fern_snap(anchor.x * 2 - x), fern_snap(anchor.y * 2 - y));
        fernSelectedElement.setAttribute("d", fern_serializePathTokens(paired.tokens));
      }
    }
    fern_setCoordinateReadout(x, y);
    fern_renderPointHandles();
    return;
  }

  if (!fernDragState) {
    return;
  }

  const point = pointerPoint;
  const dx = fern_snap(point.x - fernDragState.startX);
  const dy = fern_snap(point.y - fernDragState.startY);
  fern_moveElement(fernDragState.element, dx, dy, fernDragState.original);
  fern_setCoordinateReadout(fernDragState.startX + dx, fernDragState.startY + dy);
  fern_renderPointHandles();
}

function fern_handlePointerUp() {
  if (fernPanState) {
    fernPanState = null;
    fernActiveSvg.classList.remove("is-panning");
  }
  if (fernPointDragState) {
    fernPointDragState = null;
    fern_renderInspector();
    fern_renderPointHandles();
  }
  if (fernDragState) {
    fernDragState = null;
    fern_renderInspector();
    fern_renderPointHandles();
  }
  fern_commitHistory();
}

function fern_sanitizeSvg(fernSvg) {
  const fernBlockedElements = new Set([
    "script", "foreignobject", "iframe", "object", "embed", "audio", "video", "style",
  ]);
  const fernElements = [fernSvg, ...fernSvg.querySelectorAll("*")];
  for (const fernElement of fernElements) {
    const fernTag = fernElement.localName.toLowerCase();
    if (fernElement !== fernSvg && fernBlockedElements.has(fernTag)) {
      fernElement.remove();
      continue;
    }
    for (const fernAttribute of [...fernElement.attributes]) {
      const fernName = fernAttribute.name.toLowerCase();
      const fernValue = fernAttribute.value.trim();
      if (fernName.startsWith("on")) {
        fernElement.removeAttribute(fernAttribute.name);
      } else if ((fernName === "href" || fernName === "xlink:href") && !fernValue.startsWith("#")) {
        fernElement.removeAttribute(fernAttribute.name);
      } else if (fernName === "style" && /(?:url\s*\(|@import|expression\s*\()/i.test(fernValue)) {
        fernElement.removeAttribute(fernAttribute.name);
      } else if (/url\s*\(/i.test(fernValue) && !/url\s*\(\s*["']?#/i.test(fernValue)) {
        fernElement.removeAttribute(fernAttribute.name);
      }
    }
  }
  return fernSvg;
}

function fern_importSvg(content) {
  const parser = new DOMParser();
  const documentSvg = parser.parseFromString(content, "image/svg+xml");
  const parserError = documentSvg.querySelector("parsererror");
  if (parserError) {
    throw new Error("SVG could not be parsed.");
  }
  if (
    documentSvg.documentElement.localName.toLowerCase() !== "svg" ||
    documentSvg.documentElement.namespaceURI !== FERN_SVG_NS
  ) {
    throw new Error("The selected file is not an SVG document.");
  }

  const nextSvg = fern_sanitizeSvg(document.importNode(documentSvg.documentElement, true));
  nextSvg.classList.add("icon-editor-svg");
  nextSvg.setAttribute("tabindex", "0");
  if (!nextSvg.getAttribute("viewBox")) {
    nextSvg.setAttribute("viewBox", "0 0 100 100");
  }

  const canvas = fernEditor.querySelector("[data-svg-canvas]");
  canvas.replaceChildren(nextSvg);
  fernActiveSvg = nextSvg;
  fernGridGroup = null;
  fernSelectedElement = null;
  fernSelectedPointIndex = null;
  fernSelectedNodeIndices = new Set();
  fernPendingHistoryState = null;
  fernDocumentViewBox = fern_readViewBox(fernActiveSvg);
  fernZoomLevel = 1;
  fernZoomCenter = null;

  for (const path of fernActiveSvg.querySelectorAll("path")) {
    path.setAttribute("d", fern_absolutizePath(path.getAttribute("d") || ""));
  }

  fern_renderGrid();
  fern_applyZoom();
  fernActiveSvg.addEventListener("pointerdown", fern_handlePointerDown);
  fernActiveSvg.addEventListener("pointermove", fern_handlePointerMove);
  fernActiveSvg.addEventListener("pointerup", fern_handlePointerUp);
  fernActiveSvg.addEventListener("pointercancel", fern_handlePointerUp);
  fern_renderInspector();
}

function fern_setCurrentFile(fernName, fernHandle = null) {
  fernCurrentFileName = fernName || "untitled.svg";
  fernLocalFileHandle = fernHandle;
  const fernLabel = fernEditor.querySelector("[data-current-file]");
  if (fernLabel) {
    fernLabel.textContent = fernCurrentFileName;
  }
}

function fern_loadLocalSvg(fernContent, fernName, fernHandle = null) {
  fern_importSvg(fernContent);
  fernOriginalSvgContent = fern_cleanForSave();
  fern_setCurrentFile(fernName, fernHandle);
  fernUndoStack = [];
  fernRedoStack = [];
  fern_updateHistoryControls();
  fern_autoSaveLocal();
  fern_setEditorStatus(fernCurrentFileName);
}

function fern_newSvg() {
  if (!fern_confirmDiscardChanges()) {
    return;
  }
  fern_clearAutoSaveLocal();
  fern_loadLocalSvg(FERN_EMPTY_SVG, "untitled.svg");
  fern_setEditorStatus("New drawing.");
}

async function fern_readLocalFile(fernFile) {
  if (fernFile.size > FERN_MAX_LOCAL_FILE_BYTES) {
    throw new Error("SVG files must be 10 MiB or smaller.");
  }
  return fernFile.text();
}

async function fern_openSvg() {
  if (!fern_confirmDiscardChanges()) {
    return;
  }
  if ("showOpenFilePicker" in window) {
    try {
      const [fernHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: "SVG drawing", accept: { "image/svg+xml": [".svg"] } }],
      });
      const fernFile = await fernHandle.getFile();
      fern_loadLocalSvg(await fern_readLocalFile(fernFile), fernFile.name, fernHandle);
    } catch (fernError) {
      if (fernError.name !== "AbortError") {
        fern_setEditorStatus(fernError.message || "Could not open SVG.");
      }
    }
    return;
  }
  fernEditor.querySelector("[data-local-file-input]").click();
}

async function fern_openFallbackFile(fernEvent) {
  const [fernFile] = fernEvent.target.files;
  fernEvent.target.value = "";
  if (!fernFile) {
    return;
  }
  try {
    fern_loadLocalSvg(await fern_readLocalFile(fernFile), fernFile.name);
  } catch (fernError) {
    fern_setEditorStatus(fernError.message || "Could not open SVG.");
  }
}

function fern_downloadSvg(fernContent, fernName) {
  const fernBlobUrl = URL.createObjectURL(
    new Blob([fernContent], { type: "image/svg+xml;charset=utf-8" })
  );
  const fernLink = document.createElement("a");
  fernLink.href = fernBlobUrl;
  fernLink.download = fernName;
  fernLink.click();
  window.setTimeout(() => URL.revokeObjectURL(fernBlobUrl), 0);
}

async function fern_writeLocalFile(fernHandle, fernContent) {
  const fernWritable = await fernHandle.createWritable();
  await fernWritable.write(fernContent);
  await fernWritable.close();
}

function fern_cleanForSave() {
  const clone = fernActiveSvg.cloneNode(true);
  clone.classList.remove("icon-editor-svg");
  clone.removeAttribute("tabindex");
  const viewBox = fern_getViewBox();
  clone.setAttribute("viewBox", `${fern_formatNumber(viewBox.x)} ${fern_formatNumber(viewBox.y)} ${fern_formatNumber(viewBox.width)} ${fern_formatNumber(viewBox.height)}`);
  for (const element of clone.querySelectorAll(".is-svg-selected")) {
    element.classList.remove("is-svg-selected");
    if (!element.getAttribute("class")) {
      element.removeAttribute("class");
    }
  }
  for (const group of clone.querySelectorAll("[data-editor-handles]")) {
    group.remove();
  }
  for (const group of clone.querySelectorAll("[data-editor-grid]")) {
    group.remove();
  }
  for (const element of clone.querySelectorAll("[data-node-modes]")) {
    element.removeAttribute("data-node-modes");
  }
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", FERN_SVG_NS);
  }
  return new XMLSerializer().serializeToString(clone);
}

function fern_hasUnsavedChanges() {
  return Boolean(fernActiveSvg) && fern_cleanForSave() !== fernOriginalSvgContent;
}

function fern_confirmDiscardChanges() {
  return !fern_hasUnsavedChanges() || window.confirm(
    `Discard unsaved changes to ${fernCurrentFileName}?`
  );
}

async function fern_saveSvg() {
  if (!fernActiveSvg) {
    return;
  }

  const fernContent = fern_cleanForSave();
  let fernHandle = fernLocalFileHandle;
  if (!fernHandle && "showSaveFilePicker" in window) {
    try {
      fernHandle = await window.showSaveFilePicker({
        suggestedName: fernCurrentFileName,
        types: [{ description: "SVG drawing", accept: { "image/svg+xml": [".svg"] } }],
      });
    } catch (fernError) {
      if (fernError.name !== "AbortError") {
        fern_setEditorStatus(fernError.message || "Could not save SVG.");
      }
      return;
    }
  }

  try {
    if (fernHandle) {
      await fern_writeLocalFile(fernHandle, fernContent);
      const fernFile = await fernHandle.getFile();
      fern_setCurrentFile(fernFile.name, fernHandle);
    } else {
      fern_downloadSvg(fernContent, fernCurrentFileName);
    }
  } catch (fernError) {
    fern_setEditorStatus(fernError.message || "Could not save SVG.");
    return;
  }
  fernOriginalSvgContent = fernContent;
  fern_setEditorStatus(`Saved ${fernCurrentFileName} to your computer.`);
}

async function fern_saveSvgToAccount() {
  if (!fernActiveSvg) {
    return;
  }
  try {
    await fern_refreshSession();
    if (!fernSessionAuthenticated) {
      fern_setEditorStatus("Log into your account to save SVGs to your account.");
      return;
    }
    const csrfResponse = await fetch("/account/assets/", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const csrfContentType = csrfResponse.headers.get("content-type") || "";
    if (csrfResponse.redirected || !csrfResponse.ok || csrfContentType.indexOf("application/json") === -1) {
      throw new Error("Log into your account to save SVGs to your account.");
    }
    const response = await fetch("/account/assets/", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-CSRFToken": decodeURIComponent(fern_getCookie("csrftoken")),
      },
      body: JSON.stringify({
        logical_name: fernCurrentFileName,
        content: fern_cleanForSave(),
        mime_type: "image/svg+xml",
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Could not save the SVG to your account.");
    }
    fern_setEditorStatus(`Saved ${payload.logical_name} to your account library.`);
  } catch (fernError) {
    fern_setEditorStatus(fernError.message || "Could not save the SVG to your account.");
  }
}

function fern_revertSvg() {
  fern_loadLocalSvg(fernOriginalSvgContent, fernCurrentFileName, fernLocalFileHandle);
  fern_setEditorStatus(`Reverted ${fernCurrentFileName}.`);
}

function fern_addShape(type) {
  if (!fernActiveSvg) {
    return;
  }

  if (type === "path") {
    fern_activateDrawPathMode();
    return;
  }

  fern_beginHistory();
  const element = document.createElementNS(FERN_SVG_NS, type);
  element.setAttribute("stroke", "#fff");
  element.setAttribute("stroke-width", "1");
  element.setAttribute("fill", "none");

  if (type === "rect") {
    element.setAttribute("x", "28");
    element.setAttribute("y", "28");
    element.setAttribute("width", "44");
    element.setAttribute("height", "44");
  } else if (type === "circle") {
    element.setAttribute("cx", "50");
    element.setAttribute("cy", "50");
    element.setAttribute("r", "22");
  } else if (type === "ellipse") {
    element.setAttribute("cx", "50");
    element.setAttribute("cy", "50");
    element.setAttribute("rx", "28");
    element.setAttribute("ry", "18");
  } else if (type === "line") {
    element.setAttribute("x1", "25");
    element.setAttribute("y1", "50");
    element.setAttribute("x2", "75");
    element.setAttribute("y2", "50");
    element.setAttribute("stroke-linecap", "round");
  } else if (type === "polygon") {
    element.setAttribute("points", "50,20 78,75 22,75");
    element.setAttribute("stroke-linejoin", "round");
  }

  element.setAttribute("stroke", fernToolbarColors.stroke);
  element.setAttribute("fill", fernToolbarColors.fill);

  fernActiveSvg.append(element);
  fern_selectElement(element);
  fern_commitHistory();
}

function fern_closeAllMenus() {
  document.querySelectorAll(".site-menu-item.is-open").forEach((item) => {
    item.classList.remove("is-open");
    const trigger = item.querySelector(".site-menu-trigger");
    if (trigger) {
      trigger.setAttribute("aria-expanded", "false");
    }
  });
}

async function fern_setupEditor() {
  if (!fernEditor) {
    return;
  }

  fern_renderColorSetAccess();
  await fern_refreshSession();
  fern_loadLocalPalette();
  fern_loadToolbarColors();
  fern_syncToolbarColors();
  fern_loadLoadedColorSet();

  const colorDialog = fernEditor.querySelector("[data-color-dialog]");
  if (colorDialog) {
    colorDialog.addEventListener("cancel", fern_cancelColorEditor);
  }

  fernEditor.querySelector("[data-local-file-input]").addEventListener(
    "change", fern_openFallbackFile
  );

  const inspector = fernEditor.querySelector("[data-inspector]");
  if (inspector) {
    inspector.addEventListener("input", (event) => {
      fern_updateSelectedAttr(event);
      fern_updateDocumentAttr(event);
      fern_updateColorAttr(event);
    });
    inspector.addEventListener("change", (event) => {
      fern_updateSelectedAttr(event);
      fern_updateDocumentAttr(event);
      fern_updateColorAttr(event);
    });
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".site-menu-item")) {
      fern_closeAllMenus();
    }
  });

  fernEditor.addEventListener("dblclick", (event) => {
    if (fernDrawPathMode) {
      event.preventDefault();
      event.stopPropagation();
      fern_finishDrawPath(true);
    }
  });

  document.addEventListener("change", (event) => {
    const radio = event.target.closest('[data-canvas-bg]');
    if (radio) {
      fern_setCanvasBackground(radio.dataset.canvasBg);
      fern_closeAllMenus();
    }
    const paletteHex = event.target.closest("[data-palette-hex]");
    if (paletteHex) {
      fern_updateActivePaletteColor(paletteHex.value);
    }
    const toolbarHex = event.target.closest("[data-toolbar-color-hex]");
    if (toolbarHex) {
      fern_updateToolbarColorFromValue(toolbarHex.value);
    }
  });

  document.addEventListener("input", (event) => {
    const paletteHex = event.target.closest("[data-palette-hex]");
    if (paletteHex && /^#[0-9a-fA-F]{6}$/.test(paletteHex.value.trim())) {
      fern_updateActivePaletteColor(paletteHex.value, false);
    }
    const toolbarHex = event.target.closest("[data-toolbar-color-hex]");
    if (toolbarHex && /^#[0-9a-fA-F]{6}$/.test(toolbarHex.value.trim())) {
      fern_updateToolbarColorFromValue(toolbarHex.value, false);
    }
    const paletteHue = event.target.closest("[data-palette-picker-hue]");
    if (paletteHue) {
      const hsv = fern_hexToHsv(fern_paletteEditorColors()[fernActivePaletteSlot]);
      hsv.h = Number(paletteHue.value) || 0;
      fern_updateActivePaletteColor(fern_hsvToHex(hsv), false);
    }
    const toolbarHue = event.target.closest("[data-toolbar-color-picker-hue]");
    if (toolbarHue && fernToolbarEditRole) {
      const hsv = fern_hexToHsv(fernToolbarColors[fernToolbarEditRole]);
      hsv.h = Number(toolbarHue.value) || 0;
      fern_updateToolbarColorFromValue(fern_hsvToHex(hsv), false);
    }
  });

  document.addEventListener("pointerdown", (event) => {
    const paletteSurface = event.target.closest("[data-palette-picker-surface]");
    const toolbarSurface = event.target.closest("[data-toolbar-color-picker-surface]");
    const surface = paletteSurface || toolbarSurface;
    if (!surface) {
      return;
    }
    event.preventDefault();
    const update = (pointerEvent) => {
      const bounds = surface.getBoundingClientRect();
      const saturation = Math.max(0, Math.min(1, (pointerEvent.clientX - bounds.left) / bounds.width));
      const brightness = 1 - Math.max(0, Math.min(1, (pointerEvent.clientY - bounds.top) / bounds.height));
      const currentColor = paletteSurface
        ? fern_paletteEditorColors()[fernActivePaletteSlot]
        : fernToolbarColors[fernToolbarEditRole];
      const hsv = fern_hexToHsv(currentColor);
      const color = fern_hsvToHex({ h: hsv.h, s: saturation, v: brightness });
      if (paletteSurface) {
        fern_updateActivePaletteColor(color);
      } else {
        fern_updateToolbarColorFromValue(color);
      }
    };
    update(event);
    const move = (moveEvent) => update(moveEvent);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTextInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
    if (isTextInput) {
      return;
    }

    if (fernDrawPathMode && (event.key === "Escape" || event.key === "Enter")) {
      event.preventDefault();
      fern_finishDrawPath(event.key === "Enter");
      return;
    }

    if (event.code === "Space" && fernEditor.contains(target)) {
      fernSpacePressed = true;
      event.preventDefault();
      return;
    }

    if (event.key === "Escape" && fernAddNodeMode) {
      fernAddNodeMode = false;
      fernActiveSvg.classList.remove("is-adding-node");
      fern_setEditorStatus("Add node cancelled.");
      return;
    }

    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        fern_redo();
      } else {
        fern_undo();
      }
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      fern_redo();
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") {
      return;
    }

    if (fernSelectedNodeIndices.size > 0) {
      event.preventDefault();
      fern_beginHistory();
      fern_deleteSelectedNodes();
      fern_commitHistory();
    } else if (fernSelectedElement) {
      event.preventDefault();
      fern_beginHistory();
      fernSelectedElement.remove();
      fern_selectElement(null);
      fern_commitHistory();
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      fernSpacePressed = false;
    }
  });

  window.addEventListener("beforeunload", () => {
    fern_autoSaveLocal();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".site-menu-item")) {
      fern_closeAllMenus();
    }
  });

  fernEditor.addEventListener("click", (event) => {
    const menuTrigger = event.target.closest(".site-menu-trigger");
    if (menuTrigger) {
      const menuItem = menuTrigger.closest(".site-menu-item");
      if (menuItem) {
        const isOpen = menuItem.classList.contains("is-open");
        fern_closeAllMenus();
        if (!isOpen) {
          menuItem.classList.add("is-open");
          menuTrigger.setAttribute("aria-expanded", "true");
        }
      }
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    const addButton = event.target.closest("[data-add]");
    const alignButton = event.target.closest("[data-align]");
    const nodeActionButton = event.target.closest("[data-node-action]");
    const layerButton = event.target.closest("[data-layer]");
    const groupButton = event.target.closest("[data-group-action]");
    const canvasBgButton = event.target.closest("[data-canvas-bg]");
    const paletteSlotButton = event.target.closest("[data-palette-slot]");
    const toolbarChoiceButton = event.target.closest("[data-toolbar-color-choice]");

    if (canvasBgButton && canvasBgButton.tagName === "BUTTON") {
      fern_setCanvasBackground(canvasBgButton.dataset.canvasBg);
      fern_closeAllMenus();
    } else if (paletteSlotButton) {
      fern_setActivePaletteSlot(paletteSlotButton.dataset.paletteSlot);
    } else if (toolbarChoiceButton) {
      fern_applyToolbarPaletteChoice(toolbarChoiceButton.dataset.toolbarColorChoice);
    } else if (layerButton) {
      fern_beginHistory();
      fern_moveLayer(layerButton.dataset.layer);
      fern_commitHistory();
    } else if (groupButton) {
      fern_beginHistory();
      if (groupButton.dataset.groupAction === "group") {
        fern_groupSelected();
      } else if (groupButton.dataset.groupAction === "ungroup") {
        fern_ungroupSelected();
      }
      fern_commitHistory();
    } else if (addButton) {
      fern_addShape(addButton.dataset.add);
    } else if (alignButton) {
      fern_beginHistory();
      fern_alignSelected(alignButton.dataset.align);
      fern_commitHistory();
    } else if (nodeActionButton && nodeActionButton.dataset.nodeAction === "corner") {
      fern_beginHistory();
      fern_setNodeMode("corner");
      fern_commitHistory();
    } else if (nodeActionButton && nodeActionButton.dataset.nodeAction === "smooth") {
      fern_beginHistory();
      fern_setNodeMode("smooth");
      fern_commitHistory();
    } else if (nodeActionButton && nodeActionButton.dataset.nodeAction === "straight") {
      fern_beginHistory();
      fern_setSelectedSegmentMode("straight");
      fern_commitHistory();
    } else if (nodeActionButton && nodeActionButton.dataset.nodeAction === "curve") {
      fern_beginHistory();
      fern_setSelectedSegmentMode("curve");
      fern_commitHistory();
    } else if (nodeActionButton && nodeActionButton.dataset.nodeAction === "add") {
      fern_activateAddNodeMode();
    } else if (nodeActionButton && nodeActionButton.dataset.nodeAction === "merge") {
      fern_beginHistory();
      fern_mergeSelectedNodes();
      fern_commitHistory();
    } else if (nodeActionButton && nodeActionButton.dataset.nodeAction === "delete") {
      fern_beginHistory();
      fern_deleteSelectedNodes();
      fern_commitHistory();
    } else if (actionButton && actionButton.dataset.action === "new") {
      fern_closeAllMenus();
      fern_newSvg();
    } else if (actionButton && actionButton.dataset.action === "open") {
      fern_closeAllMenus();
      fern_openSvg();
    } else if (actionButton && actionButton.dataset.action === "fern_undo") {
      fern_undo();
    } else if (actionButton && actionButton.dataset.action === "fern_redo") {
      fern_redo();
    } else if (actionButton && actionButton.dataset.action === "zoom-out") {
      fern_changeZoom("out");
    } else if (actionButton && actionButton.dataset.action === "zoom-in") {
      fern_changeZoom("in");
    } else if (actionButton && actionButton.dataset.action === "zoom-fit") {
      fern_changeZoom("fit");
    } else if (actionButton && actionButton.dataset.action === "save") {
      fern_closeAllMenus();
      fern_saveSvg();
    } else if (actionButton && actionButton.dataset.action === "save-to-account") {
      fern_closeAllMenus();
      fern_saveSvgToAccount();
    } else if (actionButton && actionButton.dataset.action === "edit-color-set") {
      fern_closeAllMenus();
      fern_openColorEditor();
    } else if (actionButton && actionButton.dataset.action === "edit-toolbar-color") {
      fern_closeAllMenus();
      fern_openToolbarColorEditor(actionButton.dataset.colorRole, actionButton.dataset.colorSource || "toolbar");
    } else if (actionButton && actionButton.dataset.action === "color-dialog-ok") {
      fern_commitColorEditor();
    } else if (actionButton && actionButton.dataset.action === "color-dialog-cancel") {
      fern_cancelColorEditor();
    } else if (actionButton && actionButton.dataset.action === "close-color-editor") {
      fern_cancelColorEditor();
    } else if (actionButton && actionButton.dataset.action === "close-toolbar-color-editor") {
      fern_closeToolbarColorEditor();
    } else if (actionButton && actionButton.dataset.action === "load-color-set") {
      fern_loadColorSet();
    } else if (actionButton && actionButton.dataset.action === "save-color-set") {
      fern_closeAllMenus();
      fern_saveColorSet();
    } else if (actionButton && actionButton.dataset.action === "show-shortcuts") {
      fern_closeAllMenus();
      fern_setEditorStatus("Shortcuts: Space pans · Ctrl/Cmd+Z undoes · Ctrl/Cmd+I toggles the inspector.");
    } else if (actionButton && actionButton.dataset.action === "show-about") {
      fern_closeAllMenus();
      fern_setEditorStatus("Phrond Draw — edit SVG files locally.");
    } else if (actionButton && actionButton.dataset.action === "reload") {
      fern_closeAllMenus();
      fern_revertSvg();
    } else if (actionButton && actionButton.dataset.action === "duplicate-radial") {
      fern_beginHistory();
      fern_duplicateSelectedRadially();
      fern_commitHistory();
    } else if (actionButton && actionButton.dataset.action === "duplicate") {
      fern_beginHistory();
      fern_duplicateSelected();
      fern_commitHistory();
    } else if (actionButton && actionButton.dataset.action === "delete" && fernSelectedElement) {
      fern_beginHistory();
      fernSelectedElement.remove();
      fern_selectElement(null);
      fern_commitHistory();
    }
  });

  if (!fern_loadAutoSavedDraft()) {
    fern_loadLocalSvg(FERN_EMPTY_SVG, "untitled.svg");
    fern_setEditorStatus("New drawing.");
  }
}

fern_setupEditor().catch((fernError) => fern_setEditorStatus(fernError.message));
