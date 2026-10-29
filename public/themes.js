export const THEME_KEY = 'story-atlas:theme:v1';
export const themes = Object.freeze({
  maple: { name: '枫庭', description: '枫红与纸白', surface: '#f8f6f1', art: '/assets/themes/maple.webp' },
  snow: { name: '听雪', description: '雪白与青灰', surface: '#f6f8f7', art: '/assets/themes/snow.webp' },
  sword: { name: '剑影', description: '墨色与银青', surface: '#202829', art: '/assets/themes/sword.webp' }
});
export const normalizeTheme = value => Object.hasOwn(themes, value) ? value : 'maple';
export const currentTheme = () => normalizeTheme(document.documentElement.dataset.theme);
export function themeSwitcher() {
  const active = currentTheme();
  return `<div class="theme-switcher" role="group" aria-label="界面主题">${Object.entries(themes).map(([id, theme]) => `<button type="button" data-theme-choice="${id}" aria-pressed="${id === active}" title="${theme.description}">${theme.name}</button>`).join('')}</div>`;
}
export function themeArtwork(className = '') {
  return `<img class="${className}" data-theme-art src="${themes[currentTheme()].art}" alt="" aria-hidden="true" draggable="false"/>`;
}
export function initializeThemes(onChange = () => {}) {
  const apply = value => {
    const id = normalizeTheme(value), theme = themes[id];
    document.documentElement.dataset.theme = id;
    document.documentElement.style.colorScheme = id === 'sword' ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.surface);
    for (const button of document.querySelectorAll('[data-theme-choice]')) button.setAttribute('aria-pressed', String(button.dataset.themeChoice === id));
    for (const image of document.querySelectorAll('[data-theme-art]')) image.src = theme.art;
    return id;
  };
  apply(currentTheme());
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-theme-choice]'); if (!button) return;
    const id = apply(button.dataset.themeChoice); let persisted = true;
    try { localStorage.setItem(THEME_KEY, id); } catch { persisted = false; }
    onChange(id, persisted);
  });
  window.addEventListener('storage', event => { if (event.key === THEME_KEY) apply(event.newValue); });
}
