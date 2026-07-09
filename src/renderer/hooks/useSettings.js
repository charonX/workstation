import { useState, useEffect, useCallback } from "react";
import { getSettings, updateSettings as apiUpdateSettings } from "../api/settings.js";
import { changeLanguage } from "../i18n/index.js";

/**
 * Load settings, apply data-theme/data-density/lang to document,
 * return [settings, updateSettings, loading, error].
 */
export function useSettings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getSettings();
        if (cancelled) return;
        setSettings(data);
        applyToDocument(data);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const updateSettings = useCallback(async (partial) => {
    const updated = await apiUpdateSettings(partial);
    setSettings(updated);
    applyToDocument(updated);
    return updated;
  }, []);

  return [settings, updateSettings, loading, error];
}

function applyToDocument(data) {
  if (data.theme) {
    document.documentElement.setAttribute("data-theme", data.theme);
  }
  if (data.density) {
    document.documentElement.setAttribute("data-density", data.density);
  }
  if (data.language) {
    document.documentElement.setAttribute("lang", data.language);
    changeLanguage(data.language);
  }
}
