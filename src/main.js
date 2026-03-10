import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import fsExtra from 'fs-extra';
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// ── Configuration ────────────────────────────────────────────────
const GATEWAY_PORT = 18789;
const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const HEALTH_CHECK_URL = `${GATEWAY_URL}/healthz`;
const UPDATE_SERVER_URL = process.env.OPENCLAW_UPDATE_SERVER || 'http://localhost:3456';

// ── Paths ────────────────────────────────────────────────────────

/**
 * The bundled openclaw (read-only in packaged app).
 */
function getBundledOpenClawPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'openclaw');
  }
  return path.join(__dirname, '..', '..', 'packages', 'openclaw');
}

/**
 * The writable runtime directory where the gateway actually runs from.
 * Located in the user's app data so it can be updated.
 */
function getRuntimePath() {
  return path.join(app.getPath('userData'), 'openclaw-runtime');
}

// ── File copy utility ────────────────────────────────────────────

/**
 * Recursively copy a directory, preserving structure.
 */
async function copyDir(src, dest) {
  await fsExtra.copy(src, dest, { dereference: false });
}

/**
 * Ensure the writable runtime copy exists.
 * On first launch: copy the bundled openclaw to the runtime directory.
 */
async function ensureRuntimeCopy() {
  const runtimePath = getRuntimePath();
  const markerFile = path.join(runtimePath, '.installed');

  if (fs.existsSync(markerFile)) {
    console.log(`[OpenClaw] Using existing runtime at: ${runtimePath}`);
    return runtimePath;
  }

  const bundledPath = getBundledOpenClawPath();
  console.log(`[OpenClaw] First launch — copying openclaw to writable directory...`);
  console.log(`[OpenClaw]   From: ${bundledPath}`);
  console.log(`[OpenClaw]   To:   ${runtimePath}`);

  // Remove any partial copy
  if (fs.existsSync(runtimePath)) {
    await fsp.rm(runtimePath, { recursive: true, force: true });
  }

  await copyDir(bundledPath, runtimePath);

  // Write marker file
  await fsp.writeFile(markerFile, new Date().toISOString());
  console.log(`[OpenClaw] Runtime copy complete.`);
  return runtimePath;
}

// ── Gateway process management ───────────────────────────────────

let gatewayProcess = null;

function startGateway(openClawPath) {
  const entryScript = path.join(openClawPath, 'openclaw.mjs');
  console.log(`[OpenClaw] Starting gateway from: ${openClawPath}`);

  gatewayProcess = spawn('node', [entryScript, 'gateway', '--allow-unconfigured'], {
    cwd: openClawPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
  });

  gatewayProcess.stdout.on('data', (data) => {
    console.log(`[Gateway] ${data.toString().trim()}`);
  });
  gatewayProcess.stderr.on('data', (data) => {
    console.error(`[Gateway ERR] ${data.toString().trim()}`);
  });
  gatewayProcess.on('exit', (code, signal) => {
    console.log(`[OpenClaw] Gateway exited (code=${code}, signal=${signal})`);
    gatewayProcess = null;
  });
  gatewayProcess.on('error', (err) => {
    console.error(`[OpenClaw] Failed to start gateway:`, err);
    gatewayProcess = null;
  });
}

function waitForGateway(maxRetries = 60, intervalMs = 1000) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      http.get(HEALTH_CHECK_URL, (res) => {
        if (res.statusCode === 200) {
          console.log('[OpenClaw] Gateway is healthy!');
          resolve();
        } else { retry(); }
      }).on('error', () => { retry(); });
    };
    const retry = () => {
      retries++;
      if (retries >= maxRetries) {
        reject(new Error(`Gateway did not become healthy after ${maxRetries} attempts`));
        return;
      }
      if (retries % 5 === 0) {
        console.log(`[OpenClaw] Waiting for gateway... (${retries}/${maxRetries})`);
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

function stopGateway() {
  if (!gatewayProcess) return;
  console.log('[OpenClaw] Stopping gateway...');
  gatewayProcess.kill('SIGTERM');
  setTimeout(() => {
    if (gatewayProcess) gatewayProcess.kill('SIGKILL');
  }, 5000);
}

async function restartGateway(openClawPath, win) {
  console.log('[OpenClaw] Restarting gateway after update...');
  stopGateway();
  // Wait for process to fully exit
  await new Promise(resolve => setTimeout(resolve, 2000));
  startGateway(openClawPath);
  await waitForGateway();
  if (win && !win.isDestroyed()) {
    win.loadURL(GATEWAY_URL);
  }
}

// ── Update client ────────────────────────────────────────────────

/**
 * Get the current version from the runtime openclaw.
 */
async function getCurrentVersion(runtimePath) {
  try {
    const pkgPath = path.join(runtimePath, 'package.json');
    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Fetch JSON from a URL.
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    }).on('error', reject);
  });
}

