const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld(
  "gsd",
  Object.freeze({
    chooseDirectory: () => ipcRenderer.invoke("gsd:choose-directory"),
    revealFile: (jobId) => ipcRenderer.invoke("gsd:reveal-file", jobId),
  }),
);
