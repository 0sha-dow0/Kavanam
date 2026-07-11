/*
OnTask YouTube adapter — an OPTIONAL precision layer over the generic
extractor, kept because the 90-second demo needs one bulletproof surface.
Declares which DOM nodes are recommendation cards and how to read them.
Tuned surface: the watch page (home and search are added in Phase 5);
pages it doesn't cover fall back to the generic extractor via the registry.
Selectors verified against the live YouTube DOM (yt-lockup-view-model cards);
ytd-compact-video-renderer kept as a fallback for older layouts.
*/

var ontaskYouTubeAdapter = {
  name: 'youtube',

  match: function (loc) {
    return /(^|\.)youtube\.com$/.test(loc.hostname)
  },

  // only claim pages this adapter actually covers; others go generic
  handles: function (loc) {
    return ontaskYouTubeAdapter.surface(loc) !== null
  },

  surface: function (loc) {
    if (loc.pathname === '/watch') {
      return 'watch'
    }
    return null
  },

  recommendationSelectors: {
    watch: [
      'ytd-watch-next-secondary-results-renderer yt-lockup-view-model',
      'ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer'
    ]
  },

  getRecommendationCards: function () {
    var surface = ontaskYouTubeAdapter.surface(window.location)
    if (!surface) {
      return []
    }
    var nodes = []
    var selectors = ontaskYouTubeAdapter.recommendationSelectors[surface] || []
    selectors.forEach(function (selector) {
      try {
        nodes = nodes.concat(Array.from(document.querySelectorAll(selector)))
      } catch (e) {
        // broken selector: silent no-op on this surface (Q29)
      }
    })
    return nodes
  },

  // stable id: the video id from the card's /watch link
  cardId: function (node) {
    var link = node.querySelector('a[href*="/watch"]')
    if (link && link.href) {
      try {
        return new URL(link.href).searchParams.get('v')
      } catch (e) {}
    }
    return null
  },

  // maximal cheap context (Q9): title + channel + metadata as rendered
  extractText: function (node) {
    var text = node.innerText || ''
    return text.replace(/\s+/g, ' ').trim()
  }
}

ontaskRegisterAdapter(ontaskYouTubeAdapter)
