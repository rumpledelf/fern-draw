// Start fern-landing locally, then run with Playwright available to Node:
// node tests/browser/drawing-workflow.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.DRAW_BROWSER || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.DRAW_TEST_URL || 'http://127.0.0.1:8000/tools/draw/');
    await page.waitForFunction(() => typeof fernActiveSvg !== 'undefined' && fernActiveSvg);
    const action = name => page.locator(`[data-node-action="${name}"]`).click();
    const state = () => page.evaluate(() => {
      const refs = fernSelectedElement ? fern_getPointRefs(fernSelectedElement) : [];
      return {
        action: fernCanvasAction, mode: fernEditorMode, d: fernSelectedElement?.getAttribute('d'),
        nodes: refs.filter(fern_refHasPosition).map(ref => ({x: ref.x, y: ref.y, mode: ref.pointMode})),
        selected: [...fernSelectedNodeIndices],
        activeHandles: fernActiveSvg.querySelectorAll('[data-point-index].is-active-point').length,
      };
    });
    const selectNodes = async ordinals => {
      for (let i = 0; i < ordinals.length; i++) {
        const index = await page.evaluate(ordinal => {
          const refs = fern_getPointRefs(fernSelectedElement);
          return refs.indexOf(refs.filter(fern_refHasPosition)[ordinal]);
        }, ordinals[i]);
        await page.locator(`[data-editor-handles] [data-point-index="${index}"]`).click({modifiers: i ? ['Shift'] : []});
      }
    };
    const points = await page.evaluate(() => {
      const v = fern_getViewBox(), m = fernActiveSvg.getScreenCTM();
      return [[.2,.2],[.8,.2],[.8,.8]].map(([x,y]) => new DOMPoint(v.x+x*v.width,v.y+y*v.height).matrixTransform(m)).map(p => ({x:p.x,y:p.y}));
    });
    await page.locator('[data-add="path"]').click();
    await page.mouse.click(points[0].x, points[0].y);
    await page.mouse.click(points[1].x, points[1].y);
    // Temporary pan must not add vertices or abandon the drawing.
    await page.keyboard.down('Space');
    await page.mouse.click(points[1].x, points[1].y);
    await page.keyboard.up('Space');
    assert.equal(await page.evaluate(() => fernPathBuildingPoints.length), 2);
    await page.mouse.dblclick(points[2].x, points[2].y);
    let current = await state();
    assert.equal(current.nodes.length, 3);
    assert.ok(current.d.endsWith('Z'));
    assert.equal(current.mode, 'select-node');
    assert.equal(current.action, null);
    const original = current.d;

    await page.mouse.click(points[0].x + (points[1].x - points[0].x) / 4, points[0].y);
    await action('add');
    current = await state();
    assert.equal(current.nodes.length, 4);
    assert.deepEqual(current.nodes[1], {x: 50, y: 20, mode: 'corner'});
    assert.equal(current.activeHandles, 1);
    assert.equal(current.action, null);
    const inserted = current.d;
    await page.locator('button[data-action="fern_undo"]').click();
    assert.equal((await state()).d, original);
    await page.locator('button[data-action="fern_redo"]').click();
    assert.equal((await state()).d, inserted);

    await selectNodes([1,2]);
    await action('remove-line');
    current = await state();
    assert.equal(current.nodes.length, 4);
    assert.ok(!current.d.endsWith('Z'));
    assert.equal(current.selected.length, 2);
    await action('add-line');
    assert.ok((await state()).d.endsWith('Z'));
    await action('smooth');
    current = await state();
    assert.equal(current.nodes.filter(node => node.mode === 'smooth').length, 2);
    // Grab the curve itself, away from its node and control handles.
    const curve = await page.evaluate(() => {
      const refs = fern_getPointRefs(fernSelectedElement);
      const segment = fern_pathSegments(refs).find(segment => segment.tokens[0].value === "C");
      const p = fern_pointOnSegment(segment, .4);
      const screen = new DOMPoint(p.x,p.y).matrixTransform(fernSelectedElement.getScreenCTM());
      return {x:screen.x,y:screen.y,nodes:refs.filter(fern_refHasPosition).map(ref => [ref.x,ref.y]),d:fernSelectedElement.getAttribute('d')};
    });
    await page.mouse.move(curve.x,curve.y);
    await page.mouse.down();
    await page.mouse.move(curve.x+18,curve.y+22,{steps:4});
    await page.mouse.up();
    current = await state();
    assert.notEqual(current.d,curve.d);
    assert.deepEqual(current.nodes.map(node => [node.x,node.y]),curve.nodes);
    assert.equal(current.nodes.filter(node => node.mode === 'smooth').length,2);
    await page.locator('button[data-action="fern_undo"]').click();
    assert.equal((await state()).d,curve.d);
    await page.locator('button[data-action="fern_redo"]').click();
    // Drag one real smooth handle and preserve the length of the other.
    const handles = await page.evaluate(() => {
      const refs = fern_getPointRefs(fernSelectedElement);
      const anchor = refs.filter(fern_refHasPosition).find(ref => ref.pointMode === 'smooth' && ref.controls.length === 2);
      const [first, second] = anchor.controls;
      const screen = new DOMPoint(first.x, first.y).matrixTransform(fernSelectedElement.getScreenCTM());
      return {x: screen.x, y: screen.y, ax: anchor.x, ay: anchor.y, otherLength: Math.hypot(second.x-anchor.x,second.y-anchor.y)};
    });
    await page.mouse.move(handles.x, handles.y);
    await page.mouse.down();
    await page.mouse.move(handles.x + 12, handles.y + 8, {steps: 4});
    await page.mouse.up();
    const geometry = await page.evaluate(({ax,ay}) => {
      const anchor = fern_getPointRefs(fernSelectedElement).filter(fern_refHasPosition).find(ref => ref.x === ax && ref.y === ay);
      return {length: Math.hypot(anchor.controls[1].x-ax, anchor.controls[1].y-ay), smooth: fern_hasSmoothControlGeometry(anchor)};
    }, handles);
    assert.ok(Math.abs(geometry.length - handles.otherLength) < 0.001);
    assert.ok(geometry.smooth);
    assert.deepEqual(errors, []);
    console.log('Browser workflow passed: draw, temporary pan, midpoint insertion, immediate selection, undo/redo, immediate toolbar insertion, line removal/joining, direct curve dragging, and asymmetric smooth-handle drag.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
