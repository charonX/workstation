const NODE_CATEGORIES = [
  {
    label: "Trigger",
    items: [
      { type: "trigger", name: "Manual", icon: "⏱" },
    ],
  },
  {
    label: "logic",
    items: [
      { type: "condition", name: "Condition", icon: "◈" },
    ],
  },
  {
    label: "loop",
    items: [
      { type: "forEach", name: "ForEach", icon: "↻" },
      { type: "while", name: "While", icon: "⟳" },
    ],
  },
  {
    label: "Execution",
    items: [
      { type: "agent", name: "Agent", icon: "◆" },
      { type: "skill", name: "Skill", icon: "◈" },
    ],
  },
  {
    label: "Data",
    items: [
      { type: "data", name: "Data", icon: "{}" },
      { type: "output", name: "Output", icon: "▢" },
    ],
  },
];

export default function NodePalette({ onAddNode }) {
  return (
    <aside className="node-palette" data-testid="node-palette">
      <h2 className="palette-title">Nodes</h2>
      {NODE_CATEGORIES.map((category) => (
        <div className="palette-group" key={category.label}>
          <div
            className="palette-label"
            role="button"
            tabIndex={0}
            onClick={() => {
              const item = category.items[0];
              if (item) onAddNode(item.type, item.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                const item = category.items[0];
                if (item) onAddNode(item.type, item.name);
              }
            }}
          >
            {category.label}
          </div>
          {category.items.map((item) => (
            <div
              key={item.type}
              className="palette-item"
              onClick={() => onAddNode(item.type, item.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onAddNode(item.type, item.name);
                }
              }}
            >
              <span className="palette-icon">{item.icon}</span>
              <span className="palette-text">{item.name}</span>
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}
