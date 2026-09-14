const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/fern-draw.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}
function setup(d) {
  const attrs = { d };
  const path = { tagName: 'path', getAttribute: k => attrs[k] || null,
    setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; } };
  const ctx = vm.createContext({ fernSelectedElement: path, fernSelectedNodeIndices: new Set(),
    fernSelectedPointIndex: null, fern_snap: v => v, fern_setEditorStatus() {}, fern_renderPointHandles() {} });
  const names = ['fern_formatNumber', 'fern_getTagName', 'fern_nodeModeKey', 'fern_getNodeModeOverrides',
    'fern_setNodeModeOverride', 'fern_hasSmoothControlGeometry', 'fern_pathTokens', 'fern_serializePathTokens',
    'fern_absolutizePath', 'fern_getPathPointRefs', 'fern_getPointRefs', 'fern_refHasPosition',
    'fern_selectedAnchorRefs', 'fern_pathCommand', 'fern_selectAnchorOrdinals',
    'fern_convertAdjacentSegmentsToCurves', 'fern_setAbsolutePathPair', 'fern_setNodeMode', 'fern_setSelectedSegmentMode'];
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return { ctx, path, anchors: () => ctx.fern_getPointRefs(path).filter(ctx.fern_refHasPosition) };
}
for (const d of ['M 0 0 L 30 0 L 30 30 L 60 30', 'm 0 0 30 0 0 30 30 0', 'M 0 0 H 30 V 30 H 60', 'M 0 0 L 30 0 L 30 30 Z']) {
  test(`batch smooth preserves anchors, selection, and types: ${d}`, () => {
    const { ctx, path, anchors } = setup(d);
    const positions = anchors().map(a => [a.x, a.y]);
    ctx.fern_selectAnchorOrdinals([0, 1]);
    ctx.fern_setNodeMode('smooth');
    assert.deepEqual(anchors().map(a => [a.x, a.y]), positions);
    assert.equal(anchors()[0].pointMode, 'smooth');
    assert.equal(anchors()[1].pointMode, 'smooth');
    assert.ok(anchors()[1].controls.length >= 2);
    assert.ok(ctx.fern_hasSmoothControlGeometry(anchors()[1]));
    assert.deepEqual(ctx.fern_selectedAnchorRefs().map(a => [a.x, a.y]), positions.slice(0, 2));
    ctx.fern_selectAnchorOrdinals([2]);
    ctx.fern_setNodeMode('smooth');
    assert.equal(anchors()[0].pointMode, 'smooth');
    assert.equal(anchors()[1].pointMode, 'smooth');
    ctx.fern_selectAnchorOrdinals([0, 1]);
    ctx.fern_setNodeMode('corner');
    assert.equal(anchors()[0].pointMode, 'corner');
    assert.equal(anchors()[1].pointMode, 'corner');
    assert.equal(anchors()[2].pointMode, 'smooth');
    if (d.endsWith('Z')) assert.ok(path.getAttribute('d').endsWith('Z'));
  });
}

test('straight diamonds -> square nodes -> curved segments keeps the nodes square', () => {
  const { ctx, anchors } = setup('M 0 0 L 30 0 L 30 30 L 60 30');
  assert.ok(anchors().every(a => a.pointMode === 'corner'));
  ctx.fern_selectAnchorOrdinals([0, 1, 2, 3]);
  ctx.fern_setNodeMode('smooth');
  for (const pair of [[0, 1], [1, 2], [2, 3]]) {
    ctx.fern_selectAnchorOrdinals(pair);
    ctx.fern_setSelectedSegmentMode('curve');
    assert.ok(anchors().every(a => a.pointMode === 'smooth'));
    ctx.fern_setSelectedSegmentMode('straight');
    assert.ok(anchors().every(a => a.pointMode === 'smooth'));
    ctx.fern_setSelectedSegmentMode('curve');
    assert.ok(anchors().every(a => a.pointMode === 'smooth'));
  }
});

test('saving retains explicit node types for reopening', () => {
  const { ctx, path, anchors } = setup('M 0 0 L 30 0 L 30 30');
  ctx.fern_selectAnchorOrdinals([0, 1]);
  ctx.fern_setNodeMode('smooth');
  const clone = {
    attrs: {}, classList: { remove() {} },
    getAttribute(k) { return this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    querySelectorAll(selector) { return selector === '[data-node-modes]' ? [path] : []; },
  };
  ctx.fernActiveSvg = { cloneNode: () => clone };
  ctx.fern_getViewBox = () => ({x: 0, y: 0, width: 100, height: 100});
  ctx.FERN_SVG_NS = 'http://www.w3.org/2000/svg';
  ctx.XMLSerializer = class { serializeToString() {
    return JSON.stringify({d: path.getAttribute('d'), modes: path.getAttribute('data-node-modes')});
  } };
  vm.runInContext(extract('fern_cleanForSave'), ctx);
  const saved = JSON.parse(ctx.fern_cleanForSave());
  const reopened = setup(saved.d);
  reopened.path.setAttribute('data-node-modes', saved.modes);
  assert.deepEqual(Array.from(reopened.anchors(), a => a.pointMode), Array.from(anchors(), a => a.pointMode));
  assert.ok(saved.modes);
});
