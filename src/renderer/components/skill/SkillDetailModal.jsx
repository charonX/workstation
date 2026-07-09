import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSkillDetail } from "../../hooks/useSkills.js";
import Modal from "../shared/Modal.jsx";

const TABS = [
  { key: "overview", testid: "skill-tab-overview" },
  { key: "parameters", testid: "skill-tab-parameters" },
  { key: "examples", testid: "skill-tab-examples" },
  { key: "readme", testid: "skill-tab-readme" },
];

export default function SkillDetailModal({ skillId, onClose }) {
  const { t } = useTranslation();
  const { skill, loading } = useSkillDetail(skillId);
  const [activeTab, setActiveTab] = useState("overview");

  if (loading) {
    return (
      <Modal isOpen={true} onClose={onClose} title={t("skills.loadingDetail")} testid="skill-detail-modal">
        <p className="loading-text">{t("skills.loadingDetail")}</p>
      </Modal>
    );
  }

  if (!skill) return null;

  const footer = (
    <button className="btn btn-ghost" onClick={onClose}>
      {t("common.close")}
    </button>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={skill.name}
      testid="skill-detail-modal"
      footer={footer}
    >
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`tab${activeTab === tab.key ? " active" : ""}`}
            data-testid={tab.testid}
            onClick={() => setActiveTab(tab.key)}
          >
            {t(`skills.${tab.key}`)}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="tab-panel active">
          <p className="skill-description">{skill.description}</p>
          <div className="meta-list">
            <div className="meta-row">
              <span className="meta-label">{t("skills.repoPath")}</span>
              <span className="meta-value">{skill.repoPath}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">{t("skills.version")}</span>
              <span className="meta-value">{skill.version || "—"}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">{t("skills.author")}</span>
              <span className="meta-value">{skill.author || "—"}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">{t("skills.category")}</span>
              <span className="meta-value">{skill.category || "—"}</span>
            </div>
            <div className="meta-row">
              <span className="meta-label">{t("skills.tags")}</span>
              <span className="meta-value">
                {skill.tags?.length > 0 ? skill.tags.join(", ") : "—"}
              </span>
            </div>
          </div>
        </div>
      )}

      {activeTab === "parameters" && (
        <div className="tab-panel active">
          {skill.parameters?.length > 0 ? (
            <div className="param-table">
              <div className="param-header">
                <span>{t("skills.paramName")}</span>
                <span>{t("skills.paramType")}</span>
                <span>{t("skills.paramDesc")}</span>
              </div>
              {skill.parameters.map((param, i) => (
                <div key={i} className="param-row">
                  <span>{param.name}</span>
                  <span>{param.type}</span>
                  <span>{param.description}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-text">{t("skills.noParameters")}</p>
          )}
        </div>
      )}

      {activeTab === "examples" && (
        <div className="tab-panel active">
          {skill.examples?.length > 0 ? (
            skill.examples.map((example, i) => (
              <div key={i} className="code-block">{example}</div>
            ))
          ) : (
            <p className="empty-text">{t("skills.noExamples")}</p>
          )}
        </div>
      )}

      {activeTab === "readme" && (
        <div className="tab-panel active">
          {skill.readme ? (
            <div className="readme-preview">
              {/* Simple markdown-like rendering */}
              {skill.readme.split("\n").map((line, i) => {
                if (line.startsWith("# ")) {
                  return <h3 key={i}>{line.slice(2)}</h3>;
                }
                if (line.startsWith("## ")) {
                  return <h4 key={i}>{line.slice(3)}</h4>;
                }
                if (line.trim() === "") {
                  return <br key={i} />;
                }
                if (line.startsWith("```")) {
                  return null; // Skip code fence markers
                }
                // Inline code
                const parts = line.split(/(`[^`]+`)/g);
                return (
                  <p key={i}>
                    {parts.map((part, j) =>
                      part.startsWith("`") && part.endsWith("`") ? (
                        <code key={j}>{part.slice(1, -1)}</code>
                      ) : (
                        <span key={j}>{part}</span>
                      )
                    )}
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="empty-text">{t("skills.noReadme")}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
