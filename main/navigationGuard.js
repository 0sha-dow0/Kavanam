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
  openerURL: {}, // webContentsId -> URL of the page that opened this popup
  pendingOpeners: {}, // url -> {opener, at} for link-clicks routed into new tabs

  notePendingOpener: function (url, opener) {
    if (url && opener) {
      ontaskNavigationGuard.pendingOpeners[String(url)] = { opener: opener, at: Date.now() }
    }
  },

  takePendingOpener: function (url) {
    var record = ontaskNavigationGuard.pendingOpeners[String(url)]
    delete ontaskNavigationGuard.pendingOpeners[String(url)]
    return record && Date.now() - record.at < 15000 ? record.opener : null
  },

  AUTH_HOSTS: [
    'accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com',
    'login.live.com', 'auth0.com', 'okta.com', 'id.atlassian.com',
    'login.yahoo.com', 'clerk.dev'
  ],
  AUTH_PATTERN: /login|log-in|signin|sign-in|signup|sign-up|register|oauth|auth|sso|account|consent|challenge/i,

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
    // search engines are working tools — but the QUERY is judged, so the
    // results page can't become an off-task reading surface
    if (g.SEARCH_HOSTS.some(function (h) { return g.hostMatches(target.hostname, h) })) {
      var query = g.searchQueryOf(target)
      if (!query || query.length < 6) {
        return { allow: true, reason: 'search' }
      }
      return { allow: false, defer: true, reason: 'search-query' }
    }
    // same-site movement is handled by the content surfaces, not nav blocking (Q21).
    // popups are born without a URL: judge them against their opener's page.
    var effectiveCurrent = currentUrl
    if (!effectiveCurrent || effectiveCurrent === 'about:blank') {
      effectiveCurrent = (wc && g.openerURL[wc.id]) || g.takePendingOpener(url) || effectiveCurrent
    }
    try {
      var current = new URL(effectiveCurrent)
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

  searchQueryOf: function (target) {
    var params = ['q', 'query', 'search_query', 'p', 's', 'k']
    for (var i = 0; i < params.length; i++) {
      var value = target.searchParams.get(params[i])
      if (value && value.trim()) {
        return value.replace(/[+]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
      }
    }
    return null
  },

  // URL machinery and words that merely repeat the domain carry no task
  // signal ("youtube com youtube" from a typed 'youtube' is NOT content)
  URL_STOPWORDS: ['www', 'com', 'net', 'org', 'html', 'htm', 'php', 'asp', 'aspx',
    'index', 'search', 'results', 'query', 'page', 'pages', 'watch', 'item',
    'view', 'video', 'videos', 'web', 'app', 'home', 'ref', 'utm'],

  urlSignalWords: function (target) {
    var hostLabels = {}
    target.hostname.toLowerCase().split('.').forEach(function (label) {
      hostLabels[label] = true
    })
    var seen = {}
    return ontaskNavigationGuard.urlText(target).split(' ').filter(function (word) {
      if (word.length < 3 || seen[word] || hostLabels[word] ||
          ontaskNavigationGuard.URL_STOPWORDS.indexOf(word) !== -1) {
        return false
      }
      seen[word] = true
      return true
    })
  },

  // async second stage for deferred decisions: block ONLY when the
  // destination text is scoreable and clearly off-task; opaque URLs pass
  // and are caught by the primary-content check after load (Q15)
  scoreURL: async function (url) {
    var g = ontaskNavigationGuard
    var target
    try {
      target = new URL(url)
    } catch (e) {
      return { allow: true, reason: 'unparseable' }
    }

    // search engines: the QUERY is the intent — judge it, but navigational
    // queries (typing a site name to reach it) must always pass. The local
    // embedding can't tell "google" from "cheesecake", so Groq decides;
    // locally we only block multi-word queries that score clearly off.
    var isSearchHost = g.SEARCH_HOSTS.some(function (h) { return g.hostMatches(target.hostname, h) })
    var text
    var offReason
    if (isSearchHost) {
      var query = g.searchQueryOf(target)
      if (!query || query.length < 6) {
        return { allow: true, reason: 'search' }
      }
      // repeat searches skip the round-trip: verdicts are remembered per session
      var session0 = focusSession.get()
      var judged = session0 && session0.judgedSearches && session0.judgedSearches[query]
      if (judged) {
        return judged === 'allow'
          ? { allow: true, reason: 'search allowed (cached)' }
          : { allow: false, reason: 'off-task search (cached)' }
      }
      var queryScore = await ontaskRelevanceEngine.scoreText(query, { taskOnly: true })
      var queryBand = ontaskRelevanceEngine.band(queryScore)
      if (queryBand === 'on' || queryBand === null) {
        return { allow: true, reason: 'search on-task' }
      }
      if (ontaskGroqClient.available()) {
        var session1 = focusSession.get()
        var searchVerdict = await ontaskGroqClient.judgeSearch(session1.task, session1.expandedIntent, query)
        if (session1 && session1.judgedSearches && focusSession.get() === session1) {
          session1.judgedSearches[query] = searchVerdict
        }
        return searchVerdict === 'allow'
          ? { allow: true, reason: 'search allowed (groq)' }
          : { allow: false, reason: 'off-task search' }
      }
      // degraded: never block short/one-word queries on embeddings alone
      if (queryBand === 'off' && query.split(' ').length >= 3) {
        return { allow: false, reason: 'off-task search' }
      }
      return { allow: true, reason: 'search (degraded)' }
    } else {
      // a bare domain, repeated-domain path, or URL machinery carries no
      // task signal ("youtube com youtube" from a typed 'youtube'): let it
      // load; the primary-content check judges the actual page (Q15).
      var words = g.urlSignalWords(target)
      if (words.length < 2) {
        return { allow: true, reason: 'unscoreable-url' }
      }
      text = words.join(' ')
      offReason = 'scored off-task'
    }

    var score = await ontaskRelevanceEngine.scoreText(text, { taskOnly: true })
    var band = ontaskRelevanceEngine.band(score)
    if (band === null) {
      return { allow: true, reason: 'scoring-outage' }
    }
    if (band === 'off') {
      return { allow: false, reason: offReason }
    }
    if (band === 'ambiguous') {
      if (!ontaskGroqClient.available()) {
        return { allow: true, reason: 'tiebreak-unavailable' }
      }
      var session = focusSession.get()
      var verdict = await ontaskGroqClient.tiebreak(session.task, session.expandedIntent, text, session.subtasks)
      return verdict === 'on'
        ? { allow: true, reason: 'tiebreak on-task' }
        : { allow: false, reason: 'tiebreak ' + offReason }
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

  register: function (wc, openerURL) {
    var g = ontaskNavigationGuard
    if (!wc || g.contentViews.has(wc)) {
      return
    }
    g.contentViews.add(wc)
    if (openerURL) {
      g.openerURL[wc.id] = openerURL
    }
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
      delete g.openerURL[wc.id]
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
    // Groq endorsed these domains for this task: never page-block inside them.
    // Hosts Groq already ruled on-task this session skip the round-trip too.
    var sessionForAllowlist = focusSession.get()
    var pageAllowlist = (sessionForAllowlist && sessionForAllowlist.allowlist) || []
    var approvedHosts = (sessionForAllowlist && sessionForAllowlist.approvedHosts) || []
    if (pageAllowlist.concat(approvedHosts).some(function (d) { return ontaskNavigationGuard.hostMatches(targetURL.hostname, d) })) {
      ontaskNavigationGuard.notifyChrome('ontask-page-status', { band: 'on', url: url })
      ontaskNavigationGuard.lastOnTaskURL[wc.id] = url
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
  /*
  Bouncing a whole page is the harshest intervention, and the local
  embedding is unreliable on short page headers (a university admissions
  page scored 0.036 against an SOP task). Every would-be block — off or
  ambiguous — must be confirmed by Groq when it's available; without Groq,
  only unambiguous junk (below the hard bar) blocks.
  */
  if ((band === 'off' || band === 'ambiguous') && ontaskGroqClient.available()) {
    try {
      var session = focusSession.get()
      var verdict = await ontaskGroqClient.tiebreak(session.task, session.expandedIntent, text, session.subtasks)
      if (wc.isDestroyed() || wc.getURL() !== url || focusSession.get() !== checkedSession) {
        return
      }
      band = verdict === 'on' ? 'on' : 'off'
      console.log('ONTASK primary tiebreak:', band)
    } catch (err) {
      band = 'ambiguous' // tiebreak outage: never block a page on a guess
    }
  } else if (band === 'off' && score >= ontaskRelevanceEngine.HARD_OFF) {
    band = 'ambiguous' // degraded mode: mid-band pages stay, feeds still curate
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
    // an on-task page extends trust to its host: later pages there skip
    // the round-trip, and content already judged strictly is re-judged
    // with the lenient bar (its verdicts were cached before trust existed)
    var onSession = focusSession.get()
    if (onSession && onSession.approvedHosts &&
        onSession.approvedHosts.indexOf(targetURL.hostname) === -1) {
      onSession.approvedHosts.push(targetURL.hostname)
      console.log('ONTASK host approved on-task:', targetURL.hostname)
      ontaskRelevanceEngine.invalidate()
    }
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
