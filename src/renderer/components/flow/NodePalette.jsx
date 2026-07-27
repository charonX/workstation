import { useTranslation } from "react-i18next";
import { NODE_REGISTRY } from "./nodeRegistry.js";

// Presentation order of palette categories (matches the legacy layout).
const CATEGORY_ORDER = ["trigger", "logic", "flow", "execution"];

const FALLBACK_LABELS = {
  trigger: "Trigger",
  logic: "Logic",
  flow: "Flow",
  execution: "Execution",
};

function buildCategories(registry) {
  const groups = new Map();
  for (const entry of Object.values(registry)) {
    if (!entry?.type) continue;
    if (!groups.has(entry.category)) {
      groups.set(entry.category, {
        key: entry.category,
        items: [],
      });
    }
    groups.get(entry.category).items.push({
      type: entry.type,
      labelKey: entry.labelKey || `nodeTypes.${entry.type}`,
      icon: entry.icon,
    });
  }
  return CATEGORY_ORDER.map((key) => groups.get(key)).filter(Boolean);
}

export default function NodePalette({ onAddNode }) {
  const { t } = useTranslation();
  const categories = buildCategories(NODE_REGISTRY);

  return (
    <aside className="node-palette" data-testid="node-palette">
      <h2 className="palette-title">{t("flowEditor.nodes")}</h2>
      {categories.map((category) => (
        <div className="palette-group" key={category.key}>
          <div className="palette-label">
            {t(`palette.categories.${category.key}`, FALLBACK_LABELS[category.key])}
          </div>
          {category.items.map((item) => {
            const label = t(item.labelKey, item.type);
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
