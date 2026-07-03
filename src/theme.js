export function toggleTheme(current) {
  return current === "dark" ? "light" : "dark";
}

export function applyTheme(theme, target) {
  const element = target || (typeof document !== "undefined" ? document.documentElement : undefined);
  if (element && typeof element.setAttribute === "function") {
    element.setAttribute("data-theme", theme);
  }
  return theme;
}
