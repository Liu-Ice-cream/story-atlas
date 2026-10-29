// Apply before styles paint; a blocked or damaged local preference is harmless.
(() => {
  let theme = 'maple';
  try { const saved = localStorage.getItem('story-atlas:theme:v1'); if (['maple', 'snow', 'sword'].includes(saved)) theme = saved; } catch {}
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'sword' ? 'dark' : 'light';
})();
