/*
OnTask NavigationGuard — Surface 2.
Intercepts top-level navigations in web content views. Off-task cross-domain
navigation is hard-blocked (Q18/Q19); auth flows always pass (Q20); in-site
drift is left to the content/recommendation surfaces (Q21). Degraded
sessions (empty allowlist, no Groq) fail OPEN so the web never bricks.
Also owns: last on-task URL tracking (for bounce-back), live subtask
inference from page titles (Q5), and off-task primary-content blocking (Q15).
*/

const ontaskNavigationGuard = {
  lastOnTaskURL: {}, // webContentsId -> url
  subtaskTimers: {},
  navigationTokens: {},
  approvedNavigations: {},
  contentViews: new WeakSet(),
  authFlows: {},

  AUTH_HOSTS: [
    'accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com',
    'login.live.com', 'auth0.com', 'okta.com', 'id.atlassian.com',
    'login.yahoo.com', 'clerk.dev'
  ],
  AUTH_PATTERN: /login|log-in|signin|sign-in|oauth|auth|sso|account|consent|challenge/i,

  SEARCH_HOSTS: [
    'google.com', 'duckduckgo.com', 'bing.com', 'startpage.com',
    'ecosia.org', 'search.brave.com', 'wikipedia.org'
  ],

  isWebView: function (wc) {
    return !!wc && ontaskNavigationGuard.contentViews.has(wc)
  },

  isAuthURL: function (target) {
    var g = ontaskNavigationGuard
    return g.AUTH_HOSTS.some(function (h) { return g.hostMatches(target.hostname, h) }) ||
      g.AUTH_PATTERN.test(target.pathname)
  },

  authFlowActive: function (wc) {
    return !!(wc && ontaskNavigationGuard.authFlows[wc.id] > Date.now())
  },

  beginAuthFlow: function (wc) {
    if (wc) {
      ontaskNavigationGuard.authFlows[wc.id] = Date.now() + 30000
    }
  },

  approveOnce: function (wc, url) {
    if (wc) {
      ontaskNavigationGuard.approvedNavigations[wc.id] = String(url)
    }
  },

  registrable: function (hostname) {
    var parts = String(hostname || '').toLowerCase().replace(/^www\./, '').split('.')
    return parts.slice(-2).join('.')
  },

  hostMatches: function (hostname, domain) {
    hostname = String(hostname || '').toLowerCase()
    domain = String(domain || '').toLowerCase().replace(/^www\./, '')
    return hostname === domain || hostname.endsWith('.' + domain)
  },

  decide: function (url, currentUrl, wc) {
    var g = ontaskNavigationGuard
    if (!focusSession.isActive()) {
      return { allow: true, reason: 'no session' }
    }
    var target
    try {
      target = new URL(url)
    } catch (e) {
      return { allow: true, reason: 'unparseable' }
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return { allow: true, reason: 'internal' }
    }
    // auth and OAuth redirect chains always pass (Q20)
    if (g.isAuthURL(target)) {
      g.beginAuthFlow(wc)
      return { allow: true, reason: 'auth' }
    }
    if (g.authFlowActive(wc)) {
      return { allow: true, reason: 'auth-chain' }
    }
    // search engines are working tools, never walls
    if (g.SEARCH_HOSTS.some(function (h) { return g.hostMatches(target.hostname, h) })) {
      return { allow: true, reason: 'search' }
    }
    // same-site movement is handled by the content surfaces, not nav blocking (Q21)
    try {
      var current = new URL(currentUrl)
      if (g.registrable(current.hostname) === g.registrable(target.hostname)) {
        return { allow: true, reason: 'same-domain' }
      }
    } catch (e) {}
    var session = focusSession.get()
    var allowlist = (session && session.allowlist) || []
    if (allowlist.some(function (d) { return g.hostMatches(target.hostname, d) })) {
      return { allow: true, reason: 'allowlist' }
    }
    // keyword hit from the goal expansion counts as on-task
    var urlText = g.urlText(target)
    var keywords = (session && session.keywords) || []
    if (keywords.some(function (k) { return urlText.indexOf(String(k).toLowerCase()) !== -1 })) {
      return { allow: true, reason: 'keyword' }
    }
    // unknown destination: relevance-score it asynchronously (defer)
    return { allow: false, defer: true, reason: 'needs-score' }
  },

  urlText: function (target) {
    var raw = target.hostname.replace(/^www\./, '') + ' ' + target.pathname + ' ' + target.search
    try {
      raw = decodeURIComponent(raw)
    } catch (e) {}
    return raw.replace(/[-+_/?=&.,%]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  },

  // async second stage for deferred decisions: block ONLY when the
  // destination text is scoreable and clearly off-task; opaque URLs pass
  // and are caught by the primary-content check after load (Q15)
  scoreURL: async function (url) {
    var target
    try {
      target = new URL(url)
    } catch (e) {
      return { allow: true, reason: 'unparseable' }
    }
    var text = ontaskNavigationGuard.urlText(target)
    // a bare domain or near-empty path carries no task signal: judging
    // "youtube com" against the task would wall off the open web. Let it
    // load; the primary-content check judges the actual page (Q15).
    var meaningfulWords = text.split(' ').filter(function (w) { return w.length > 2 })
    if (!text || (target.pathname === '/' && !target.search) || meaningfulWords.length < 3) {
      return { allow: true, reason: 'unscoreable-url' }
    }
    var score = await ontaskRelevanceEngine.scoreText(meaningfulWords.join(' '), { taskOnly: true })
    var band = ontaskRelevanceEngine.band(score)
    if (band === null) {
      return { allow: true, reason: 'scoring-outage' }
    }
    if (band === 'off') {
      return { allow: false, reason: 'scored off-task' }
    }
    if (band === 'ambiguous') {
      if (!ontaskGroqClient.available()) {
        return { allow: true, reason: 'tiebreak-unavailable' }
      }
      var session = focusSession.get()
      var verdict = await ontaskGroqClient.tiebreak(session.task, session.expandedIntent, text)
      return verdict === 'on'
        ? { allow: true, reason: 'tiebreak on-task' }
        : { allow: false, reason: 'tiebreak off-task' }
    }
    return { allow: true, reason: 'scored on-task' }
  },

  resolve: async function (url, currentUrl, wc) {
    var decision = ontaskNavigationGuard.decide(url, currentUrl, wc)
    if (!decision.defer) {
      return decision
    }
    try {
      return await ontaskNavigationGuard.scoreURL(url)
    } catch (err) {
      console.warn('ONTASK navigation scoring unavailable, allowing:', err.message)
      return { allow: true, reason: 'scoring-outage' }
    }
  },

  notifyChrome: function (channel, data) {
    try {
      sendIPCToWindow(windows.getCurrent(), channel, data)
    } catch (e) {}
  },

  bounceBack: function (wc) {
    var last = ontaskNavigationGuard.lastOnTaskURL[wc.id]
    try {
      if (last && last !== wc.getURL()) {
        wc.loadURL(last)
      } else if (wc.navigationHistory && wc.navigationHistory.canGoBack()) {
        wc.navigationHistory.goBack()
      } else {
        wc.loadURL('min://app/pages/newtab/index.html')
      }
    } catch (e) {}
  },

  inferSubtask: function (wc, title) {
    var g = ontaskNavigationGuard
    clearTimeout(g.subtaskTimers[wc.id])
    g.subtaskTimers[wc.id] = setTimeout(async function () {
      if (!focusSession.isActive() || wc.isDestroyed()) {
        return
      }
      var clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!clean) {
        return
      }
      // only clearly on-task pages may steer the subtask — otherwise an
      // off-task page title would poison every later judgment
      var score = await ontaskRelevanceEngine.scoreText(clean, { taskOnly: true })
      var band = ontaskRelevanceEngine.band(score)
      if (band !== 'on') {
        return
      }
      focusSession.setSubtask(clean)
      ontaskRelevanceEngine.onSubtask(clean)
      g.notifyChrome('ontask-session-changed', {})
    }, 1500) // debounced ~1.5s (Q5)
  },

  handleNavigation: function (wc, event, url) {
    var g = ontaskNavigationGuard
    if (!g.isWebView(wc) || (event && event.isMainFrame === false)) {
      return
    }
    if (g.approvedNavigations[wc.id] === String(url)) {
      delete g.approvedNavigations[wc.id]
      return
    }
    var sourceURL = wc.getURL()
    var session = focusSession.get()
    var decision = g.decide(url, sourceURL, wc)
    if (decision.allow) {
      return
    }
    event.preventDefault()
    var token = (g.navigationTokens[wc.id] || 0) + 1
    g.navigationTokens[wc.id] = token
    g.resolve(url, sourceURL, wc).then(function (resolved) {
      var current = !wc.isDestroyed() && wc.getURL() === sourceURL &&
        focusSession.get() === session && g.navigationTokens[wc.id] === token
      if (!current) {
        return
      }
      console.log('ONTASK nav:', resolved.allow ? 'allow' : 'BLOCK', '(' + resolved.reason + ')', url.slice(0, 100))
      if (resolved.allow) {
        g.approveOnce(wc, url)
        wc.loadURL(url)
      } else {
        g.notifyChrome('ontask-nav-blocked', { url: url })
      }
    })
  },

  register: function (wc) {
    var g = ontaskNavigationGuard
    if (!wc || g.contentViews.has(wc)) {
      return
    }
    g.contentViews.add(wc)
    wc.on('will-navigate', function (event, url) {
      g.handleNavigation(wc, event, url)
    })
    wc.on('will-redirect', function (event, url) {
      g.handleNavigation(wc, event, url)
    })
    wc.on('page-title-updated', function (event, title) {
      g.inferSubtask(wc, title)
    })
    wc.on('did-navigate', function (event, url) {
      if (/^https?:/.test(url)) {
        // new page, no verdict yet: clear the badge until it's judged
        g.notifyChrome('ontask-page-status', { band: null, url: url })
      }
    })
    wc.on('destroyed', function () {
      delete g.lastOnTaskURL[wc.id]
      delete g.navigationTokens[wc.id]
      delete g.approvedNavigations[wc.id]
      delete g.authFlows[wc.id]
      clearTimeout(g.subtaskTimers[wc.id])
    })
  }
}

