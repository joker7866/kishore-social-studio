import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BrowserWindow,
  Menu,
  app,
  clipboard,
  dialog,
  ipcMain,
  net,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { isAllowedExternalUrl, type IpcChannel } from '@shared/ipc-contract'
import type { ProviderId } from '@shared/platform-types'
import { AnthropicProvider } from './ai/providers/anthropic'
import { MockProvider } from './ai/providers/mock'
import { OpenAIProvider } from './ai/providers/openai'
import type { ProviderAdapter } from './ai/providers/types'
import { loadSkill } from './ai/skill-loader'
import { openDatabase } from './db/database'
import { ensureDefaults, purgeDeletedDrafts } from './db/repo'
import { createHandlers, dispatch, type AppContext } from './ipc/handlers'
import { createLogger } from './logger'
import { KeyStore } from './secrets/key-store'

// Tests can point the app at a throwaway data folder.
if (process.env.KSS_USER_DATA_DIR) app.setPath('userData', process.env.KSS_USER_DATA_DIR)

if (!app.requestSingleInstanceLock()) app.quit()

const resourcesRoot = app.isPackaged ? process.resourcesPath : app.getAppPath()
const skillsRoot = join(resourcesRoot, 'skills')
const fontsRoot = app.isPackaged ? join(process.resourcesPath, 'fonts') : join(app.getAppPath(), 'resources', 'fonts')
const rendererIndex = join(__dirname, '../renderer/index.html')
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined

let mainWindow: BrowserWindow | null = null

function isAppUrl(url: string): boolean {
  if (devUrl && url.startsWith(devUrl)) return true
  const appUrl = pathToFileURL(rendererIndex).href
  return url === appUrl || url.startsWith(appUrl + '#') || url.startsWith(appUrl + '?')
}

/** Only our own top-level page may call the API. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || !mainWindow || event.sender !== mainWindow.webContents) return false
  if (frame !== mainWindow.webContents.mainFrame) return false
  return isAppUrl(frame.url)
}

let fontCssCache: string | null = null
function fontCss(): string {
  if (fontCssCache !== null) return fontCssCache
  const faces: string[] = []
  for (const subset of ['tamil', 'latin']) {
    for (const weight of [400, 700]) {
      const f = join(fontsRoot, `noto-sans-tamil-${subset}-${weight}-normal.woff2`)
      if (!existsSync(f)) continue
      faces.push(
        `@font-face { font-family: 'Noto Sans Tamil'; font-weight: ${weight}; font-style: normal; src: url(data:font/woff2;base64,${readFileSync(f).toString('base64')}) format('woff2'); }`
      )
    }
  }
  fontCssCache = faces.join('\n')
  return fontCssCache
}

async function printToPdf(html: string): Promise<Buffer> {
  const tmpDir = join(app.getPath('userData'), 'tmp')
  mkdirSync(tmpDir, { recursive: true })
  const file = join(tmpDir, `print-${Date.now()}.html`)
  writeFileSync(file, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  try {
    await win.loadFile(file)
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } })
  } finally {
    win.destroy()
    rmSync(file, { force: true })
  }
}

function createProvider(id: ProviderId, key: string | null): ProviderAdapter {
  if (id === 'openai') return new OpenAIProvider(key ?? '')
  if (id === 'anthropic') return new AnthropicProvider(key ?? '')
  return new MockProvider(Number(process.env.KSS_MOCK_LATENCY_MS ?? 600))
}

function hardenSessions(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  ses.setPermissionCheckHandler(() => false)
  // The renderer never talks to the network; only the main process calls AI APIs.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url
    const allowed =
      u.startsWith('file://') ||
      u.startsWith('devtools://') ||
      u.startsWith('data:') ||
      u.startsWith('blob:') ||
      (devUrl ? u.startsWith(devUrl) || u.startsWith(devUrl.replace(/^http/, 'ws')) : false)
    cb({ cancel: !allowed })
  })
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
  contents.on('will-redirect', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
  contents.on('will-attach-webview', (e) => e.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'Kishore Social Studio',
    backgroundColor: '#F4F7FB',
    autoHideMenuBar: true,
    icon: join(resourcesRoot, app.isPackaged ? 'icon.png' : 'build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged || !!process.env.KSS_DEVTOOLS
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(rendererIndex)
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const log = createLogger(join(userData, 'logs', 'app.log'), !app.isPackaged)
  log.info('Starting Kishore Social Studio', { version: app.getVersion(), packaged: app.isPackaged })

  if (app.isPackaged) Menu.setApplicationMenu(null)
  hardenSessions()

  const db = openDatabase(join(userData, 'kishore-social-studio.db'))
  ensureDefaults(db)
  purgeDeletedDrafts(db, 30)

  const ctx: AppContext = {
    db,
    keyStore: new KeyStore(join(userData, 'secrets'), {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b)
    }),
    skill: loadSkill(skillsRoot),
    log,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    userDataPath: userData,
    createProvider,
    isOnline: () => net.isOnline(),
    fontCss,
    dialogs: {
      async save(defaultName, filters) {
        const res = mainWindow
          ? await dialog.showSaveDialog(mainWindow, { defaultPath: join(app.getPath('documents'), defaultName), filters })
          : await dialog.showSaveDialog({ defaultPath: defaultName, filters })
        return res.canceled || !res.filePath ? null : res.filePath
      },
      async open(filters) {
        const opts = { properties: ['openFile' as const], filters }
        const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
        return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
      }
    },
    files: {
      write: (p, data) => writeFileSync(p, data),
      read: (p) => readFileSync(p),
      size: (p) => statSync(p).size
    },
    printToPdf,
    clipboardWrite: (text) => clipboard.writeText(text),
    openExternal: (url) => shell.openExternal(url)
  }
  log.info('Skill loaded', { name: ctx.skill.name, version: ctx.skill.version })

  const handlers = createHandlers(ctx)
  ipcMain.handle('kss:invoke', async (event, channel: unknown, payload: unknown) => {
    if (!isTrustedSender(event)) {
      log.warn('Rejected IPC from untrusted sender')
      return { ok: false, error: { code: 'forbidden', message: 'Untrusted sender' } }
    }
    if (typeof channel !== 'string') return { ok: false, error: { code: 'forbidden', message: 'Unknown channel' } }
    return dispatch(handlers, channel as IpcChannel, payload, log)
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('before-quit', () => {
    try {
      db.close()
    } catch {
      // already closed
    }
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
