import React, { useEffect, useState } from "react";

function App() {
  const [projects, setProjects] = useState([]);
  const [flows, setFlows] = useState([]);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [p, f, e] = await Promise.all([
      window.opc.listProjects(),
      window.opc.listFlows(),
      window.opc.listExecutions()
    ]);
    setProjects(p);
    setFlows(f);
    setExecutions(e);
    setLoading(false);
  }

  async function addProject() {
    await window.opc.createLocalProject({
      name: `Project ${projects.length + 1}`,
      description: "Created from Electron",
      localPath: `~/opc-workspace/project-${projects.length + 1}`
    });
    await loadData();
  }

  async function addFlow() {
    const project = projects[0];
    if (!project) return;
    await window.opc.createFlow({
      name: `Flow ${flows.length + 1}`,
      projectId: project.id,
      description: "Created from Electron"
    });
    await loadData();
  }

  async function runTask() {
    const flow = flows[0];
    if (!flow) return;
    await window.opc.createTask({
      projectId: flow.projectId,
      flowId: flow.id,
      trigger: "manual"
    });
    await loadData();
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>OPC Workstation</h1>
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <button onClick={addProject}>Add Project</button>
        <button onClick={addFlow}>Add Flow</button>
        <button onClick={runTask}>Run Task</button>
      </div>

      <section>
        <h2>Projects ({projects.length})</h2>
        <ul>
          {projects.map((p) => (
            <li key={p.id}>{p.name} <small>({p.sourceType})</small></li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Flows ({flows.length})</h2>
        <ul>
          {flows.map((f) => (
            <li key={f.id}>{f.name} <small>({f.nodes} nodes)</small></li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Executions ({executions.length})</h2>
        <ul>
          {executions.map((e) => (
            <li key={e.id}>{e.id} <small>({e.status})</small></li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default App;
