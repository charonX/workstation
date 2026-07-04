import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("opc", {
  createLocalProject: (input) => ipcRenderer.invoke("project:createLocal", input),
  listProjects: () => ipcRenderer.invoke("project:list"),
  createFlow: (input) => ipcRenderer.invoke("flow:create", input),
  listFlows: () => ipcRenderer.invoke("flow:list"),
  createTask: (input) => ipcRenderer.invoke("task:create", input),
  listExecutions: () => ipcRenderer.invoke("task:listExecutions"),
  listSkills: () => ipcRenderer.invoke("skill:list"),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (partial) => ipcRenderer.invoke("settings:save", partial)
});
