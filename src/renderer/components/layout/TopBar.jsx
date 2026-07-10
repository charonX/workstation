import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings.js";

function IconButton({ label, onClick, children, testid }) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      onClick={onClick}
      data-testid={testid}
    >
      {children}
    </button>
  );
}

export default function TopBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [settings, updateSettings] = useSettings();
  const [searchQuery, setSearchQuery] = useState("");

  const theme = settings?.theme || "dark";
  const language = settings?.language || "en-US";

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    updateSettings({ theme: next });
  }

  function toggleLanguage() {
    const next = language === "en-US" ? "zh-CN" : "en-US";
    updateSettings({ language: next });
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    // Global search routes to workspace page with the query applied.
    navigate(`/workspace?q=${encodeURIComponent(searchQuery.trim())}`);
  }

  return (
    <header className="topbar" data-testid="topbar">
      <div className="topbar-left">
        <div className="topbar-logo" data-testid="topbar-logo">
          OPC Workstation
        </div>
        <form className="topbar-search-form" onSubmit={handleSearchSubmit}>
          <input
            type="search"
            className="topbar-search-input"
            placeholder={t("topBar.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="topbar-search-input"
            aria-label={t("topBar.searchPlaceholder")}
          />
        </form>
      </div>
      <div className="topbar-right">
        <IconButton
          label={language === "en-US" ? t("settings.chinese") : t("settings.english")}
          onClick={toggleLanguage}
          testid="topbar-language-button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </IconButton>
        <IconButton
          label={theme === "dark" ? t("topBar.switchToLight") : t("topBar.switchToDark")}
          onClick={toggleTheme}
          testid="topbar-theme-button"
        >
          {theme === "dark" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </IconButton>
        <IconButton
          label={t("topBar.notifications")}
          onClick={() => { /* notifications panel placeholder */ }}
          testid="topbar-notifications-button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </IconButton>
        <IconButton
          label={t("topBar.openSettings")}
          onClick={() => navigate("/settings")}
          testid="topbar-settings-button"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </IconButton>
      </div>
    </header>
  );
}
