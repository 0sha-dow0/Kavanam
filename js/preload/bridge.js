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

  sendCards: function (items) {
    for (var i = 0; i < items.length; i += 50) {
      try {
        ipc.send('ontask-cards-collected', {
          url: ontaskBridge.currentURL(),
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
})

ipc.on('ontask-rescore', function () {
  ontaskBridge.statusCache = null
  ontaskDomReader.seenIds = {}
  ontaskDomReader.scheduleRun()
})
