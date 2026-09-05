const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/fern-draw.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end);
}
function element(tagName) {
  return { tagName, children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, append(child) { this.children.push(child); }, contains(child) { return this.children.includes(child); }, closest() { return null; } };
}
test('text selection uses the same four square anchor handles as rectangles', () => {
  for (const tag of ['text', 'rect']) {
    const shape = element(tag);
    shape.getBBox = () => ({x: 0, y: 0, width: 100, height: 20});
    const svg = element('svg');
    const ctx = vm.createContext({
      fernActiveSvg: svg, fernEditorMode: 'select-node', fernSelectedElement: shape,
      fern_getSelectedElements: () => [shape], fern_clearHandles: () => {},
      fern_getTagName: el => el.tagName, fern_numericAttr: (_, attr) => ({x: 0, y: 0, width: 100, height: 20})[attr],
      fern_formatNumber: String, FERN_SVG_NS: 'svg', fernZoomLevel: 1,
      fernSelectedPointIndex: null, fernSelectedNodeIndices: new Set(),
      fern_selectedSegmentPath: () => null,
      fern_elementPointToCanvas: (_, x, y) => ({x, y}),
      document: { createElementNS: (_, name) => element(name) },
    });
    vm.runInContext(extract('fern_getPointRefs') + '\n' + extract('fern_renderPointHandles'), ctx);
    vm.runInContext('fern_renderPointHandles()', ctx);
    assert.equal(svg.children.length, 1);
    assert.equal(svg.children[0].children.length, 4);
    for (const handle of svg.children[0].children) {
      assert.equal(handle.tagName, 'rect');
      assert.equal(handle.attrs.class, 'svg-point-handle svg-point-anchor');
      assert.equal(handle.attrs.width, '8');
    }
  }
});
for (const tag of ['text', 'rect']) {
  test(`${tag}: first gesture selects, subsequent gesture starts shared drag`, () => {
    const shape = element(tag);
    const hit = tag === 'text' ? element('tspan') : shape;
    if (hit !== shape) shape.children.push(hit);
    let selected = [];
    const ctx = vm.createContext({
      fernActiveSvg: {setPointerCapture() {}}, fernEditorMode: 'select-node',
      fernSpacePressed: false, fernDrawPathMode: false, fernDragState: null,
      fern_getCanvasPoint: () => ({x: 10, y: 20}),
      fernEditor: {querySelector: () => null},
      fern_getSelectedElements: () => selected,
      fern_selectableTarget: () => shape,
      fern_selectElements: shapes => { selected = shapes; },
      fern_getOriginalAttrs: () => ({x: 0, y: 0}),
      event: {button: 0, target: hit, preventDefault() {}, pointerId: 1},
    });
    vm.runInContext(extract('fern_handlePointerDown'), ctx);
    vm.runInContext('fern_handlePointerDown(event)', ctx);
    assert.equal(selected[0], shape);
    assert.equal(ctx.fernDragState, null);
    vm.runInContext('fern_handlePointerDown(event)', ctx);
    assert.equal(ctx.fernDragState.elements[0], shape);
  });
}

test('alignment transitions preserve the text block left edge and shift every line together', () => {
  const offsets = {start: 0, middle: 60, end: 120};
  for (const from of Object.keys(offsets)) {
    for (const to of Object.keys(offsets)) {
      const text = element('text');
      text.attrs.x = 40 + offsets[from];
      const spans = [element('tspan'), element('tspan')];
      spans.forEach(span => { span.attrs.x = text.attrs.x; });
      text.querySelectorAll = () => spans;
      text.getBBox = () => ({x: Number(text.attrs.x) - offsets[to]});
      const ctx = vm.createContext({
        text,
        fern_numericAttr: (el, attr) => Number(el.attrs[attr]),
        fern_setNumericAttr: (el, attr, value) => { el.attrs[attr] = value; },
      });
      vm.runInContext(extract('fern_preserveTextLeftEdge'), ctx);
      vm.runInContext('fern_preserveTextLeftEdge(text, 40)', ctx);
      assert.equal(text.getBBox().x, 40);
      spans.forEach(span => assert.equal(span.attrs.x, text.attrs.x));
    }
  }
});
