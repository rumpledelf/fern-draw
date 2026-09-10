const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../static/fern-draw.js'), 'utf8');
const start = source.indexOf('function fern_ensureDefs(');
const end = source.indexOf('\nfunction fern_setLinearGradient(', start);

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.parent = null;
  }
  get id() { return this.getAttribute('id') || ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  removeAttribute(name) { this.attributes.delete(name); }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
  }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const descendants = this.descendants();
    if (selector === '[filter]') return descendants.filter(child => child.hasAttribute('filter'));
    return descendants.filter(child => child.tagName === selector);
  }
}

function setup() {
  const svg = new Element('svg');
  const context = vm.createContext({
    fernActiveSvg: svg,
    FERN_SVG_NS: 'http://www.w3.org/2000/svg',
    fern_formatNumber: String,
    document: { createElementNS: (_namespace, tagName) => new Element(tagName) },
    Date: { now: () => 1234 },
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, svg };
}

test('blur round-trips through a standard SVG Gaussian filter and zero removes it', () => {
  const { context, svg } = setup();
  const shape = svg.appendChild(new Element('rect'));

  context.fern_setBlurAmount(shape, 4.5);
  assert.equal(context.fern_getBlurAmount(shape), 4.5);
  assert.match(shape.getAttribute('filter'), /^url\(#fern_blur_/);
  assert.equal(svg.querySelector('feGaussianBlur').getAttribute('stdDeviation'), '4.5');

  context.fern_setBlurAmount(shape, 0);
  assert.equal(shape.getAttribute('filter'), null);
  assert.equal(svg.querySelector('filter'), null);
});

test('editing a duplicated shape does not change a blur filter still used by the original', () => {
  const { context, svg } = setup();
  const original = svg.appendChild(new Element('rect'));
  const duplicate = svg.appendChild(new Element('rect'));

  context.fern_setBlurAmount(original, 3);
  const sharedReference = original.getAttribute('filter');
  duplicate.setAttribute('filter', sharedReference);
  context.fern_setBlurAmount(duplicate, 8);

  assert.equal(context.fern_getBlurAmount(original), 3);
  assert.equal(context.fern_getBlurAmount(duplicate), 8);
  assert.notEqual(duplicate.getAttribute('filter'), sharedReference);
  assert.equal(svg.querySelectorAll('filter').length, 2);
});
