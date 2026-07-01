// Temporary stub for test compilation.

let projects = [];

export function resetProjects(seed = []) {
  projects = seed.map(p => ({ ...p }));
}

export function createLocalProject({ name, description, localPath }) {
  if (!name) throw new Error("Project name is required");
  const id = "p" + (projects.length + 1);
  const project = { id, name, description, sourceType: "local", localPath };
  projects.push(project);
  return { ...project };
}

export function createGitProject({ name, description, repoUrl, branch, localPath }) {
  if (!name) throw new Error("Project name is required");
  if (!repoUrl) throw new Error("Repository URL is required");
  const id = "p" + (projects.length + 1);
  const project = {
    id,
    name,
    description,
    sourceType: "git",
    repoUrl,
    branch: branch || "main",
    localPath
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
