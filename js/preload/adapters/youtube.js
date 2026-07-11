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
      'ytd-rich-grid-renderer ytd-rich-item-renderer',
      // Shorts lockups match directly: their shelf container keeps changing
      'ytm-shorts-lockup-view-model',
      'ytm-shorts-lockup-view-model-v2'
    ],
    search: [
      'ytd-section-list-renderer ytd-video-renderer',
      'ytd-section-list-renderer yt-lockup-view-model',
      'ytm-shorts-lockup-view-model',
      'ytm-shorts-lockup-view-model-v2'
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
    return nodes.filter(function (node, index) {
      return nodes.indexOf(node) === index
    })
  },

  // stable id: the video id from the card's /watch or /shorts link
  cardId: function (node) {
    var link = node.querySelector('a[href*="/watch"], a[href*="/shorts/"]')
    if (link && link.href) {
      try {
        var parsed = new URL(link.href)
        if (parsed.pathname.indexOf('/shorts/') === 0) {
          return parsed.pathname.split('/')[2] || null
        }
        return parsed.searchParams.get('v')
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
    var description = document.querySelector('ytd-watch-metadata #description-inline-expander, #description #content')
    var parts = []
    if (title) {
      parts.push(title.textContent || '')
    }
    if (channel) {
      parts.push(channel.textContent || '')
    }
    if (description) {
      parts.push(description.textContent || '')
    }
    if (!parts.length) {
      return null
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 400)
  },

  autoplayTarget: null,
  autoplayVerdict: null,
  autoplayBusy: false,

  nextTarget: function () {
    var next = document.querySelector('a.ytp-next-button')
    if (!next || !next.href) {
      return null
    }
    var upcoming = document.querySelector(
      '.ytp-autonav-endscreen-upcoming-container, .ytp-upnext, ytd-compact-autoplay-renderer'
    )
    var text = upcoming ? upcoming.textContent : ''
    text = (text || next.getAttribute('aria-label') || next.title || next.href).replace(/\s+/g, ' ').trim()
    return { id: next.href, text: text }
  },

  preflightAutoplay: function () {
    var target = ontaskYouTubeAdapter.nextTarget()
    if (!target || ontaskYouTubeAdapter.autoplayBusy ||
        (target.id === ontaskYouTubeAdapter.autoplayTarget && ontaskYouTubeAdapter.autoplayVerdict)) {
      return
    }
    ontaskYouTubeAdapter.autoplayTarget = target.id
    ontaskYouTubeAdapter.autoplayVerdict = null
    ontaskYouTubeAdapter.autoplayBusy = true
    ontaskBridge.finalVerdict(target.id, target.text).then(function (verdict) {
      if (ontaskYouTubeAdapter.autoplayTarget === target.id) {
        ontaskYouTubeAdapter.autoplayVerdict = verdict
      }
    }).catch(function () {
      ontaskYouTubeAdapter.autoplayVerdict = 'show'
    }).finally(function () {
      ontaskYouTubeAdapter.autoplayBusy = false
    })
  },

  stopAutoplay: function (video) {
    var cancel = document.querySelector(
      '.ytp-autonav-endscreen-upcoming-cancel-button, .ytp-upnext-cancel-button, .ytp-autonav-endscreen-button-container button'
    )
    if (cancel) {
      cancel.click()
    }
    try {
      video.pause()
    } catch (err) {}
  },

  /* Preflight before the video ends. Pending ambiguity remains blocked; a
     scoring outage resolves to show in the main process. */
  init: function () {
    document.addEventListener('timeupdate', function (e) {
      if (e.target && e.target.tagName === 'VIDEO' && e.target.duration - e.target.currentTime < 20) {
        ontaskYouTubeAdapter.preflightAutoplay()
      }
    }, true)
    document.addEventListener('ended', function (e) {
      if (!e.target || e.target.tagName !== 'VIDEO') {
        return
      }
      ontaskYouTubeAdapter.preflightAutoplay()
      if (ontaskYouTubeAdapter.autoplayVerdict !== 'show') {
        console.log('ONTASK autoplay target blocked or pending')
        ontaskYouTubeAdapter.stopAutoplay(e.target)
      }
    }, true)
  }
}

ontaskRegisterAdapter(ontaskYouTubeAdapter)
