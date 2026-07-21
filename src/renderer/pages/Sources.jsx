import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useContentSources } from "../hooks/useContentSources.js";
import Modal from "../components/shared/Modal.jsx";
import ConfirmDialog from "../components/shared/ConfirmDialog.jsx";

const TYPE_META = {
  webpage: {
    label: "网页",
    badgeClass: "badge-webpage",
    configLabel: "页面 URL",
    placeholder: "https://example.com/page",
    help: "抓取该网页正文并转为 Markdown。",
    kind: "url",
    desc: "单页抓取",
  },
  rss: {
    label: "RSS",
    badgeClass: "badge-rss",
    configLabel: "Feed URL",
    placeholder: "https://example.com/feed.xml",
    help: "订阅 RSS / Atom 源的最新条目。",
    kind: "url",
    desc: "订阅源",
  },
  x: {
    label: "X",
    badgeClass: "badge-x",
    configLabel: "X 账号",
    placeholder: "@username",
    help: "尽力抓取该账号时间线，质量不保障。",
    kind: "account",
    desc: "账号时间线",
  },
  wechat: {
    label: "公众号",
    badgeClass: "badge-wechat",
    configLabel: "公众号标识",
    placeholder: "@公众号名称或 ID",
    help: "尽力抓取公众号推文，质量不保障。",
    kind: "account",
    desc: "公众号推文",
  },
};

const TYPE_ORDER = ["webpage", "rss", "x", "wechat"];

function isValidHttpUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatConfigSummary(config) {
  return config || "—";
}

