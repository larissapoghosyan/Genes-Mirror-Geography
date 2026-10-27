// Original, externally authored assets. Load before they enter the story.
window.BIOLOGY_ART = {};
(() => {
  if (typeof Image === 'undefined') return;
  const root = 'https://raw.githubusercontent.com/duerrsimon/bioicons/main/static/icons/cc-by-3.0/Intracellular_components/Servier/';
  for (const [key, file] of [['cell','cell-complete.svg'], ['nucleus','nucleus-closeup.svg']]) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { if(img.naturalWidth&&img.naturalHeight)window.BIOLOGY_ART[key] = img; };
    img.src = root + file;
  }
})();
