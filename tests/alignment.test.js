const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/fern-draw.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function fern_planArrangement('), source.indexOf('\nfunction fern_arrangementSelection(')), context);
const plan = context.fern_planArrangement;
const boxes = [{ x: 10, y: 20, width: 10, height: 20 }, { x: 45, y: 60, width: 20, height: 10 }, { x: 100, y: 110, width: 30, height: 30 }];

for (const [mode, axis, size, fraction, target] of [
  ['left', 'x', 'width', 0, 10], ['center-x', 'x', 'width', 0.5, 70], ['right', 'x', 'width', 1, 130],
  ['top', 'y', 'height', 0, 20], ['center-y', 'y', 'height', 0.5, 80], ['bottom', 'y', 'height', 1, 140],
]) {
  test(`${mode} aligns selection bounds and leaves the other axis alone`, () => {
    const { moves } = plan(boxes, mode);
    boxes.forEach((box, i) => {
      assert.equal(box[axis] + moves[i][axis === 'x' ? 'dx' : 'dy'] + box[size] * fraction, target);
      assert.equal(moves[i][axis === 'x' ? 'dy' : 'dx'], 0);
    });
  });
}

for (const axis of ['x', 'y']) {
  test(`${axis} distribution equalizes edge gaps and preserves the outer bounds`, () => {
    const size = axis === 'x' ? 'width' : 'height';
    const delta = axis === 'x' ? 'dx' : 'dy';
    const { moves, gap } = plan(boxes, 'distribute', axis);
    assert.equal(moves[0][delta], 0);
    assert.equal(moves[2][delta], 0);
    for (let i = 1; i < boxes.length; i++) {
      assert.equal(boxes[i][axis] + moves[i][delta] - boxes[i - 1][axis] - moves[i - 1][delta] - boxes[i - 1][size], gap);
    }
  });
  test(`${axis} manual gaps expand and contract equally at both ends`, () => {
    const shuffled = [boxes[2], boxes[0], boxes[1]];
    for (const gap of [-5, 0, 12, 60]) {
      const { moves } = plan(shuffled, 'distribute', axis, gap);
      const delta = axis === 'x' ? 'dx' : 'dy';
      const size = axis === 'x' ? 'width' : 'height';
      assert.equal(moves[1][delta], -moves[0][delta]);
      assert.equal(shuffled[2][axis] + moves[2][delta], boxes[0][axis] + moves[1][delta] + boxes[0][size] + gap);
      const oldCenter = (boxes[0][axis] + boxes[2][axis] + boxes[2][size]) / 2;
      const newCenter = (boxes[0][axis] + moves[1][delta] + boxes[2][axis] + moves[0][delta] + boxes[2][size]) / 2;
      assert.equal(newCenter, oldCenter);
    }
  });
}

test('node distribution uses point distances', () => {
  const nodes = [{ x: 10, y: 0, width: 0, height: 0 }, { x: 17, y: 5, width: 0, height: 0 }, { x: 90, y: 8, width: 0, height: 0 }];
  const { moves, gap } = plan(nodes, 'distribute', 'x');
  assert.equal(gap, 40);
  assert.equal(nodes[1].x + moves[1].dx, 50);
});

test('manual node gaps move both endpoints while preserving their center', () => {
  const nodes = [{ x: 10, y: 0, width: 0, height: 0 }, { x: 17, y: 5, width: 0, height: 0 }, { x: 90, y: 8, width: 0, height: 0 }];
  for (const gap of [0, 20, 60]) {
    const { moves } = plan(nodes, 'distribute', 'x', gap);
    assert.equal(nodes[0].x + moves[0].dx, 50 - gap);
    assert.equal(nodes[1].x + moves[1].dx, 50);
    assert.equal(nodes[2].x + moves[2].dx, 50 + gap);
  }
});

test('focused gap fields use drawing undo/redo, leaving other input editing alone', () => {
  const calls = [];
  const ctx = vm.createContext({ fern_undo: () => calls.push('undo'), fern_redo: () => calls.push('redo') });
  const start = source.indexOf('function fern_handleGapHistoryShortcut(');
  vm.runInContext(source.slice(start, source.indexOf('\nfunction ', start + 1)), ctx);
  for (const modifier of ['metaKey', 'ctrlKey']) {
    for (const [key, shiftKey, action] of [['z', false, 'undo'], ['Z', true, 'redo'], ['y', false, 'redo']]) {
      let prevented = false;
      const handled = ctx.fern_handleGapHistoryShortcut({
        target: { matches: selector => selector === '[data-distribute-gap]' },
        key, shiftKey, [modifier]: true, preventDefault: () => { prevented = true; },
      });
      assert.equal(handled, true);
      assert.equal(prevented, true);
      assert.equal(calls.pop(), action);
    }
  }
  assert.equal(ctx.fern_handleGapHistoryShortcut({ target: { matches: () => false }, key: 'z', metaKey: true }), false);
  assert.equal(ctx.fern_handleGapHistoryShortcut({ target: { matches: () => true }, key: 'ArrowUp' }), false);
});
