/*
OnTask preload↔main IPC wiring.
Collected card batches go up to the main process; verdicts come back down
and are applied by the SurfaceApplier. Uses the shared `ipc` from
js/preload/default.js in the concatenated bundle.
*/

var ontaskBridge = {
  statusCache: null,
  statusCacheAt: 0,

  currentURL: function () {
    var url = new URL(window.location.href)
    url.hash = ''
    return url.href
  },

  // what the user is looking at right now: the search query if this is a
  // results page, else the page title — lets the engine judge items in
  // context instead of in a vacuum
  pageContext: function () {
    try {
      var url = new URL(window.location.href)
      var params = ['q', 'query', 'search_query', 'p', 's', 'k']
      for (var i = 0; i < params.length; i++) {
        var value = url.searchParams.get(params[i])
        if (value && value.trim()) {
          return value.replace(/\s+/g, ' ').trim().slice(0, 200)
        }
      }
    } catch (e) {}
    return (document.title || '').replace(/\s+/g, ' ').trim().slice(0, 200)
  },

  sendCards: function (items) {
    var curationId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    for (var i = 0; i < items.length; i += 50) {
      try {
        ipc.send('ontask-cards-collected', {
          url: ontaskBridge.currentURL(),
          context: ontaskBridge.pageContext(),
          curationId: curationId,
          total: items.length,
          items: items.slice(i, i + 50)
        })
      } catch (e) {
        console.log('ONTASK bridge send failed', e)
      }
    }
  },

  // enforcement status with a short cache so debounced runs stay cheap
  getStatus: function (callback) {
    var now = Date.now()
    if (ontaskBridge.statusCache && now - ontaskBridge.statusCacheAt < 5000) {
      callback(ontaskBridge.statusCache)
      return
    }
    ipc.invoke('ontask-status').then(function (status) {
      ontaskBridge.statusCache = status
      ontaskBridge.statusCacheAt = Date.now()
      callback(status)
    }).catch(function () {
      callback(null)
    })
  },

  scoreText: function (text) {
    return ipc.invoke('ontask-score-text', text)
  },

  finalVerdict: function (id, text) {
    return ipc.invoke('ontask-final-verdict', { id: id, text: text })
  },

  sendPrimaryCheck: function (text) {
    try {
      ipc.send('ontask-primary-check', { url: ontaskBridge.currentURL(), text: text })
    } catch (e) {}
  },

  getSuggestions: function (callback) {
    ipc.invoke('ontask-suggestions').then(callback).catch(function () {
      callback(null)
    })
  }
}

ipc.on('ontask-verdicts', function (e, payload) {
  if (payload && payload.url === ontaskBridge.currentURL() && payload.verdicts) {
    ontaskSurfaceApplier.applyVerdicts(payload.verdicts)
  }
})

ipc.on('ontask-clear', function () {
  ontaskBridge.statusCache = null
  ontaskSurfaceApplier.clearAll()
  ontaskClearInjectors()
})

ipc.on('ontask-rescore', function () {
  ontaskBridge.statusCache = null
  ontaskDomReader.seenIds = {}
  // task changed: drop injected panels + cached items so they refresh
  ontaskClearInjectors()
  ontaskDomReader.scheduleRun()
})
