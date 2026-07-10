import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getSettings, updateSettings as apiUpdateSettings } from "../api/settings.js";
import { changeLanguage } from "../i18n/index.js";

const SettingsContext = createContext(null);

/**
 * Provide a single, shared settings state for the renderer process.
 *
 * A context is used so that every consumer (App, TopBar, Settings page, etc.)
 * reads and writes the same state. This avoids races where independent
 * useSettings() hooks load or apply settings at different times.
 */
export function SettingsProvider({ children }) {
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
    applyToDocument(updated, settings?.language);
    return updated;
  }, [settings?.language]);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, loading, error }}>
      {children}
    </SettingsContext.Provider>
  );
}

function applyToDocument(data, previousLanguage) {
  const theme = data.theme || "dark";
  document.documentElement.setAttribute("data-theme", theme);
  const density = data.density || "comfortable";
  document.documentElement.setAttribute("data-density", density);
  const language = data.language || "en-US";
  if (language !== previousLanguage) {
    document.documentElement.setAttribute("lang", language);
    changeLanguage(language);
  }
}

/**
 * Load settings, apply data-theme/data-density/lang to document,
 * return [settings, updateSettings, loading, error].
 */
export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return [ctx.settings, ctx.updateSettings, ctx.loading, ctx.error];
}
