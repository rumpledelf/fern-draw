// Only fixed, same-origin tool destinations are accepted for this round trip.
(() => {
  const query = new URLSearchParams(window.location.search);
  const project = query.get('project');
  const link = document.getElementById('return-to-inspire');
  if (query.get('return_to') !== 'inspire' || !project || !query.get('asset') || !link) return;
  link.href = `/tools/inspire/?project=${encodeURIComponent(project)}`;
  link.title = 'Save to account in Draw before returning to use your edits';
  link.hidden = false;
  link.style.removeProperty('display');
})();
