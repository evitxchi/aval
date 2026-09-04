"use strict";
 

const { contextBridge, ipcRenderer } = require("electron");

const invoke = (method, payload) => ipcRenderer.invoke(`aval:codex:${method}`, payload);

contextBridge.exposeInMainWorld("avalDesktop", Object.freeze({
  getState: () => invoke("get-state"),
  connect: () => invoke("connect"),
  cancelLogin: () => invoke("cancel-login"),
  logout: () => invoke("logout"),
  refresh: () => invoke("refresh"),
  setActive: (active) => invoke("set-active", { active: active === true }),
  setModel: (modelId) => invoke("set-model", { modelId }),
  ask: (payload) => invoke("ask", payload),
  cancelTurn: (conversationId) => invoke("cancel-turn", { conversationId }),
  onEvent: (listener) => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("aval:codex:event", handler);
    return () => ipcRenderer.removeListener("aval:codex:event", handler);
  },
}));
