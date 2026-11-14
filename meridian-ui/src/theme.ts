export type Theme = "light" | "dark";

const THEME_KEY = "meridian.theme";

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** The saved choice, or the operating system preference when nothing is saved. */
export function getTheme(): Theme {
  return stored() ?? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

export function applyTheme(theme: Theme = getTheme()): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage unavailable: the choice still applies for this page load
  }
  applyTheme(theme);
}
