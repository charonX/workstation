import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../hooks/useNotifications.js";

function getFilterKeys(t) {
  return [
    { key: "all", label: t("notifications.filterAll") },
    { key: "artifact", label: t("notifications.filterArtifact") },
    { key: "execution-failed", label: t("notifications.filterExecutionFailed") },
    { key: "channel-status", label: t("notifications.filterChannelStatus") },
  ];
}

function formatTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dotClass(type) {
  if (type === "artifact") return "success";
  if (type === "execution-failed") return "error";
  return "warning";
}

function NotificationItem({ notification, onClick, onMarkRead }) {
  const { t } = useTranslation();
  const clickable = notification.type === "artifact";
  const unread = !notification.readAt;

  return (
    <div
      className={`ntf-item${unread ? " unread" : ""}${clickable ? " clickable" : ""}`}
      data-testid="notification-item"
      data-read={String(!unread)}
      data-clickable={String(clickable)}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={() => onClick(notification)}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick(notification);
        }
      }}
    >
      <span className={`ntf-dot ${dotClass(notification.type)}`} />
      <div className="ntf-main">
        <div className="ntf-title-row">
          <span className="ntf-title" data-testid="notification-title">
            {notification.title}
          </span>
          {unread && <span className="ntf-unread-pill">{t("notifications.unread")}</span>}
          <span className="ntf-time">{formatTime(notification.createdAt)}</span>
        </div>
        <div className="ntf-summary">{notification.body}</div>
        <div className="ntf-meta">
          {notification.executionId && (
            <span className="ntf-exec">关联执行 {notification.executionId}</span>
          )}
          {clickable && <span className="ntf-goto">{t("notifications.viewExecution")}</span>}
        </div>
      </div>
      <div className="ntf-actions">
        {unread && (
          <button
            type="button"
            className="mark-read-btn"
            onClick={(e) => onMarkRead(e, notification.id)}
          >
            {t("notifications.markRead")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Notifications() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, loading, error, , markRead, markAllRead] = useNotifications();
  const [filter, setFilter] = useState("all");
  const FILTER_KEYS = useMemo(() => getFilterKeys(t), [t]);

  const filteredNotifications = useMemo(() => {
    if (filter === "all") return state.notifications;
    return state.notifications.filter((n) => n.type === filter);
  }, [state.notifications, filter]);

  const counts = useMemo(() => {
    const all = state.notifications.length;
    const artifact = state.notifications.filter((n) => n.type === "artifact").length;
    const executionFailed = state.notifications.filter((n) => n.type === "execution-failed").length;
    const channelStatus = state.notifications.filter((n) => n.type === "channel-status").length;
    return { all, artifact, "execution-failed": executionFailed, "channel-status": channelStatus };
  }, [state.notifications]);

  const handleMarkRead = useCallback(
    async (e, id) => {
      e.stopPropagation();
      await markRead(id);
    },
    [markRead]
  );

  const handleItemClick = useCallback(
    (n) => {
      if (n.type !== "artifact") return;
      navigate(n.executionId ? `/executions?highlight=${n.executionId}` : "/executions");
    },
    [navigate]
  );

  return (
    <div className="page page-notifications" data-testid="notifications-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("notifications.title")}</h1>
          <p className="page-subtitle">{t("notifications.subtitle")}</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={markAllRead}
          disabled={state.unreadCount === 0}
        >
          {t("notifications.markAllRead")}
        </button>
      </div>

      {loading && <p className="loading-text">{t("common.loading")}</p>}
      {error && (
        <p className="loading-text" style={{ color: "var(--ch-error)" }}>
          {error}
        </p>
      )}
      {!loading && !error && (
        <>
          <div className="tabs" role="tablist">
            {FILTER_KEYS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={`tab${filter === f.key ? " active" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="tab-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          <div className="ntf-list" data-testid="notification-list">
            {filteredNotifications.length === 0 ? (
              <div className="list-empty">{t("notifications.empty")}</div>
            ) : (
              filteredNotifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onClick={handleItemClick}
                  onMarkRead={handleMarkRead}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
