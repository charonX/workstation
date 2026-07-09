import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFlows } from "../hooks/useFlows.js";
import { useProjects } from "../hooks/useProjects.js";
import FlowCard from "../components/flow/FlowCard.jsx";
import FlowFormModal from "../components/flow/FlowFormModal.jsx";
import "./Flows.css";

export default function Flows() {
  const { t } = useTranslation();
  const [flows, flowsLoading, flowsError, createFlow] = useFlows();
  const [projects, projectsLoading] = useProjects();
  const [showModal, setShowModal] = useState(false);

  const loading = flowsLoading || projectsLoading;

  return (
    <div className="page" data-testid="flows-page">
      <div className="page-header">
        <h1 className="page-title">{t("nav.flows")}</h1>
        <button
          className="btn btn-primary"
          data-testid="new-flow-button"
          onClick={() => setShowModal(true)}
        >
          + {t("flows.newFlow")}
        </button>
      </div>

      {flowsError && (
        <div className="card" style={{ marginBottom: "var(--ch-space-4)", borderColor: "var(--ch-error)" }}>
          <div className="card-body" style={{ color: "var(--ch-error)" }}>
            {flowsError}
          </div>
        </div>
      )}

      {loading ? (
        <p className="loading-text">{t("flows.loading")}</p>
      ) : (
        <div className="flow-grid">
          {flows.map((flow) => (
            <FlowCard key={flow.id} flow={flow} />
          ))}
          {flows.length === 0 && (
            <div className="empty-state">
              <p>{t("flows.empty")}</p>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <FlowFormModal
          projects={projects}
          onSubmit={createFlow}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
