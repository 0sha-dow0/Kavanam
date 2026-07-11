/*
OnTask DomReader.
Uses the active per-site adapter to collect {id, text} for each
recommendation card and hands batches to the bridge. Dedupes by card id so
re-collection (scroll, retries) only reports new cards.
*/

var ontaskDomReader = {
  seenIds: {},

  collect: function () {
    var adapter = ontaskActiveAdapter()
    if (!adapter) {
      return []
    }
    var items = []
    adapter.getRecommendationCards().forEach(function (node) {
      var id = adapter.cardId(node)
      var text = adapter.extractText(node)
      if (!id || !text || ontaskDomReader.seenIds[id]) {
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

  // related feeds render asynchronously after load: retry on a short backoff
  // (T2.3 replaces this with a MutationObserver for infinite scroll)
  start: function () {
    if (!ontaskActiveAdapter()) {
      return
    }
    var delays = [1000, 3000, 6000, 10000]
    delays.forEach(function (delay) {
      setTimeout(ontaskDomReader.run, delay)
    })
  }
}

if (document.readyState === 'complete') {
  ontaskDomReader.start()
} else {
  window.addEventListener('load', function () {
    ontaskDomReader.start()
  })
}