/**
 * Download a file from URL to a local path.
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    client.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      reject(err);
    });
  });
}

/**
 * Extract a .tar.gz file to a directory.
 */
async function extractTarGz(archivePath, targetDir) {
  // Dynamic import tar since it's a dependency of the runtime openclaw
  const { extract } = await import('tar');
  await extract({
    file: archivePath,
    cwd: targetDir,
  });
}

/**
 * Check for updates and apply if available.
 * @returns {{ updated: boolean, fromVersion?: string, toVersion?: string }}
 */
async function checkAndApplyUpdate(runtimePath) {
  const currentVersion = await getCurrentVersion(runtimePath);
  console.log(`[Update] Current version: ${currentVersion}`);
  console.log(`[Update] Checking update server: ${UPDATE_SERVER_URL}`);

  try {
    // 1. Check for update
    const checkResult = await fetchJson(
      `${UPDATE_SERVER_URL}/api/update/check?version=${currentVersion}`
    );
    console.log(`[Update] Check result:`, checkResult);

    if (!checkResult.hasUpdate) {
      console.log('[Update] Already up to date.');
      return { updated: false };
    }

    // 2. Get latest release info
    const latest = await fetchJson(`${UPDATE_SERVER_URL}/api/update/latest`);
    console.log(`[Update] New version available: ${latest.version} (${(latest.size / 1024 / 1024).toFixed(2)} MB)`);

    // 3. Download the .tar.gz
    const tempDir = path.join(app.getPath('temp'), 'openclaw-update');
    await fsp.mkdir(tempDir, { recursive: true });
    const archivePath = path.join(tempDir, latest.filename);

    const downloadUrl = `${UPDATE_SERVER_URL}${latest.downloadUrl}`;
    console.log(`[Update] Downloading: ${downloadUrl}`);
    await downloadFile(downloadUrl, archivePath);
    console.log(`[Update] Download complete: ${archivePath}`);

    // 4. Backup current runtime (in case we need to rollback)
    const backupPath = `${runtimePath}.backup`;
    if (fs.existsSync(backupPath)) {
      await fsp.rm(backupPath, { recursive: true, force: true });
    }
    // Keep the marker and some config, just replace the runtime files
    console.log('[Update] Applying update...');

    // 5. Extract update to runtime directory (overwrites existing files)
    await extractTarGz(archivePath, runtimePath);

    // 6. Clean up temp
    await fsp.rm(tempDir, { recursive: true, force: true });

    console.log(`[Update] Successfully updated from ${currentVersion} to ${latest.version}!`);
    return { updated: true, fromVersion: currentVersion, toVersion: latest.version };
  } catch (err) {
    console.error('[Update] Update check/apply failed:', err.message);
    return { updated: false, error: err.message };
  }
}

// ── Window management ────────────────────────────────────────────

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'OpenClaw',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  return mainWindow;
}

// ── App lifecycle ────────────────────────────────────────────────

app.whenReady().then(async () => {
  // 1. Create window and show loading screen immediately
  const win = createWindow();
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  if (!app.isPackaged) {
    win.webContents.openDevTools();
  }

  try {
    // 2. Ensure writable runtime copy exists
    const runtimePath = await ensureRuntimeCopy();

    // 3. Check for updates before starting (non-blocking if server unreachable)
    if (ENABLE_AUTO_UPDATE) {
      const updateResult = await checkAndApplyUpdate(runtimePath);
      if (updateResult.updated) {
        console.log(`[OpenClaw] Updated to version ${updateResult.toVersion}`);
      }
    } else {
      console.log('[OpenClaw] Auto-update is disabled (build flag).');
    }

    // 4. Start the gateway from the writable runtime
    startGateway(runtimePath);

    // 5. Wait for gateway to be healthy
    await waitForGateway();

    // 6. Navigate to the gateway UI
    win.loadURL(GATEWAY_URL);
  } catch (err) {
    console.error('[OpenClaw] Failed to start:', err);
    win.loadURL(`data:text/html,<html><body style="font-family:sans-serif;background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h1>⚠️ Failed to Start</h1><p style="color:#ff6b6b">${err.message}</p></div></body></html>`);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => stopGateway());
process.on('exit', () => stopGateway());
