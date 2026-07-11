/*
OnTask DomReader.
Uses the resolved extractor (site adapter if it covers the page, generic
otherwise) to collect {id, text} per card, withholds new cards while their
verdict is computed (when enforcement is live), and hands batches to the
bridge. Dedupes by card id so re-collection only reports new cards.
*/

var ontaskDomReader = {
  seenIds: {},
  nodesById: {},

  collect: function () {
    var adapter = ontaskActiveAdapter()
    var nodes = []
    try {
      nodes = adapter.getRecommendationCards()
      // a claimed page yielding zero candidates means the adapter's
      // selectors broke or lag the site: fall back to generic (Q29)
      if (!nodes.length && adapter !== ontaskGenericExtractor) {
        adapter = ontaskGenericExtractor
        nodes = adapter.getRecommendationCards()
      }
    } catch (e) {
      console.log('ONTASK extractor error (no-op):', e.message)
      return []
    }
    var items = []
    nodes.forEach(function (node) {
      var id = null
      var text = null
      try {
        id = adapter.cardId(node)
        text = adapter.extractText(node)
      } catch (e) {}
      if (!id || !text) {
        return // unscoreable: left visible (Q12)
      }
      // always refresh the node ref (SPA navigations replace nodes)
      ontaskDomReader.nodesById[id] = node
      if (ontaskDomReader.seenIds[id]) {
        return
      }
      ontaskDomReader.seenIds[id] = true
      items.push({ id: id, text: text })
    })
    return items
  },

  run: function () {
    try {
      var items = ontaskDomReader.collect()
      if (!items.length) {
        return 0
      }
      ontaskBridge.getStatus(function (status) {
        if (status && status.enforcing) {
          // withhold until judged; cold start stays visible instead (Q11)
          items.forEach(function (it) {
            ontaskSurfaceApplier.markPending(it.id)
          })
        }
        console.log('ONTASK domReader collected ' + items.length + ' cards')
        ontaskBridge.sendCards(items)
      })
      return items.length
    } catch (e) {
      console.log('ONTASK domReader error (no-op):', e.message)
      return 0
    }
  },

  observer: null,
  debounceTimer: null,

  // batched + debounced re-collection: many DOM mutations fold into one run
  scheduleRun: function () {
    clearTimeout(ontaskDomReader.debounceTimer)
    ontaskDomReader.debounceTimer = setTimeout(ontaskDomReader.run, 500)
  },

  observe: function () {
    if (ontaskDomReader.observer) {
      return
    }
    ontaskDomReader.observer = new MutationObserver(ontaskDomReader.scheduleRun)
    ontaskDomReader.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    })
  },

  // primary-content judgment (Q15): is this page itself on-task?
  primaryCheck: function () {
    try {
      var adapter = ontaskActiveAdapter()
      var text = null
      if (adapter.mainContentText) {
        text = adapter.mainContentText()
      }
      if (!text) {
        text = ontaskGenericExtractor.mainContentText()
      }
      if (text && text.length >= 20) {
        ontaskBridge.sendPrimaryCheck(text)
      }
    } catch (e) {}
  },

  lastPrimaryURL: null,

  watchPrimary: function () {
    setTimeout(function check () {
      if (window.location.href !== ontaskDomReader.lastPrimaryURL) {
        ontaskDomReader.lastPrimaryURL = window.location.href
        setTimeout(ontaskDomReader.primaryCheck, 2000) // let titles render
      }
      setTimeout(check, 1500) // SPA navigations don't reload the page
    }, 2500)
  },

  start: function () {
    // enforcement only applies to real web pages, not browser-internal ones
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      return
    }
    ontaskDomReader.run()
    // picks up async-rendered and infinite-scroll cards (incl. SPA navigations)
    ontaskDomReader.observe()
    ontaskDomReader.watchPrimary()
    var adapter = ontaskActiveAdapter()
    if (adapter.init) {
      try {
        adapter.init()
      } catch (e) {}
    }
  }
}

if (document.readyState === 'complete') {
  ontaskDomReader.start()
} else {
  window.addEventListener('load', function () {
    ontaskDomReader.start()
  })
}