export default function Sources() {
  const { t } = useTranslation();
  const [sources, loading, error, refresh, create, update, toggle, remove] =
    useContentSources();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [selectedType, setSelectedType] = useState("webpage");
  const [name, setName] = useState("");
  const [config, setConfig] = useState("");
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const [deleteSource, setDeleteSource] = useState(null);

  const nameInputRef = useRef(null);
  const tagInputRef = useRef(null);

  const resetForm = useCallback(() => {
    setEditingSource(null);
    setSelectedType("webpage");
    setName("");
    setConfig("");
    setTags([]);
    setTagInput("");
    setFieldErrors({});
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setIsFormOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((source) => {
    setEditingSource(source);
    setSelectedType(source.type);
    setName(source.name);
    setConfig(source.config);
    setTags(source.tags || []);
    setTagInput("");
    setFieldErrors({});
    setIsFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
  }, []);

  useEffect(() => {
    if (isFormOpen && nameInputRef.current) {
      const timer = setTimeout(() => nameInputRef.current.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isFormOpen]);

  function addTag() {
    const value = tagInput.trim();
    if (!value) return;

    setFieldErrors((prev) => ({ ...prev, tags: "" }));

    if (value.length > 16) {
      setFieldErrors((prev) => ({
        ...prev,
        tags: t("sources.tagTooLong"),
      }));
      return;
    }

    if (tags.includes(value)) {
      setFieldErrors((prev) => ({
        ...prev,
        tags: t("sources.tagDuplicate"),
      }));
      if (tagInputRef.current) tagInputRef.current.select();
      return;
    }

    setTags((prev) => [...prev, value]);
    setTagInput("");
    if (tagInputRef.current) tagInputRef.current.focus();
  }

  function removeTag(index) {
    setTags((prev) => prev.filter((_, i) => i !== index));
  }

  function handleTagKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      addTag();
    }
  }

  function validate() {
    const errors = {};
    const trimmedName = name.trim();
    const trimmedConfig = config.trim();
    const meta = TYPE_META[selectedType];

    if (!trimmedName || trimmedName.length > 64) {
      errors.name = t("sources.nameError");
    }

    if (tags.length === 0) {
      errors.tags = t("sources.tagsRequired");
    }

    if (meta.kind === "url") {
      if (!isValidHttpUrl(trimmedConfig)) {
        errors.config = t("sources.urlRequired");
      }
    } else if (!trimmedConfig) {
      errors.config = t("sources.accountRequired");
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        type: selectedType,
        tags,
        config: config.trim(),
      };

      if (editingSource) {
        await update(editingSource.id, body);
      } else {
        await create(body);
      }
      setIsFormOpen(false);
      resetForm();
    } catch (err) {
      const message = err.message || "";
      if (message.includes("已存在")) {
        setFieldErrors((prev) => ({ ...prev, name: message }));
      } else if (
        message.includes("名称") ||
        message.includes("URL") ||
        message.includes("账号")
      ) {
        // Map backend validation to the matching field when possible.
        if (message.includes("名称")) {
          setFieldErrors((prev) => ({ ...prev, name: message }));
        } else if (message.includes("URL") || message.includes("账号")) {
          setFieldErrors((prev) => ({ ...prev, config: message }));
        }
      } else {
        setFieldErrors((prev) => ({ ...prev, general: message }));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(source) {
    await toggle(source.id);
  }

  async function handleConfirmDelete() {
    if (!deleteSource) return;
    await remove(deleteSource.id);
    setDeleteSource(null);
  }

  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <div className="page" data-testid="sources-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("nav.sources")}</h1>
          <p className="page-subtitle">{t("sources.subtitle")}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t("sources.newSource")}
        </button>
      </div>

      <div className="card">
        <div className="card-header" style={{ justifyContent: "flex-end" }}>
          <span className="card-subtitle">
            {t("sources.xWechatDisclaimer")}
          </span>
        </div>
        <div className="source-head">
          <span>{t("sources.name")}</span>
          <span>{t("sources.type")}</span>
          <span>{t("sources.config")}</span>
          <span>{t("sources.tags")}</span>
          <span>{t("sources.status")}</span>
          <span style={{ textAlign: "right" }}>{t("sources.actions")}</span>
        </div>

        {loading && (
          <div className="table-empty">{t("common.loading")}</div>
        )}
        {!loading && error && (
          <div className="table-empty" style={{ color: "var(--ch-error)" }}>
            {error}
          </div>
        )}
        {!loading && !error && sources.length === 0 && (
          <div className="table-empty">{t("sources.empty")}</div>
        )}
        {!loading && !error &&
          sources.map((source) => {
            const meta = TYPE_META[source.type];
            return (
              <div
                key={source.id}
                className={`source-row${source.enabled ? "" : " disabled"}`}
                data-id={source.id}
              >
                <div className="cell-main">
                  <span className="cell-title">{source.name}</span>
                  <span className="cell-meta">{source.id}</span>
                </div>
                <span>
                  <span className={`badge ${meta.badgeClass}`}>
                    {meta.label}
                  </span>
                </span>
                <span
                  className="config-cell"
                  title={source.config}
                >
                  {formatConfigSummary(source.config)}
                </span>
                <span>
                  {source.tags && source.tags.length > 0 ? (
                    <span className="tag-list">
                      {source.tags.map((tag) => (
                        <span key={tag} className="tag-chip">
                          {tag}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="cell-dim">{t("sources.noTags")}</span>
                  )}
                </span>
                <span className="status-cell">
                  <button
                    type="button"
                    className={`switch${source.enabled ? " on" : ""}`}
                    role="switch"
                    aria-checked={source.enabled}
                    title={
                      source.enabled
                        ? t("sources.disableTitle")
                        : t("sources.enableTitle")
                    }
                    onClick={() => handleToggle(source)}
                  />
                  <span className="cell-dim">
                    {source.enabled ? t("sources.enabled") : t("sources.disabled")}
                  </span>
                </span>
                <span className="action-cell">
                  <button
                    type="button"
                    className="action-link"
                    onClick={() => openEdit(source)}
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    type="button"
                    className="action-link danger"
                    onClick={() => setDeleteSource(source)}
                  >
                    {t("common.delete")}
                  </button>
                </span>
              </div>
            );
          })}
      </div>

      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editingSource ? t("sources.editTitle") : t("sources.createTitle")}
        size="md"
        testid="source-form-modal"
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={closeForm}
              disabled={submitting}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {editingSource ? t("common.save") : t("sources.create")}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label" htmlFor="source-name">
            {t("sources.name")}
          </label>
          <input
            id="source-name"
            ref={nameInputRef}
            className={`form-input${fieldErrors.name ? " invalid" : ""}`}
            maxLength={64}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFieldErrors((prev) => ({ ...prev, name: "" }));
            }}
            placeholder={t("sources.namePlaceholder")}
            autoComplete="off"
          />
          {fieldErrors.name && (
            <div className="field-error show">{fieldErrors.name}</div>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">{t("sources.type")}</label>
          <div className="type-options">
            {TYPE_ORDER.map((type) => {
              const meta = TYPE_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  className={`type-option${selectedType === type ? " selected" : ""}`}
                  onClick={() => {
                    setSelectedType(type);
                    setConfig("");
                    setFieldErrors((prev) => ({ ...prev, config: "" }));
                  }}
                >
                  <span className={`badge ${meta.badgeClass}`}>{meta.label}</span>
                  <span className="type-option-desc">{meta.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="source-tag-input">
            {t("sources.tags")}
          </label>
          <div className="tag-input-row">
            <input
              id="source-tag-input"
              ref={tagInputRef}
              className="form-input"
              value={tagInput}
              onChange={(e) => {
                setTagInput(e.target.value);
                setFieldErrors((prev) => ({ ...prev, tags: "" }));
              }}
              onKeyDown={handleTagKeyDown}
              placeholder={t("sources.tagPlaceholder")}
              autoComplete="off"
              maxLength={32}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={addTag}
            >
              {t("sources.addTag")}
            </button>
          </div>
          {tags.length > 0 && (
            <div className="tag-chips">
              {tags.map((tag, index) => (
                <span key={`${tag}-${index}`} className="tag-chip removable">
                  <span className="tag-text">{tag}</span>
                  <button
                    type="button"
                    className="tag-remove"
                    onClick={() => removeTag(index)}
                    aria-label={`${t("sources.removeTag")} ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {fieldErrors.tags && (
            <div className="field-error show">{fieldErrors.tags}</div>
          )}
          <p className="help-text">{t("sources.tagsHelp")}</p>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="source-config">
            {TYPE_META[selectedType].configLabel}
          </label>
          <input
            id="source-config"
            className={`form-input${fieldErrors.config ? " invalid" : ""}`}
            value={config}
            onChange={(e) => {
              setConfig(e.target.value);
              setFieldErrors((prev) => ({ ...prev, config: "" }));
            }}
            placeholder={TYPE_META[selectedType].placeholder}
            autoComplete="off"
          />
          {fieldErrors.config && (
            <div className="field-error show">{fieldErrors.config}</div>
          )}
          <p className="help-text">{TYPE_META[selectedType].help}</p>
        </div>

        {fieldErrors.general && (
          <div className="form-error">{fieldErrors.general}</div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteSource}
        title={t("sources.deleteTitle")}
        message={
          deleteSource
            ? t("sources.deleteMessage", { name: deleteSource.name })
            : ""
        }
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteSource(null)}
      />
    </div>
  );
}
