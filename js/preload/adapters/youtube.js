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
    if (loc.pathname === '/') {
      return 'home'
    }
    if (loc.pathname === '/results') {
      return 'search'
    }
    return null
  },

  recommendationSelectors: {
    watch: [
      'ytd-watch-next-secondary-results-renderer yt-lockup-view-model',
      'ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer'
    ],
    home: [
      'ytd-rich-grid-renderer ytd-rich-item-renderer'
    ],
    search: [
      'ytd-section-list-renderer ytd-video-renderer',
      'ytd-section-list-renderer yt-lockup-view-model'
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
  },

  // watch page: video title + channel drive the primary-content judgment (Q15)
  mainContentText: function () {
    if (ontaskYouTubeAdapter.surface(window.location) !== 'watch') {
      return null
    }
    var title = document.querySelector('ytd-watch-metadata h1, h1.ytd-watch-metadata, #title h1')
    var channel = document.querySelector('ytd-watch-metadata #channel-name, #owner #channel-name')
    var parts = []
    if (title) {
      parts.push(title.textContent || '')
    }
    if (channel) {
      parts.push(channel.textContent || '')
    }
    if (!parts.length) {
      return null
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 400)
  },

  /* autoplay interception (Q24): when a video ends, judge the queued next
     target; off-task -> cancel the countdown and pause. The navigation
     guard's primary-content check is the backstop if it slips through. */
  init: function () {
    document.addEventListener('ended', function (e) {
      if (!e.target || e.target.tagName !== 'VIDEO') {
        return
      }
      var video = e.target
      var next = document.querySelector('a.ytp-next-button')
      var nextText = next ? (next.getAttribute('aria-label') || next.title || next.href || '') : ''
      if (!nextText) {
        return
      }
      ontaskBridge.scoreText(nextText).then(function (result) {
        if (result && result.band === 'off') {
          console.log('ONTASK autoplay target off-task, stopping:', nextText.slice(0, 80))
          var cancel = document.querySelector(
            '.ytp-autonav-endscreen-upcoming-cancel-button, .ytp-upnext-cancel-button, .ytp-autonav-endscreen-button-container button'
          )
          if (cancel) {
            cancel.click()
          }
          try {
            video.pause()
          } catch (err) {}
        }
      }).catch(function () {})
    }, true)
  }
}

ontaskRegisterAdapter(ontaskYouTubeAdapter)
