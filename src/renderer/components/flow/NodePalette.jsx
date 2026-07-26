import { useTranslation } from "react-i18next";

const NODE_CATEGORIES = [
  {
    label: "Trigger",
    key: "trigger",
    items: [
      { type: "trigger", nameKey: "nodeTypes.manual", icon: "⏱" },
      { type: "feishuMessage", nameKey: "nodeTypes.feishuMessage", icon: "✉️" },
      { type: "flowInput", nameKey: "nodeTypes.flowInput", icon: "⤵" },
    ],
  },
  {
    label: "logic",
    key: "logic",
    items: [
      { type: "condition", nameKey: "nodeTypes.condition", icon: "◈" },
      { type: "forEach", nameKey: "nodeTypes.forEach", icon: "↻" },
      { type: "while", nameKey: "nodeTypes.while", icon: "⟳" },
      { type: "callFlow", nameKey: "nodeTypes.callFlow", icon: "⎘" },
      { type: "setVariables", nameKey: "nodeTypes.setVariables", icon: "=" },
    ],
  },
  {
    label: "Flow",
    key: "flow",
    items: [
      { type: "flowOutput", nameKey: "nodeTypes.flowOutput", icon: "⤴" },
    ],
  },
  {
    label: "Execution",
    key: "execution",
    items: [
      { type: "agent", nameKey: "nodeTypes.agent", icon: "◆" },
      { type: "feishuSend", nameKey: "nodeTypes.feishuSend", icon: "💬" },
    ],
  },
];

// i18n label fallback used when a translation key is missing (defensive; the
// canonical labels come from locale files per REQ-FLOW-043 AC6).
const FALLBACK_LABELS = {
  trigger: "Trigger",
  logic: "Logic",
  flow: "Flow",
  execution: "Execution",
};

export default function NodePalette({ onAddNode }) {
  const { t } = useTranslation();
  return (
    <aside className="node-palette" data-testid="node-palette">
      <h2 className="palette-title">{t("flowEditor.nodes")}</h2>
      {NODE_CATEGORIES.map((category) => (
        <div className="palette-group" key={category.key}>
          <div className="palette-label">{t(`palette.categories.${category.key}`, FALLBACK_LABELS[category.key])}</div>
          {category.items.map((item) => {
            const label = t(item.nameKey, item.nameKey.split(".").pop());
            return (
              <div
                key={item.type}
                className="palette-item"
                data-testid={`palette-node-${item.type}`}
                onClick={() => onAddNode(item.type, label)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onAddNode(item.type, label);
                  }
                }}
              >
                <span className="palette-icon">{item.icon}</span>
                <span className="palette-text">{label}</span>
              </div>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
