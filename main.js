const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// ── Paths & DB (initialized after app is ready) ───────────────────────────────
let db;
let POSTER_DIR;
let tray = null;
let mainWin = null;

function initDb() {
  const USER_DATA = app.getPath('userData');
  const DB_PATH   = path.join(USER_DATA, 'keeptrack.db');
  POSTER_DIR = path.join(USER_DATA, 'posters');

  if (!fs.existsSync(POSTER_DIR)) fs.mkdirSync(POSTER_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS shows (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL DEFAULT 'show',
      season      INTEGER DEFAULT 1,
      episode     INTEGER DEFAULT 0,
      watch_time  INTEGER DEFAULT 0,
      rating      REAL DEFAULT 0,
      description TEXT DEFAULT '',
      poster_path TEXT DEFAULT '',
      status      TEXT DEFAULT 'watching',
      total       INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `);
  try { db.exec('ALTER TABLE shows ADD COLUMN total INTEGER DEFAULT 0'); } catch {}
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('db:getAll', () => {
  return db.prepare('SELECT * FROM shows ORDER BY created_at DESC').all();
});

ipcMain.handle('db:add', (_, entry) => {
  const stmt = db.prepare(`
    INSERT INTO shows (name, type, season, episode, watch_time, rating, description, poster_path, status, total)
    VALUES (@name, @type, @season, @episode, @watch_time, @rating, @description, @poster_path, @status, @total)
  `);
  const result = stmt.run(entry);
  return db.prepare('SELECT * FROM shows WHERE id = ?').get(result.lastInsertRowid);
});

ipcMain.handle('db:update', (_, entry) => {
  db.prepare(`
    UPDATE shows SET
      name=@name, type=@type, season=@season, episode=@episode,
      watch_time=@watch_time, rating=@rating, description=@description,
      poster_path=@poster_path, status=@status, total=@total
    WHERE id=@id
  `).run(entry);
  return db.prepare('SELECT * FROM shows WHERE id = ?').get(entry.id);
});

ipcMain.handle('db:delete', (_, id) => {
  // Delete poster file if it exists
  const row = db.prepare('SELECT poster_path FROM shows WHERE id = ?').get(id);
  if (row?.poster_path && fs.existsSync(row.poster_path)) {
    try { fs.unlinkSync(row.poster_path); } catch {}
  }
  db.prepare('DELETE FROM shows WHERE id = ?').run(id);
  return true;
});

ipcMain.handle('dialog:openImage', async () => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('poster:save', (_, { srcPath, showId }) => {
  const ext  = path.extname(srcPath).toLowerCase();
  const dest = path.join(POSTER_DIR, `${showId}${ext}`);
  // Remove old poster files for this show (different extension)
  for (const f of fs.readdirSync(POSTER_DIR)) {
    const base = path.basename(f, path.extname(f));
    if (base === String(showId) && path.join(POSTER_DIR, f) !== dest) {
      try { fs.unlinkSync(path.join(POSTER_DIR, f)); } catch {}
    }
  }
  fs.copyFileSync(srcPath, dest);
  return dest;
});

ipcMain.handle('poster:downloadFromUrl', async (_, { url, showId }) => {
  const https = require('https');
  const http  = require('http');
  const dest  = path.join(POSTER_DIR, `${showId}.jpg`);
  // Remove old posters for this show
  for (const f of fs.readdirSync(POSTER_DIR)) {
    const base = path.basename(f, path.extname(f));
    if (base === String(showId) && path.join(POSTER_DIR, f) !== dest) {
      try { fs.unlinkSync(path.join(POSTER_DIR, f)); } catch {}
    }
  }
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    protocol.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    }).on('error', err => { try { fs.unlinkSync(dest); } catch {} reject(err); });
  });
});

ipcMain.handle('poster:getDataUrl', (_, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ext  = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:image/${mime};base64,${data}`;
});

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  mainWin = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0a0b0f',
    icon: iconPath,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d0e12',
      symbolColor: '#e8eaf0',
      height: 40
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWin.loadFile('renderer/index.html');

  // Minimize to tray
  mainWin.on('minimize', (e) => {
    e.preventDefault();
    mainWin.hide();
  });

  mainWin.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });
}

function createTray() {
  const trayIconPath = path.join(__dirname, 'assets', 'tray.png');
  const icon = nativeImage.createFromPath(trayIconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('KeepTrack');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show KeepTrack',
      click: () => { mainWin.show(); mainWin.focus(); }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.isQuitting = true; app.quit(); }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWin.show(); mainWin.focus(); });
}

app.whenReady().then(() => {
  initDb();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // Keep alive in tray on Windows
});

app.on('activate', () => {
  if (mainWin) { mainWin.show(); mainWin.focus(); }
  else createWindow();
});
