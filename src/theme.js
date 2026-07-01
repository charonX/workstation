// Temporary stub for test compilation.

export function toggleTheme(current) {
  return current === "dark" ? "light" : "dark";
}

export function applyTheme(theme) {
  // In a real browser environment this would mutate document.documentElement.
  // Stubbed for unit-test compilation.
  return theme;
}
