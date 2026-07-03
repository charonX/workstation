let projects = [];

export function resetProjects(seed = []) {
  projects = seed.map(p => ({ ...p }));
}

function nextProjectId() {
  return "p" + (projects.length + 1);
}

function timestamp() {
  return new Date().toISOString();
}

export function createLocalProject({ name, description, localPath }) {
  if (!name) throw new Error("Project name is required");
  const project = {
    id: nextProjectId(),
    name,
    description,
    sourceType: "local",
    localPath,
    updatedAt: timestamp()
  };
  projects.push(project);
  return { ...project };
}

export function createGitProject({ name, description, repoUrl, branch, localPath }) {
  if (!name) throw new Error("Project name is required");
  if (!repoUrl) throw new Error("Repository URL is required");
  const project = {
    id: nextProjectId(),
    name,
    description,
    sourceType: "git",
    repoUrl,
    branch: branch || "main",
    localPath,
    updatedAt: timestamp()
  };
  projects.push(project);
  return { ...project };
}

export function listProjects() {
  return projects.map(p => ({ ...p }));
}

export function filterProjects(projects, filter) {
  const term = (filter || "").toLowerCase();
  if (!term) return projects;
  return projects.filter(p => p.name.toLowerCase().includes(term));
}