/* ---------- off-task primary content (Q15) ---------- */

ipc.on('ontask-primary-check', async function (e, payload) {
  var content
  try {
    ontaskIPC.take(e, 'primary', 12, 60000)
    content = ontaskIPC.requireContent(e)
  } catch (err) {
    return
  }
  var wc = content.sender
  if (!ontaskRelevanceEngine.enforcing()) {
    return
  }
  var text
  try {
    text = ontaskIPC.cleanText(payload && payload.text, 600, 20)
  } catch (err) {
    return
  }
  var url = content.url
  var checkedSession = focusSession.get()
  if (wc.getURL() !== url || ontaskNavigationGuard.authFlowActive(wc)) {
    return
  }
  // never judge search/auth/internal pages as primary content
  var d = ontaskNavigationGuard.decide(url, url)
  if (d.reason === 'auth' || d.reason === 'search' || d.reason === 'internal') {
    return
  }
  // hub/landing pages and in-site search are tools, not content: their
  // text is site boilerplate or a bare query, so judging it bounces
  // legitimate stops (YouTube home, searching "sop"). Feed-level curation
  // covers these surfaces instead (Q21).
  try {
    var targetURL = new URL(url)
    var isHub = (targetURL.pathname === '/' || targetURL.pathname === '') && !targetURL.search
    var isSiteSearch = /\/(results|search|find|explore)\b/i.test(targetURL.pathname) ||
      /[?&](q|query|search_query|s|k|p)=/i.test(targetURL.search)
    if (isHub || isSiteSearch) {
      return
    }
  } catch (err) {
    return
  }
  var score = await ontaskRelevanceEngine.scoreText(text, { taskOnly: true })
  if (wc.isDestroyed() || wc.getURL() !== url || focusSession.get() !== checkedSession) {
    return
  }
  var band = ontaskRelevanceEngine.band(score)
  console.log('ONTASK primary check:', band, score && score.toFixed(3), JSON.stringify(text.slice(0, 90)))
  // ambiguous primary content is resolved decisively via the tiebreaker (Q8)
  if (band === 'ambiguous' && ontaskGroqClient.available()) {
    try {
      var session = focusSession.get()
      var verdict = await ontaskGroqClient.tiebreak(session.task, session.expandedIntent, text)
      if (wc.isDestroyed() || wc.getURL() !== url || focusSession.get() !== checkedSession) {
        return
      }
      band = verdict === 'on' ? 'on' : 'off'
      console.log('ONTASK primary tiebreak:', band)
    } catch (err) {
      band = 'ambiguous'
    }
  } else if (band === 'ambiguous') {
    band = 'ambiguous'
  }
  ontaskNavigationGuard.notifyChrome('ontask-page-status', { band: band, url: url })
  if (band === 'off') {
    console.log('ONTASK primary content off-task, blocking:', url.slice(0, 100))
    ontaskNavigationGuard.notifyChrome('ontask-nav-blocked', { url: url })
    if (!wc.isDestroyed() && wc.getURL() === url) {
      ontaskNavigationGuard.bounceBack(wc)
    }
  } else if (band === 'on') {
    ontaskNavigationGuard.lastOnTaskURL[wc.id] = url
  }
})

