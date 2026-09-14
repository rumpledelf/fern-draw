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
    'fern_serializePathTokens', 'fern_formatNumber', 'fern_planNodeConnection'].map(extract).join('\n'), ctx);
  return ctx;
}
test('drawing double-click closes before shape selection and omits the second click vertex', () => {
  const ctx = setup();
  const attrs = {};
  const path = { setAttribute: (k, v) => { attrs[k] = v; } };
  let commits = 0;
  Object.assign(ctx, {
    fernActiveSvg: {classList: {remove() {}, toggle() {}}}, fernEditorMode: 'draw', fernSpacePressed: false,
    fernEditor: {querySelector: () => null}, fernCanvasAction: "draw-path",
    fernDrawingPathElement: path, fernPathBuildingPoints: [{x: 0, y: 0}, {x: 30, y: 0}],
    fern_getCanvasPoint: e => ({x: e.x, y: e.y}), fern_snap: v => v,
    fern_setEditorStatus() {}, fern_selectElement() {}, fern_commitHistory() { commits++; },
    fern_setEditorMode(mode) { ctx.fernEditorMode = mode; },
    fern_selectableTarget() { throw new Error('Drawing must finish before selection handling'); },
  });
  vm.runInContext(['fern_setCanvasAction', 'fern_drawingPathData', 'fern_updateDrawingPath', 'fern_finishDrawPath', 'fern_handlePointerDown', 'fern_handleDoubleClick'].map(extract).join('\n'), ctx);
  const event = {button: 0, x: 30, y: 30, detail: 1, target: {closest: () => null}, preventDefault() {}, stopPropagation() {}};
  ctx.fern_handlePointerDown(event);
  ctx.fern_handlePointerDown({...event, detail: 2});
  ctx.fern_handleDoubleClick(event);
  assert.equal(attrs.d, 'M 0 0 L 30 0 L 30 30 Z');
  assert.equal(ctx.fernCanvasAction, null);
  assert.equal(commits, 1);
});

test('add line closes only the selected open endpoints', () => {
  const ctx = setup();
  const result = ctx.fern_planNodeConnection('M 0 0 L 30 0 L 30 30 M 80 0 L 90 0', [0, 2], true);
  assert.equal(result.d, 'M 0 0 L 30 0 L 30 30 Z M 80 0 L 90 0');
  assert.deepEqual(Array.from(result.nodeOrder), [0, 1, 2, 3, 4]);
});
test('remove an interior line opens a closed path at that exact edge', () => {
  const ctx = setup();
  const result = ctx.fern_planNodeConnection('M 0 0 L 30 0 C 40 0 40 30 30 30 L 0 30 Z', [1, 2], false);
  assert.equal(result.d, 'M 30 30 L 0 30 L 0 0 L 30 0');
  assert.deepEqual(Array.from(result.nodeOrder), [2, 3, 0, 1]);
});
test('remove an open-path segment retains both endpoint nodes and every other curve', () => {
  const ctx = setup();
  const result = ctx.fern_planNodeConnection('M 0 0 C 5 0 10 10 15 10 L 30 20 Q 40 30 50 20', [1, 2], false);
  assert.equal(result.d, 'M 0 0 C 5 0 10 10 15 10 M 30 20 Q 40 30 50 20');
  const joined = ctx.fern_planNodeConnection(result.d, [1, 2], true);
  assert.equal(joined.d, 'M 0 0 C 5 0 10 10 15 10 L 30 20 Q 40 30 50 20');
});
test('joining two starting endpoints reverses the first curve without changing its geometry', () => {
  const ctx = setup();
  const result = ctx.fern_planNodeConnection('M 0 0 C 5 0 10 10 15 10 M 30 20 L 50 20', [0, 2], true);
  assert.equal(result.d, 'M 15 10 C 10 10 5 0 0 0 L 30 20 L 50 20');
  assert.deepEqual(Array.from(result.nodeOrder), [1, 0, 2, 3]);
});
test('remove closing curve retains the other edges and both selected nodes', () => {
  const ctx = setup();
  const result = ctx.fern_planNodeConnection('M 0 0 L 30 0 L 30 30 C 20 30 0 10 0 0 Z', [0, 2], false);
  assert.equal(result.d, 'M 0 0 L 30 0 L 30 30');
});
test('splitting before a reflected curve preserves its explicit control geometry', () => {
  const ctx = setup();
  const result = ctx.fern_planNodeConnection('M 0 0 C 5 0 10 10 15 10 S 25 20 30 10', [0, 1], false);
  assert.equal(result.d, 'M 0 0 M 15 10 C 20 10 25 20 30 10');
});
test('invalid node pairs leave path unchanged', () => {
  const ctx = setup();
  const d = 'M 0 0 L 30 0 L 30 30 L 0 30';
  for (const [selected, add] of [[[0], true], [[0, 1], true], [[0, 2], true], [[0, 2], false]]) {
    const result = ctx.fern_planNodeConnection(d, selected, add);
    assert.ok(result.error);
    assert.equal(result.d, undefined);
  }
});
test('connection editing keeps square nodes and selected endpoints through reordering', () => {
  const ctx = setup();
  const attrs = {d: 'M 0 0 L 30 0 L 30 30 L 0 30 Z', 'data-node-modes': '{"1":"smooth","4":"smooth","7":"smooth","10":"corner"}'};
  const path = {tagName: 'path', getAttribute: k => attrs[k] || null,
    setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }};
  const snapshots = [];
  Object.assign(ctx, {fernSelectedElement: path, fernSelectedNodeIndices: new Set([1, 2]), fernSelectedPointIndex: 1,
    fern_beginHistory: () => snapshots.push({...attrs}), fern_commitHistory() {}, fern_renderPointHandles() {}, fern_setEditorStatus() {}});
  vm.runInContext(['fern_getTagName', 'fern_nodeModeKey', 'fern_getNodeModeOverrides', 'fern_setNodeModeOverride',
    'fern_hasSmoothControlGeometry', 'fern_getPathPointRefs', 'fern_getPointRefs', 'fern_refHasPosition',
    'fern_selectAnchorOrdinals', 'fern_writePath', 'fern_setSelectedNodeConnection'].map(extract).join('\n'), ctx);
  for (const add of [false, true]) {
    ctx.fern_setSelectedNodeConnection(add);
    const refs = ctx.fern_getPointRefs(path);
    const nodes = refs.filter(ctx.fern_refHasPosition);
    assert.equal(attrs.d.endsWith('Z'), add);
    assert.ok(nodes.filter(r => r.x !== 0 || r.y !== 30).every(r => r.pointMode === 'smooth'));
    assert.equal(nodes.find(r => r.x === 0 && r.y === 30).pointMode, 'corner');
    const selected = Array.from(ctx.fernSelectedNodeIndices, index => [refs[index].x, refs[index].y]);
    assert.deepEqual(selected, [[30, 30], [30, 0]]);
  }
  assert.equal(snapshots.length, 2);
});
