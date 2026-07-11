/*
OnTask DomReader.
Uses the active per-site adapter to collect {id, text} for each
recommendation card and hands batches to the bridge. Dedupes by card id so
re-collection (scroll, retries) only reports new cards.
*/

var ontaskDomReader = {
  seenIds: {},
  nodesById: {},

  collect: function () {
    var adapter = ontaskActiveAdapter()
    if (!adapter) {
      return []
    }
    var items = []
    adapter.getRecommendationCards().forEach(function (node) {
      var id = adapter.cardId(node)
      var text = adapter.extractText(node)
      if (!id || !text) {
        return
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
    var items = ontaskDomReader.collect()
    if (items.length) {
      console.log('ONTASK domReader collected ' + items.length + ' cards:', JSON.stringify(items))
      ontaskBridge.sendCards(items)
    }
    return items.length
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

  start: function () {
    // enforcement only applies to real web pages, not browser-internal ones
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      return
    }
    ontaskDomReader.run()
    // picks up async-rendered and infinite-scroll cards (incl. SPA navigations)
    ontaskDomReader.observe()
  }
}

if (document.readyState === 'complete') {
  ontaskDomReader.start()
} else {
  window.addEventListener('load', function () {
    ontaskDomReader.start()
  })
}
