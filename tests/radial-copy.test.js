const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/fern-draw.js'), 'utf8');
const start = source.indexOf('function fern_duplicateSelectedRadially(');
const code = source.slice(start, source.indexOf('\nfunction ', start + 1));

function run(grouped, count = '4') {
  const clones = [];
  const root = { appendChild: clone => clones.push(clone) };
  const parent = grouped ? { appendChild: clone => clones.push(clone) } : root;
  const shape = {
    parentElement: parent,
    cloneNode() {
      return {
        classList: { remove() {} },
        getAttribute: () => 'translate(3 7)',
        setAttribute(name, value) { this[name] = value; },
      };
    },
  };
  const matrix = {
    a: 2, b: 0, c: 0, d: 3, e: 10, f: 12,
    inverse: () => ({ a: 0.5, b: 0, c: 0, d: 1 / 3, e: -5, f: -4 }),
  };
  const context = vm.createContext({
    fern_getSelectedElements: () => [shape], fernActiveSvg: root,
    fernEditor: { querySelector: () => ({ value: count }) },
    fern_getViewBox: () => ({ cx: 50, cy: 60 }),
    fern_formatNumber: String, fern_formatTransformNumber: String,
    fern_elementToCanvasMatrix: () => matrix,
    fern_selectElements: elements => { context.selected = elements; },
    fern_commitHistory() {}, fern_autoSaveLocal() {},
    fern_setEditorStatus: status => { context.status = status; },
  });
  vm.runInContext(code + '\nfern_duplicateSelectedRadially();', context);
  return { clones, context };
}

test('radial copy retains the original and creates evenly spaced instances', () => {
  const { clones, context } = run(false);
  assert.equal(clones.length, 3);
  assert.equal(context.selected.length, 4);
  assert.deepEqual(clones.map(clone => clone.transform), [
    'rotate(90 50 60) translate(3 7)',
    'rotate(180 50 60) translate(3 7)',
    'rotate(270 50 60) translate(3 7)',
  ]);
  assert.equal(context.status, 'Created 3 copies around the canvas center.');
});

test('radial copy converts transformed group coordinates to canvas and back', () => {
  const { clones } = run(true);
  assert.equal(clones[0].transform,
    'matrix(0.5 0 0 0.3333333333333333 -5 -4) rotate(90 50 60) matrix(2 0 0 3 10 12) translate(3 7)');
});

test('radial copy limits the total instance count', () => {
  assert.equal(run(false, '100').clones.length, 63);
  assert.equal(run(false, '1').clones.length, 1);
});
