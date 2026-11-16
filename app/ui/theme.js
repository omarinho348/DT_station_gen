// Light/dark preference for the setup pages. The twin page is always dark.
// Saved in localStorage; the page still works when storage is blocked.
const KEY = 'twingen.theme';
export const THEMES = ['light', 'dark'];

export function normalizeTheme(value, fallback = 'light') {
  return THEMES.includes(value) ? value : fallback;
}

export function nextTheme(theme) {
  return theme === 'dark' ? 'light' : 'dark';
}

/** `override` (e.g. from ?theme=dark in the URL) wins and is not saved. */
export function loadTheme(override) {
  if (THEMES.includes(override)) return override;
  try {
    return normalizeTheme(localStorage.getItem(KEY));
  } catch {
    return 'light';
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(KEY, normalizeTheme(theme));
  } catch {
    /* storage blocked: the choice lasts for this visit only */
  }
}
