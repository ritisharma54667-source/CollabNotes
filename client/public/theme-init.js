// Applies the saved theme before first paint (an external file, so it works under a strict CSP).
try {
  var t = localStorage.getItem('collab-notes:theme');
  if (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) t = 'light';
  if (t) document.documentElement.dataset.theme = t;
} catch (e) {}
