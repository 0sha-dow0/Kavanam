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

  AUTH_HOSTS: [
    'accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com',
    'login.live.com', 'github.com', 'gitlab.com', 'auth0.com', 'okta.com',
    'id.atlassian.com', 'login.yahoo.com', 'facebook.com', 'clerk.dev'
  ],
  AUTH_PATTERN: /login|log-in|signin|sign-in|oauth|auth|sso|account|consent|challenge/i,

  SEARCH_HOSTS: [
    'google.com', 'duckduckgo.com', 'bing.com', 'startpage.com',
    'ecosia.org', 'search.brave.com', 'wikipedia.org'
  ],

  isWebView: function (wc) {
    try {
      return wc.session === electron.session.fromPartition('persist:webcontent')
    } catch (e) {
      return false
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

  decide: function (url, currentUrl) {
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
    if (g.AUTH_HOSTS.some(function (h) { return g.hostMatches(target.hostname, h) }) ||
        g.AUTH_PATTERN.test(target.hostname) || g.AUTH_PATTERN.test(target.pathname)) {
      return { allow: true, reason: 'auth' }
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
    if (!allowlist.length) {
      // degraded session (no Groq expansion): never brick the web (Q28)
      return { allow: true, reason: 'degraded-open' }
    }
    return { allow: false, reason: 'off-task cross-domain' }
  },

  notifyChrome: function (channel, data) {
    try {
      sendIPCToWindow(windows.getCurrent(), channel, data)
    } catch (e) {}
  },

  bounceBack: function (wc) {
    var last = ontaskNavigationGuard.lastOnTaskURL[wc.id]
    try {
      if (wc.navigationHistory && wc.navigationHistory.canGoBack()) {
        wc.navigationHistory.goBack()
      } else if (last && last !== wc.getURL()) {
        wc.loadURL(last)
      }
    } catch (e) {}
  },

  inferSubtask: function (wc, title) {
    var g = ontaskNavigationGuard
    clearTimeout(g.subtaskTimers[wc.id])
    g.subtaskTimers[wc.id] = setTimeout(function () {
      if (!focusSession.isActive() || wc.isDestroyed()) {
        return
      }
      var clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!clean) {
        return
      }
      focusSession.setSubtask(clean)
      ontaskRelevanceEngine.onSubtask(clean)
      g.notifyChrome('ontask-session-changed', {})
    }, 1500) // debounced ~1.5s (Q5)
  },

  attach: function () {
    app.on('web-contents-created', function (e, wc) {
      wc.on('will-navigate', function (event, url) {
        if (!ontaskNavigationGuard.isWebView(wc)) {
          return
        }
        var decision = ontaskNavigationGuard.decide(url, wc.getURL())
        console.log('ONTASK nav:', decision.allow ? 'allow' : 'BLOCK', '(' + decision.reason + ')', url.slice(0, 100))
        if (!decision.allow) {
          event.preventDefault()
          ontaskNavigationGuard.notifyChrome('ontask-nav-blocked', { url: url })
          ontaskNavigationGuard.bounceBack(wc)
        }
      })

      wc.on('did-navigate', function (event, url) {
        if (!ontaskNavigationGuard.isWebView(wc)) {
          return
        }
        if (/^https?:/.test(url) && ontaskNavigationGuard.decide(url, url).allow) {
          ontaskNavigationGuard.lastOnTaskURL[wc.id] = url
        }
      })

      wc.on('page-title-updated', function (event, title) {
        if (ontaskNavigationGuard.isWebView(wc)) {
          ontaskNavigationGuard.inferSubtask(wc, title)
        }
      })

      wc.on('destroyed', function () {
        delete ontaskNavigationGuard.lastOnTaskURL[wc.id]
        clearTimeout(ontaskNavigationGuard.subtaskTimers[wc.id])
      })
    })
  }
}

ontaskNavigationGuard.attach()

/* ---------- off-task primary content (Q15) ---------- */

ipc.on('ontask-primary-check', async function (e, payload) {
  var wc = e.sender
  if (!ontaskNavigationGuard.isWebView(wc) || !ontaskRelevanceEngine.enforcing()) {
    return
  }
  var text = String((payload && payload.text) || '').slice(0, 600)
  if (text.length < 20) {
    return // unscoreable: leave visible (Q12)
  }
  var url = (payload && payload.url) || ''
  // never judge search/auth/internal pages as primary content
  var d = ontaskNavigationGuard.decide(url, url)
  if (d.reason === 'auth' || d.reason === 'search' || d.reason === 'internal') {
    return
  }
  var score = await ontaskRelevanceEngine.scoreText(text)
  var band = ontaskRelevanceEngine.band(score)
  ontaskNavigationGuard.notifyChrome('ontask-page-status', { band: band, url: url })
  if (band === 'off') {
    console.log('ONTASK primary content off-task, blocking:', url.slice(0, 100), 'score', score && score.toFixed(3))
    ontaskNavigationGuard.notifyChrome('ontask-nav-blocked', { url: url })
    if (!wc.isDestroyed() && wc.getURL() === url) {
      ontaskNavigationGuard.bounceBack(wc)
    }
  }
})

/* ---------- allowlist management (Q17) ---------- */

ipc.handle('ontask-allowlist-add', function (e, domain) {
  var session = focusSession.get()
  var clean = String(domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  if (session && clean && session.allowlist.indexOf(clean) === -1) {
    session.allowlist.push(clean)
    ontaskPersistence.onSessionUpdate(session)
  }
  return session ? session.allowlist : []
})

ipc.handle('ontask-allowlist-remove', function (e, domain) {
  var session = focusSession.get()
  if (session) {
    session.allowlist = session.allowlist.filter(function (d) { return d !== domain })
    ontaskPersistence.onSessionUpdate(session)
  }
  return session ? session.allowlist : []
})
