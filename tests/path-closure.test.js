const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/fern-draw.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}
function setup() {
  const ctx = vm.createContext({});
  vm.runInContext(['fern_pathTokens', 'fern_absolutizePath', 'fern_pathCommand',
    'fern_serializePathTokens', 'fern_formatNumber', 'fern_pathWithClosure'].map(extract).join('\n'), ctx);
  return ctx;
}
test('close and reopen adds and removes only the closing edge', () => {
  const ctx = setup();
  const d = 'M 0 0 L 30 0 C 40 0 40 30 30 30';
  const closed = ctx.fern_pathWithClosure(d, true);
  assert.equal(closed, d + ' Z');
  assert.equal(ctx.fern_pathWithClosure(closed, true), closed);
  assert.equal(ctx.fern_pathWithClosure(closed, false), d);
  assert.equal(ctx.fern_pathWithClosure(d, false), d);
});
test('multiple subpaths close separately and relative positions survive reopening', () => {
  const ctx = setup();
  const d = 'm 10 10 l 20 0 l 0 20 z m 50 0 l 20 0 l 0 20';
  const closed = ctx.fern_pathWithClosure(d, true);
  assert.equal(closed, 'M 10 10 L 30 10 L 30 30 Z M 60 10 L 80 10 L 80 30 Z');
  assert.equal(ctx.fern_pathWithClosure(closed, false), 'M 10 10 L 30 10 L 30 30 M 60 10 L 80 10 L 80 30');
});
test('drawing double-click closes before shape selection and omits the second click vertex', () => {
  const ctx = setup();
  const attrs = {};
  const path = { setAttribute: (k, v) => { attrs[k] = v; } };
  let commits = 0;
  Object.assign(ctx, {
    fernActiveSvg: {classList: {remove() {}}}, fernEditorMode: 'draw', fernSpacePressed: false,
    fernEditor: {querySelector: () => null}, fernDrawPathMode: true,
    fernDrawingPathElement: path, fernPathBuildingPoints: [{x: 0, y: 0}, {x: 30, y: 0}],
    fern_getCanvasPoint: e => ({x: e.x, y: e.y}), fern_snap: v => v,
    fern_setEditorStatus() {}, fern_selectElement() {}, fern_commitHistory() { commits++; },
    fern_setEditorMode(mode) { ctx.fernEditorMode = mode; },
    fern_selectableTarget() { throw new Error('Drawing must finish before selection handling'); },
  });
  vm.runInContext(['fern_updateDrawingPath', 'fern_finishDrawPath', 'fern_handlePointerDown', 'fern_handleDoubleClick'].map(extract).join('\n'), ctx);
  const event = {button: 0, x: 30, y: 30, detail: 1, target: {closest: () => null}, preventDefault() {}, stopPropagation() {}};
  ctx.fern_handlePointerDown(event);
  ctx.fern_handlePointerDown({...event, detail: 2});
  ctx.fern_handleDoubleClick(event);
  assert.equal(attrs.d, 'M 0 0 L 30 0 L 30 30 Z');
  assert.equal(ctx.fernDrawPathMode, false);
  assert.equal(commits, 1);
});

test('close and open controls preserve square nodes and support undo snapshots', () => {
  const ctx = setup();
  const attrs = {d: 'M 0 0 L 30 0 L 30 30', 'data-node-modes': '{"1":"smooth","4":"smooth","7":"smooth"}'};
  const path = {tagName: 'path', getAttribute: k => attrs[k] || null,
    setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }};
  const snapshots = [];
  Object.assign(ctx, {fernSelectedElement: path, fernSelectedNodeIndices: new Set([0, 1]), fernSelectedPointIndex: 0,
    fern_getSelectedElements: () => [path], fern_beginHistory: () => snapshots.push({...attrs}),
    fern_commitHistory() {}, fern_renderPointHandles() {}, fern_setEditorStatus() {}});
  vm.runInContext(['fern_getTagName', 'fern_nodeModeKey', 'fern_getNodeModeOverrides', 'fern_setNodeModeOverride',
    'fern_hasSmoothControlGeometry', 'fern_getPathPointRefs', 'fern_getPointRefs', 'fern_refHasPosition',
    'fern_setSelectedPathsClosed'].map(extract).join('\n'), ctx);
  for (const closed of [true, false]) {
    ctx.fern_setSelectedPathsClosed(closed);
    assert.equal(attrs.d.endsWith('Z'), closed);
    assert.ok(ctx.fern_getPointRefs(path).every(r => r.pointMode === 'smooth'));
    assert.deepEqual(Array.from(ctx.fernSelectedNodeIndices), [0, 1]);
  }
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].d.endsWith('Z'), false);
  assert.equal(snapshots[1].d.endsWith('Z'), true);
});
