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
  MAX_CONTAINERS: 1500,

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
    document.querySelectorAll('[role="list"] > [role="listitem"], main ul > li, main ol > li').forEach(function (node) {
      if (ge.isCandidateItem(node)) {
        add(node)
      }
    })

    // 2) repeated sibling/card structures (tbody covers table-based feeds
    // like Hacker News)
    var all = document.querySelectorAll('main, section, div, ul, ol, tbody')
    var containerCount = Math.min(all.length, ge.MAX_CONTAINERS)
    for (var i = 0; i < containerCount && results.length < ge.MAX_ITEMS; i++) {
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

  // stable id: prefer the item's external destination link (what the card
  // is ABOUT) over same-host utility links; fallback to a text hash
  cardId: function (node) {
    var links = node.querySelectorAll('a[href]')
    var fallback = null
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href
      if (!href || href.indexOf('javascript:') === 0) {
        continue
      }
      if (!fallback) {
        fallback = href
      }
      try {
        if (new URL(href).hostname !== window.location.hostname) {
          return href
        }
      } catch (e) {}
    }
    if (fallback) {
      return fallback
    }
    var text = (node.textContent || '').slice(0, 200)
    var hash = 0
    for (var j = 0; j < text.length; j++) {
      hash = (hash * 31 + text.charCodeAt(j)) | 0
    }
    return text ? 'g:' + hash : null
  },

  extractText: function (node) {
    // join text nodes with spaces: adjacent inline elements otherwise mash
    // ("site.comFree Resume Builder") and poison embeddings and prompts
    var parts = []
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      var value = walker.currentNode.nodeValue.trim()
      if (value) {
        parts.push(value)
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 500)
  },

  // what is this page ABOUT: title + h1 + meta description (for Q15)
  mainContentText: function () {
    var parts = [document.title || '']
    var h1 = document.querySelector('h1')
    if (h1) {
      parts.push(h1.textContent || '')
    }
    var meta = document.querySelector('meta[name="description"], meta[property="og:description"]')
    if (meta) {
      parts.push(meta.getAttribute('content') || '')
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600)
  }
}
