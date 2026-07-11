const { test, expect } = require('@playwright/test')
const { createSiteServer } = require('./siteServer')
const { launchOnTask, waitForPage } = require('./helpers')

test('real preload filters content and blocks off-task navigation', async ({}, testInfo) => {
  const site = await createSiteServer()
  const app = await launchOnTask(testInfo.outputPath('user-data'), site.feedURL)
  try {
    const chrome = await waitForPage(app, page => page.url() === 'min://app/index.html')
    await expect(chrome.locator('#ontask-intake')).toBeVisible()
    await chrome.locator('#ontask-intake-input').fill('Write thesis')
    await chrome.locator('#ontask-intake-start').click()
    await expect(chrome.locator('#ontask-focus-task')).toHaveText('Write thesis')

    const content = await waitForPage(app, page => page.url().startsWith(site.feedURL))
    await expect(content.locator('#on-card')).toBeVisible()
    await expect(content.locator('#off-card')).toBeHidden()
    await expect(content.locator('#ambiguous-card')).toBeHidden()
    await expect(content.locator('#unscoreable-card')).toBeVisible()

    const replacementError = await chrome.evaluate(async function () {
      try {
        await require('electron').ipcRenderer.invoke('ontask-start-session', 'Replace task')
        return null
      } catch (err) {
        return err.message
      }
    })
    expect(replacementError).toContain('already active')

    const offRequests = site.requestCount('/off-task/page')
    await content.locator('#blocked-nav').click({ noWaitAfter: true })
    // a block is an event, not a state: the badge flashes Blocked, then
    // reverts to the current page's real band
    await expect(chrome.locator('#ontask-status-text')).toHaveText('Blocked')
    expect(site.requestCount('/off-task/page')).toBe(offRequests)
    await expect(chrome.locator('#ontask-status-text')).toHaveText('On task', { timeout: 10000 })
  } finally {
    await app.close()
    await site.close()
  }
})

test('engine outage reveals content and allows navigation', async ({}, testInfo) => {
  const site = await createSiteServer()
  const app = await launchOnTask(testInfo.outputPath('outage-user-data'), site.feedURL)
  try {
    const chrome = await waitForPage(app, page => page.url() === 'min://app/index.html')
    await chrome.locator('#ontask-intake-input').fill('Write thesis')
    await chrome.locator('#ontask-intake-start').click()
    const content = await waitForPage(app, page => page.url().startsWith(site.feedURL))
    await expect(content.locator('#off-card')).toBeHidden()

    await app.evaluate(function () {
      global.__ontaskE2E.setEngineMode('outage')
    })
    await expect(content.locator('#off-card')).toBeVisible()
    await content.locator('#blocked-nav').click({ noWaitAfter: true })
    await expect.poll(function () {
      return app.windows().map(page => page.url())
    }).toContain(site.offTaskURL)
  } finally {
    await app.close()
    await site.close()
  }
})

test('resume restores the persisted focus session', async ({}, testInfo) => {
  const site = await createSiteServer()
  const userData = testInfo.outputPath('resume-user-data')
  let app = await launchOnTask(userData, site.feedURL)
  try {
    let chrome = await waitForPage(app, page => page.url() === 'min://app/index.html')
    await chrome.locator('#ontask-intake-input').fill('Resume this thesis')
    await chrome.locator('#ontask-intake-start').click()
    const original = await chrome.evaluate(function () {
      return require('electron').ipcRenderer.invoke('ontask-get-session')
    })
    await app.close()

    app = await launchOnTask(userData, site.feedURL)
    chrome = await waitForPage(app, page => page.url() === 'min://app/index.html')
    await expect(chrome.locator('#ontask-intake-resume')).toBeVisible()
    await expect(chrome.locator('#ontask-resume-task')).toHaveText('Resume this thesis')
    await chrome.locator('#ontask-intake-resume').click()
    await expect(chrome.locator('#ontask-focus-task')).toHaveText('Resume this thesis')
    const resumed = await chrome.evaluate(function () {
      return require('electron').ipcRenderer.invoke('ontask-get-session')
    })
    expect(resumed.startedAt).toBe(original.startedAt)
  } finally {
    await app.close()
    await site.close()
  }
})
