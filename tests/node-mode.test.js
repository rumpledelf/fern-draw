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

for (const side of [0, 1]) {
  for (const mode of ['smooth', 'corner']) {
    for (const shiftKey of [false, true]) {
      test(`${mode} handle ${side} drag ${shiftKey ? 'with Shift mirrors' : 'keeps opposite length'}`, () => {
        const { ctx, path, anchors } = setup('M 0 0 C 10 0 20 20 30 20 C 55 20 70 40 80 40');
        ctx.fern_selectAnchorOrdinals([1]);
        ctx.fern_setNodeMode(mode);
        const anchor = anchors()[1];
        const control = anchor.controls[side];
        const paired = anchor.controls[1 - side];
        const oldLength = Math.hypot(paired.x - anchor.x, paired.y - anchor.y);
        const refs = ctx.fern_getPointRefs(path);
        const handleIndex = refs.findIndex(r => r.role === 'control' && r.x === control.x && r.y === control.y);
        const handle = { dataset: { pointIndex: String(handleIndex), elementIndex: '0' } };
        Object.assign(ctx, {
          fernActiveSvg: { setPointerCapture() {} }, fernEditorMode: 'select-node',
          fernEditor: { querySelector: () => null }, fern_getSelectedElements: () => [path],
          fern_getCanvasPoint: e => ({ x: e.x, y: e.y }), fern_getElementPoint: e => ({ x: e.x, y: e.y }),
          fern_setCoordinateReadout() {}, fern_beginHistory() {},
          fernSpacePressed: false, fernDrawPathMode: false, fernPanState: null,
          fernMarqueeState: null, fernResizeState: null, fernPointDragState: null,
        });
        vm.runInContext(['fern_handlePointerDown', 'fern_handlePointerMove', 'fern_applyPointRef', 'fern_setPathPair'].map(extract).join('\n'), ctx);
        ctx.fern_handlePointerDown({ button: 0, shiftKey, pointerId: 1,
          x: control.x, y: control.y, stopPropagation() {}, preventDefault() {},
          target: { closest: selector => selector === '[data-point-index]' ? handle : null } });
        for (const [dx, dy] of [[12, 16], [0, 0], [-18, 24]]) {
          ctx.fern_handlePointerMove({ x: anchor.x + dx, y: anchor.y + dy });
          const updated = anchors()[1];
          const moved = updated.controls[side];
          const opposite = updated.controls[1 - side];
          assert.ok(Math.abs(moved.x - anchor.x - dx) < 0.001);
          assert.ok(Math.abs(moved.y - anchor.y - dy) < 0.001);
          const length = Math.hypot(opposite.x - anchor.x, opposite.y - anchor.y);
          assert.ok(Math.abs(length - (shiftKey ? Math.hypot(dx, dy) : oldLength)) < 0.001);
          if (mode === 'smooth' || shiftKey) {
            assert.ok(Math.abs(dx * (opposite.y - anchor.y) - dy * (opposite.x - anchor.x)) < 0.01);
            assert.ok(dx * (opposite.x - anchor.x) + dy * (opposite.y - anchor.y) <= 0);
          } else {
            assert.equal(opposite.x, paired.x);
            assert.equal(opposite.y, paired.y);
          }
          assert.equal(updated.pointMode, mode);
        }
      });
    }
  }
}

test('smooth nodes render both editable handles and both guide lines', () => {
  const { ctx, path, anchors } = setup('M 0 0 C 10 0 20 20 30 20 C 55 20 70 40 80 40');
  ctx.fern_selectAnchorOrdinals([1]);
  ctx.fern_setNodeMode('smooth');
  const makeElement = tagName => ({ tagName, attrs: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = v; }, append(child) { this.children.push(child); } });
  const svg = makeElement('svg');
  Object.assign(ctx, { fernActiveSvg: svg, FERN_SVG_NS: 'svg',
    fern_clearHandles() {}, fern_getSelectedElements: () => [path],
    fern_screenPixelsToElementUnits: (_, pixels) => pixels,
    fern_selectedSegmentPath: () => null, fern_elementPointToCanvas: (_, x, y) => ({x, y}),
    document: { createElementNS: (_, tagName) => makeElement(tagName) },
  });
  vm.runInContext(extract('fern_renderPointHandles'), ctx);
  ctx.fern_renderPointHandles();
  const rendered = svg.children[0].children;
  for (const control of anchors()[1].controls) {
    assert.ok(rendered.some(el => el.tagName === 'circle' && Number(el.attrs.cx) === control.x &&
      Number(el.attrs.cy) === control.y && el.attrs['data-point-index'] !== undefined));
    assert.ok(rendered.some(el => el.tagName === 'line' && Number(el.attrs.x1) === control.x && Number(el.attrs.y1) === control.y));
  }
});
