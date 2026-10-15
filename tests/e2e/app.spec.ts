/// <reference lib="dom" />
// Smoke test of the real Electron window in Mock mode: launch, Tamil rendering,
// generate all 14 types, edit, regenerate with diff + undo, restart persistence.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const userData = mkdtempSync(join(tmpdir(), 'kss-e2e-'))
const root = join(__dirname, '../..')

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  // ELECTRON_RUN_AS_NODE (set by some hosts, e.g. VS Code extensions) would start Electron as plain Node.
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'ELECTRON_RENDERER_URL') env[k] = v
  }
  // KSS_E2E_EXE=dist/win-unpacked/KishoreSocialStudio.exe tests the packaged app instead of the dev build.
  const exe = process.env.KSS_E2E_EXE
  const app = await electron.launch({
    ...(exe ? { executablePath: join(root, exe) } : {}),
    args: exe ? [] : [root],
    env: { ...env, KSS_USER_DATA_DIR: userData, KSS_MOCK_LATENCY_MS: '100' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

const HEADLINE = 'பள்ளியில் கட்டாய கட்டண வசூல் — Chennai school fee complaint'

test('generate, edit and persist in Mock mode', async () => {
  let { app, page } = await launch()
  try {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByTestId('mock-mode-banner')).toBeVisible()

    // Window security: no Node in the page, narrow API only.
    const env = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      apiKeys: Object.keys((window as unknown as { api: object }).api)
    }))
    expect(env).toEqual({ require: 'undefined', process: 'undefined', apiKeys: ['invoke'] })

    await page.getByTestId('quick-headline').fill(HEADLINE)
    await page.getByTestId('quick-generate').click()
    await expect(page.getByRole('heading', { name: 'Generate Content' })).toBeVisible()
    await expect(page.getByTestId('headline')).toHaveValue(HEADLINE)

    await page.getByRole('button', { name: /Context, facts/ }).click()
    await page.getByTestId('allegations').fill('ஒரு பெற்றோர் புகார் அளித்துள்ளார்.')
    for (const p of ['youtube', 'facebook', 'instagram']) {
      const btn = page.getByTestId(`all-${p}`)
      if ((await btn.textContent())?.includes('All')) await btn.click()
    }
    await expect(page.getByTestId('generate')).toHaveText(/Generate 14 packages/)
    await page.getByTestId('generate').click()

    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-testid^="tab-"]')).toHaveCount(14)
    await expect(page.getByTestId('mock-badge').first()).toBeVisible()

    // Tamil font is bundled and used.
    const fontOk = await page.evaluate(async () => {
      await document.fonts.ready
      await document.fonts.load('16px "Noto Sans Tamil"', 'தமிழ்')
      return document.fonts.check('16px "Noto Sans Tamil"', 'தமிழ்')
    })
    expect(fontOk).toBe(true)
    await expect(page.getByTestId('field-titleOptions.0')).toHaveValue(/என குற்றச்சாட்டு/)
    await page.screenshot({ path: 'test-results/results-tamil.png', fullPage: false })

    // No accuracy warnings for mock output of an allegation.
    await expect(page.getByTestId('accuracy-panel')).toContainText('No issues found')

    // Edit a field — an invented amount is flagged immediately.
    const desc = page.getByTestId('field-description')
    await desc.fill('₹5,000 கட்டாய வசூல் என பெற்றோர் புகார்')
    await page.getByTestId('field-hook3s').click()
    await expect(page.getByTestId('field-warning').first()).toContainText('5000')
    await page.screenshot({ path: 'test-results/results-warning.png' })

    // Regenerate a title with diff preview, accept, then undo.
    const before = await page.getByTestId('field-titleOptions.0').inputValue()
    await page.getByTestId('regen-titleOptions.0').click()
    await page.getByRole('menuitem', { name: 'New wording' }).click()
    await expect(page.getByTestId('diff-view')).toBeVisible()
    await page.getByTestId('accept-proposal').click()
    await expect(page.getByTestId('field-titleOptions.0')).not.toHaveValue(before)
    await expect(page.getByTestId('field-description')).toHaveValue(/5,000/)
    await page.getByTestId('undo').click()
    await expect(page.getByTestId('field-titleOptions.0')).toHaveValue(before)
    await expect(page.getByTestId('field-description')).toHaveValue(/5,000/)

    // Instagram Story has no hashtag block.
    await page.getByTestId('tab-ig_story').click()
    await expect(page.getByTestId('field-overlayText')).toBeVisible()
    await expect(page.getByTestId('copy-hashtags')).toHaveCount(0)

    // Copy full package works through the main process clipboard.
    await page.getByTestId('tab-fb_reel').click()
    await page.getByTestId('copy-full').click()
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(clip).toContain('#growwithkishorenews')

    // Every other screen opens.
    for (const s of ['drafts', 'templates', 'channels', 'providers', 'export', 'generate', 'dashboard']) {
      await page.getByTestId(`nav-${s}`).click()
      await expect(page.locator('h1')).toBeVisible()
    }
    await page.getByTestId('nav-providers').click()
    await page.screenshot({ path: 'test-results/providers.png' })
  } finally {
    await app.close()
  }

  // Restart: the draft and the edit survive.
  ;({ app, page } = await launch())
  try {
    await page.getByTestId('nav-drafts').click()
    await expect(page.getByTestId('draft-list')).toContainText('பள்ளியில் கட்டாய கட்டண வசூல்')
    await page.getByRole('button', { name: 'Open' }).first().click()
    await expect(page.getByTestId('field-description')).toHaveValue(/5,000/)
    await page.screenshot({ path: 'test-results/after-restart.png' })
  } finally {
    await app.close()
  }
})
