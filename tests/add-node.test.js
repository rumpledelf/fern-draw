const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { extract, setup } = require('./helpers/draw');

for (const d of ['M 0 0 L 100 0 L 100 100', 'm 0 0 h 100 v 100', 'M 0 0 C 30 0 70 0 100 0 L 100 100']) {
  test(`Add Node inserts a selected midpoint immediately: ${d}`, () => {
    const { ctx, path, anchors } = setup(d);
    anchors().forEach(ref => ctx.fern_setNodeModeOverride(path, ref, 'smooth'));
    ctx.fern_selectAnchorOrdinals([0, 1]);
    let history = 0, renders = 0;
    Object.assign(ctx, {
      fernActiveSvg: {}, fernEditorMode: 'select-node',
      fern_setEditorMode: mode => { ctx.fernEditorMode = mode; ctx.fernSelectedNodeIndices.clear(); },
      fern_selectElements: elements => { ctx.fernSelectedElement = elements[0]; },
      fern_beginHistory() { history++; }, fern_commitHistory() {}, fern_renderPointHandles() { renders++; },
    });
    ctx.fern_addSelectedSegmentNode();
    assert.equal(anchors().length, 4);
    assert.equal(anchors()[1].x, 50);
    assert.equal(anchors()[1].y, 0);
    for (const index of [0, 2, 3]) assert.equal(anchors()[index].pointMode, 'smooth');
    assert.equal(ctx.fern_selectedAnchorRefs()[0].x, 50);
    assert.equal(ctx.fernCanvasAction, null);
    assert.equal(history, 1);
    assert.equal(renders, 1);
  });
}
test('splitting a cubic keeps its geometry across both new segments', () => {
  const { ctx, path, anchors } = setup('M 0 0 C 0 100 100 100 100 0');
  const original = ctx.fern_closestPathSegment(path, {x: 50, y: 75});
  ctx.fern_addNodeToSegment(original, 0.5);
  assert.equal(anchors().length, 3);
  const nodes = anchors();
  for (let step = 0; step <= 20; step++) {
    const t = step / 20;
    const end = nodes[t <= 0.5 ? 1 : 2];
    const segment = {start: nodes[t <= 0.5 ? 0 : 1], end, tokens: end.tokens.slice(end.segmentStart, end.segmentEnd)};
    const actual = ctx.fern_pointOnSegment(segment, t <= 0.5 ? t * 2 : (t - 0.5) * 2);
    const expected = ctx.fern_pointOnSegment(original, t);
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.001);
  }
});
test('insertion finds the closing edge of each subpath', () => {
  const { ctx, path, anchors } = setup('M 0 0 L 100 0 L 100 100 Z M 200 0 L 300 0 L 300 100 Z');
  const segment = ctx.fern_closestPathSegment(path, {x: 50, y: 50});
  assert.equal(segment.closing, true);
  ctx.fern_addNodeToSegment(segment, 0.5);
  assert.equal(anchors().length, 7);
  assert.equal(anchors()[3].x, 50);
  assert.equal(anchors()[3].y, 50);
  assert.equal(ctx.fern_selectedAnchorRefs()[0].x, 50);
});

test('long line clicks between coarse samples still land exactly on the line', () => {
  const { ctx, path } = setup('M 0 0 L 10000 0');
  const segment = ctx.fern_closestPathSegment(path, {x: 5078.125, y: 0});
  assert.equal(segment.distance, 0);
  assert.equal(segment.t, 0.5078125);
});

for (const d of ['M 0 0 C 0 100 100 100 100 0', 'M 0 0 Q 50 100 100 0']) {
  test(`dragging a curve moves the grabbed point and fixes its endpoints: ${d}`, () => {
    const { ctx, path } = setup(d);
    const segment = ctx.fern_pathSegments(ctx.fern_getPointRefs(path))[0];
    for (const t of [0.2, 0.5, 0.8]) {
      segment.t = t;
      const before = ctx.fern_pointOnSegment(segment, t);
      const bent = {...segment, tokens: ctx.fern_bendSegment(segment, 12, -18)};
      const after = ctx.fern_pointOnSegment(bent, t);
      assert.ok(Math.abs(after.x - before.x - 12) < 0.0001);
      assert.ok(Math.abs(after.y - before.y + 18) < 0.0001);
      assert.deepEqual(ctx.fern_pointOnSegment(bent, 0), ctx.fern_pointOnSegment(segment, 0));
      assert.deepEqual(ctx.fern_pointOnSegment(bent, 1), ctx.fern_pointOnSegment(segment, 1));
    }
  });
}
