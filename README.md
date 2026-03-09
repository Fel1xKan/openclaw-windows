# OpenClaw Windows

<p align="center">
  <span style="font-size: 72px">🦞</span>
</p>

<p align="center">
  <strong>OpenClaw Desktop Client for Windows</strong><br>
  An Electron wrapper for the <a href="https://github.com/openclaw/openclaw">OpenClaw</a> AI gateway with built-in auto-update support.
</p>

---

## Features

- 🖥️ **Native Windows App** — runs OpenClaw gateway as a desktop application
- 🔄 **Auto-Update** — checks for updates on startup and applies them seamlessly
- 🚀 **One-Click Launch** — no terminal needed, just double-click to start
- 🌐 **Gateway UI** — fully-featured web UI at `http://127.0.0.1:18789`

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22.12.0
- [Git](https://git-scm.com/) (for cloning with submodules)
- [pnpm](https://pnpm.io/) (for building the OpenClaw submodule)

## Getting Started

### 1. Clone with Submodules

```bash
git clone --recursive https://github.com/nicekid1/openclaw-windows.git
cd openclaw-windows
```

If you already cloned without `--recursive`:

```bash
git submodule update --init --recursive
```

### 2. Build the OpenClaw Submodule

```bash
cd packages/openclaw
pnpm install
pnpm build
pnpm ui:build
cd ../..
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run in Development Mode

```bash
npm start
```

This will:
1. Show a loading animation
2. Check for updates (if update server is configured)
3. Start the OpenClaw gateway
4. Open the gateway UI in an Electron window

## Building for Distribution

### Package (directory output)

```bash
npm run package
```

### Make Installer (.exe)

```bash
npm run make
```

The installer will be in `out/make/`.

## Project Structure

```
openclaw-windows/
├── src/
│   ├── main.js              # Electron main process
│   ├── preload.js            # Preload script
│   ├── renderer.js           # Renderer process
│   └── index.css             # Renderer styles
├── index.html                # Loading animation page
├── forge.config.js           # Electron Forge configuration
├── packages/
│   └── openclaw/             # [Git Submodule] OpenClaw upstream
├── vite.main.config.mjs      # Vite config for main process
├── vite.preload.config.mjs   # Vite config for preload
└── vite.renderer.config.mjs  # Vite config for renderer
```

## Architecture

```
┌─────────────────────────────────────────────┐
│              Electron App                    │
│  ┌─────────────┐    ┌────────────────────┐  │
│  │ Main Process │───▶│ Gateway Process    │  │
│  │  (main.js)   │    │ (openclaw.mjs)     │  │
│  └──────┬───────┘    └────────┬───────────┘  │
│         │                     │              │
│  ┌──────▼───────┐    ┌───────▼────────────┐  │
│  │ BrowserWindow│───▶│ Gateway UI         │  │
│  │              │    │ http://127.0.0.1:  │  │
│  │              │    │        18789       │  │
│  └──────────────┘    └────────────────────┘  │
└─────────────────────────────────────────────┘
         │
         │ HTTP (on startup, optional)
         ▼
┌─────────────────┐
│  Update Server   │
│  (self-hosted)   │
└─────────────────┘
```

## Auto-Update

The app supports optional hot-update via a self-hosted update server. On each launch, it checks for new versions and applies updates automatically.

This feature is controlled by a **build-time flag** `ENABLE_AUTO_UPDATE`:

| Build Command | Auto-Update |
|---|---|
| `npm run make` | ✅ Enabled (default) |
| `$env:ENABLE_AUTO_UPDATE="false"; npm run make` | ❌ Disabled |

When enabled, configure the update server URL at runtime:

```bash
# Windows CMD
set OPENCLAW_UPDATE_SERVER=https://your-update-server.com

# PowerShell
$env:OPENCLAW_UPDATE_SERVER="https://your-update-server.com"
```

> The update server needs to implement a simple REST API (check version, download `.tar.gz`). Default URL: `http://localhost:3456`.

## Configuration

| Variable | Default | Scope | Description |
|---|---|---|---|
| `ENABLE_AUTO_UPDATE` | `true` | Build-time | Set to `false` to completely disable auto-update |
| `OPENCLAW_UPDATE_SERVER` | `http://localhost:3456` | Runtime | URL of the update server (only used when auto-update is enabled) |

## License

[MIT](LICENSE) — see the [LICENSE](LICENSE) file for details.
