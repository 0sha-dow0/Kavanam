/*
OnTask preload↔main IPC wiring.
Collected card batches go up to the main process; verdicts come back down
and are applied by the SurfaceApplier. Uses the shared `ipc` from
js/preload/default.js in the concatenated bundle.
*/

var ontaskBridge = {
  statusCache: null,
  statusCacheAt: 0,

  sendCards: function (items) {
    try {
      ipc.send('ontask-cards-collected', { url: window.location.href, items: items })
    } catch (e) {
      console.log('ONTASK bridge send failed', e)
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

  sendPrimaryCheck: function (text) {
    try {
      ipc.send('ontask-primary-check', { url: window.location.href, text: text })
    } catch (e) {}
  }
}

ipc.on('ontask-verdicts', function (e, payload) {
  if (payload && payload.verdicts) {
    ontaskSurfaceApplier.applyVerdicts(payload.verdicts)
  }
})

ipc.on('ontask-clear', function () {
  ontaskBridge.statusCache = null
  ontaskSurfaceApplier.clearAll()
})