/* ---------- allowlist management (Q17) ---------- */

ipc.handle('ontask-allowlist-add', function (e, domain) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'allowlist', 30, 60000)
  var session = focusSession.get()
  var clean = ontaskIPC.cleanDomain(domain)
  if (session && session.allowlist.length < 50 && session.allowlist.indexOf(clean) === -1) {
    session.allowlist.push(clean)
    ontaskPersistence.onSessionUpdate(session)
  }
  return session ? session.allowlist : []
})

ipc.handle('ontask-allowlist-remove', function (e, domain) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'allowlist', 30, 60000)
  var session = focusSession.get()
  var clean = ontaskIPC.cleanDomain(domain)
  if (session) {
    session.allowlist = session.allowlist.filter(function (d) { return d !== clean })
    ontaskPersistence.onSessionUpdate(session)
  }
  return session ? session.allowlist : []
})

/* dev-only: expose OnTask internals for main-process debugging */
if (typeof process !== 'undefined' && typeof global !== 'undefined' &&
    process.argv && process.argv.includes('--development-mode')) {
  global.__ontaskDebugMain = {
    engine: ontaskRelevanceEngine,
    guard: ontaskNavigationGuard,
    groq: ontaskGroqClient,
    session: focusSession,
    ipcGuard: ontaskIPC
  }
}
