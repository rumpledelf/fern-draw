const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../static/fern-draw.js'), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}
function setup(d) {
  const attrs = { d };
  const path = { tagName: 'path', getAttribute: k => attrs[k] || null,
    setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; } };
  const ctx = vm.createContext({ fernCanvasAction: null, fernSelectedElement: path, fernSelectedNodeIndices: new Set(),
    fernSelectedPointIndex: null, fern_snap: v => v, fern_setEditorStatus() {}, fern_renderPointHandles() {} });
  const names = ['fern_formatNumber', 'fern_getTagName', 'fern_nodeModeKey', 'fern_getNodeModeOverrides',
    'fern_setNodeModeOverride', 'fern_writePath', 'fern_setCanvasAction', 'fern_hasSmoothControlGeometry', 'fern_pathTokens', 'fern_serializePathTokens',
    'fern_absolutizePath', 'fern_getPathPointRefs', 'fern_getPointRefs', 'fern_refHasPosition',
    'fern_selectedAnchorRefs', 'fern_pathCommand', 'fern_selectAnchorOrdinals',
    'fern_convertAdjacentSegmentsToCurves', 'fern_setAbsolutePathPair', 'fern_setNodeMode', 'fern_setSelectedSegmentMode', 'fern_interpolate', 'fern_pointOnSegment', 'fern_closestPathSegment',
    'fern_addNodeToSegment', 'fern_pathSegments', 'fern_normalizedPath', 'fern_addSelectedSegmentNode', 'fern_selectPathSegment', 'fern_bendSegment', 'fern_dragPathSegment', 'fern_handlePointerDown'];
  vm.runInContext(names.map(extract).join('\n'), ctx);
  return { ctx, path, anchors: () => ctx.fern_getPointRefs(path).filter(ctx.fern_refHasPosition) };
}


module.exports = { extract, setup };
