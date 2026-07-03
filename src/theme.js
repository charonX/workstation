// Temporary stub for test compilation.

export function toggleTheme(current) {
  return current === "dark" ? "light" : "dark";
}

export function applyTheme(theme, target) {
  // In a real browser environment this would mutate document.documentElement.
  // Stubbed for unit-test compilation.
  if (target && typeof target.setAttribute === "function") {
    target.setAttribute("data-theme", theme);
  }
  return theme;
}
