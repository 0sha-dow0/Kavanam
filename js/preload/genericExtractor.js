/*
OnTask generic extractor — the DEFAULT feed/recommendation detector.
Identifies candidate items on ANY page with no hardcoded selectors:
  - explicit feed semantics: [role="feed"] children, <article> elements
  - repeated sibling/card structures: containers whose children share a
    tag+class shape, where the repeated children are link-bearing and
    text-bearing (feeds, listings, recommendation rails, card grids)
Per-site adapters may override this for precision via the adapter registry.
Uses textContent (no forced layout) so debounced re-runs stay cheap.
*/

var ontaskGenericExtractor = {
  name: 'generic',

  MIN_GROUP: 4, // a structure must repeat at least this often to be a feed
  MIN_TEXT: 25, // an item needs at least this much text to be scoreable
  MAX_ITEMS: 200,

  match: function () {
    return true
  },

  handles: function () {
    return true
  },

  isCandidateItem: function (node) {
    if (!node || node.nodeType !== 1) {
      return false
    }
    if (!node.querySelector('a[href]')) {
      return false
    }
    var text = node.textContent || ''
    if (text.replace(/\s+/g, ' ').trim().length < ontaskGenericExtractor.MIN_TEXT) {
      return false
    }
    // navigation chrome repeats and is link-dense, but it isn't a feed
    if (node.closest && node.closest('nav, header, footer, [role="navigation"]')) {
      return false
    }
    return true
  },

  groupKey: function (node) {
    return node.tagName + '.' + (node.classList && node.classList.length ? node.classList[0] : '')
  },

  getRecommendationCards: function () {
    var ge = ontaskGenericExtractor
    var results = []

    function add (node) {
      if (results.length >= ge.MAX_ITEMS) {
        return
      }
      for (var i = 0; i < results.length; i++) {
        if (results[i] === node || results[i].contains(node) || node.contains(results[i])) {
          return
        }
      }
      results.push(node)
    }

    // 1) explicit feed semantics
    document.querySelectorAll('[role="feed"] > *').forEach(function (node) {
      if (ge.isCandidateItem(node)) {
        add(node)
      }
    })
    document.querySelectorAll('article').forEach(function (node) {
      if (ge.isCandidateItem(node)) {
        add(node)
      }
    })

    // 2) repeated sibling/card structures
    var all = document.getElementsByTagName('*')
    for (var i = 0; i < all.length && results.length < ge.MAX_ITEMS; i++) {
      var container = all[i]
      if (container.childElementCount < ge.MIN_GROUP) {
        continue
      }
      var groups = {}
      var child = container.firstElementChild
      while (child) {
        var key = ge.groupKey(child)
        if (!groups[key]) {
          groups[key] = []
        }
        groups[key].push(child)
        child = child.nextElementSibling
      }
      for (var key2 in groups) {
        if (groups[key2].length < ge.MIN_GROUP) {
          continue
        }
        var passing = groups[key2].filter(ge.isCandidateItem)
        if (passing.length >= ge.MIN_GROUP) {
          passing.forEach(add)
        }
      }
    }

    return results
  },

  // stable id: the item's first link; fallback to a text hash
  cardId: function (node) {
    var link = node.querySelector('a[href]')
    if (link && link.href && link.href.indexOf('javascript:') !== 0) {
      return link.href
    }
    var text = (node.textContent || '').slice(0, 200)
    var hash = 0
    for (var i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0
    }
    return text ? 'g:' + hash : null
  },

  extractText: function (node) {
    return (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  }
}
