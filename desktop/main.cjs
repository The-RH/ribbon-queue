const { app, BrowserWindow, dialog, shell, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
let host, window;
app.setName("Ribbon Queue");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      const { startServer } = await import(
        pathToFileURL(path.join(__dirname, "../src/server/index.mjs")).href
      );
      host = await startServer({
        directory:
          process.env.RIBBON_DESKTOP_DATA_DIR ||
          path.join(app.getPath("userData"), "host-data"),
        webDirectory: path.join(__dirname, "../dist/client"),
      });
      session.defaultSession.setPermissionRequestHandler(
        (webContents, permission, callback) => {
          let allowed = false;
          try {
            allowed =
              new URL(webContents.getURL()).origin === host.localUrl &&
              permission === "media";
          } catch {}
          callback(allowed);
        },
      );
      window = new BrowserWindow({
        width: 1280,
        height: 900,
        minWidth: 760,
        minHeight: 600,
        title: "Ribbon Queue",
        backgroundColor: "#f7f5ef",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.removeMenu();
      window.webContents.setWindowOpenHandler(({ url }) => {
        try {
          if (new URL(url).origin === host.publicUrl) shell.openExternal(url);
        } catch {}
        return { action: "deny" };
      });
      window.webContents.on("will-navigate", (event, url) => {
        try {
          if (new URL(url).origin !== host.localUrl) event.preventDefault();
        } catch {
          event.preventDefault();
        }
      });
      await window.loadURL(
        host.store.settings().setupRequired
          ? host.setupUrl
          : host.localUrl + "/#/admin",
      );
    } catch (error) {
      dialog.showErrorBox("Ribbon Queue 無法啟動", error.message);
      app.quit();
    }
  });
  app.on("window-all-closed", () => app.quit());
  let quitting = false;
  app.on("before-quit", (event) => {
    if (host && !quitting) {
      event.preventDefault();
      quitting = true;
      host.close().finally(() => {
        host = null;
        app.quit();
      });
    }
  });
}
