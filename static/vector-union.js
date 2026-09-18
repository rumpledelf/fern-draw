// Geometry only: keep the same helper in Draw and the artwork exporter.
const vectorUnion = (() => {
  const scope = new paper.PaperScope();
  function run(callback) {
    scope.activate();
    const project = new scope.Project();
    try { return callback(scope); } finally { project.remove(); }
  }
  function unite(paths) {
    return paths.reduce((result, path) => result ? result.unite(path, { insert: false }) : path);
  }
  function connectedRegions(p, shapes) {
    const groups = [];
    for (const shape of shapes) {
      let merged = new p.CompoundPath({ pathData: shape.path, insert: false });
      const members = [shape];
      for (let i = groups.length - 1; i >= 0; i--) {
        const other = groups[i];
        const intersection = merged.intersect(other.path, { insert: false });
        if (Math.abs(intersection.area) > .00001) {
          merged = unite([merged, other.path]);
          members.push(...other.members);
          groups.splice(i, 1);
        }
      }
      groups.push({ path: merged, members });
    }
    return groups;
  }
  return { run, unite, connectedRegions };
})();
