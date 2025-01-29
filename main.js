const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const electronLocalshortcut = require("electron-localshortcut");
const path = require("path");
const serve = require("electron-serve");
const loadURL = serve({ directory: "build" });
const { autoUpdater } = require("electron-updater");
const log = require('electron-log');
log.transports.file.resolvePath = () => path.join(__dirname, 'electron.log');
log.info("App started");

app.on('ready', () => {
    log.info("Electron app is ready");
});

app.on('window-all-closed', () => {
    log.warn("All windows closed");
});
function createWindow() {
  var mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      devTools: false,
    },
    icon: path.join(__dirname, "build/logo512.png"),
    frame: true,
  });
  electronLocalshortcut.register(mainWindow, "Ctrl+F", () => {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  electronLocalshortcut.register(mainWindow, "Ctrl+M", () => {
    mainWindow.minimize();
  });
  electronLocalshortcut.register(mainWindow, "Ctrl+=", () => {
    mainWindow.webContents.zoomFactor += 0.1;
  });
  electronLocalshortcut.register(mainWindow, "Ctrl+-", () => {
    mainWindow.webContents.zoomFactor -= 0.1;
  });
  mainWindow.maximize();
  loadURL(mainWindow);
  autoUpdater.checkForUpdates();
  // code a tag code open in chrome browser
  mainWindow.webContents.on("will-navigate", (e, url) => {
    e.preventDefault();
    shell.openExternal(url);
  });
  // code
  mainWindow.on("close", (e) => {
    // Line 49
    e.preventDefault();
    dialog
      .showMessageBox({
        type: "info",
        buttons: ["Cancel", "Exit"],
        cancelId: 1,
        defaultId: 0,
        title: "Warning",
        detail: "Do you really want to close the application?",
      })
      .then(({ response }) => {
        if (response) {
          mainWindow.destroy();
          app.quit();
        }
      });
  });
}
app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
// Backend code include this files
require("./backend/index");
// end backend files

// AUTO UPDATE EXE CODE
autoUpdater.on("update-available", (info) => {
  // Display a confirmation dialog when an update is available.
  dialog
    .showMessageBox({
      type: "info",
      title: "Update Available",
      message: "A new update is available. Do you want to install it now?",
      buttons: ["Ok"],
    })
    .then((result) => {
      if (result.response === 0) {
        // User chose to install the update.
        autoUpdater.downloadUpdate();
      }
    });
});

autoUpdater.on("update-downloaded", (info) => {
  // Display a confirmation dialog when the update is downloaded.
  dialog
    .showMessageBox({
      type: "info",
      title: "Update Downloaded",
      message: "The update has been downloaded. Do you want to install it now?",
      buttons: ["Install", "Later"],
    })
    .then((result) => {
      if (result.response === 0) {
        // User chose to install the downloaded update.
        autoUpdater.quitAndInstall();
      }
    });
});

// autoUpdater.on("error", (error) => {
  // autoUpdater.on("error", (error) => {
  //   dialog.showMessageBox({
  //     type: "error",
  //     title: "Update Error",
  //     message: `An error occurred while updating: ${error.message}`,
  //     buttons: ["Ok"],
  //   });
  // });
// END AUTO UPDATE CODE




