/* global MAIN_WINDOW_VITE_DEV_SERVER_URL, MAIN_WINDOW_VITE_NAME */

import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as projectService from "../projectService.js";
import * as flowService from "../flowService.js";
import * as taskService from "../taskService.js";
import * as skillService from "../skillService.js";
import * as settingsService from "../settingsService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, "../renderer", MAIN_WINDOW_VITE_NAME, "index.html")
    );
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IPC handlers for core services.
ipcMain.handle("project:createLocal", (_event, input) => projectService.createLocalProject(input));
ipcMain.handle("project:list", () => projectService.listProjects());
ipcMain.handle("flow:create", (_event, input) => flowService.createFlow(input));
ipcMain.handle("flow:list", () => flowService.listFlows());
ipcMain.handle("task:create", (_event, input) => taskService.createTask(input));
ipcMain.handle("task:listExecutions", () => taskService.listExecutions());
ipcMain.handle("skill:list", () => skillService.listSkills());
ipcMain.handle("settings:load", () => settingsService.loadSettings());
ipcMain.handle("settings:save", (_event, partial) => settingsService.saveSettings(partial));
