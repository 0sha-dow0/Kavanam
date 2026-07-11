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

  /* ---------- Surface 3 (additive): inject on-task content ----------
     Parsing helpers for real videos out of YouTube's search HTML; the
     injector itself is registered at the bottom of the file via the shared
     ontaskPanel framework (also used by Reddit and future sites). */

  // parse real videos out of a YouTube search results HTML page
  parseVideos: function (html) {
    var data = ontaskYouTubeAdapter.extractYtInitialData(html)
    if (!data) {
      return []
    }
    var out = []
    ontaskYouTubeAdapter.collectVideoRenderers(data, out)
    return out.slice(0, 4).map(function (v) {
      return { href: '/watch?v=' + v.id, title: v.title, channel: v.channel, thumb: v.thumb, badge: v.length }
    })
  },

  extractYtInitialData: function (html) {
    var marker = 'ytInitialData'
    var from = 0
    while (true) {
      var idx = html.indexOf(marker, from)
      if (idx === -1) {
        return null
      }
      var braceStart = html.indexOf('{', idx)
      if (braceStart === -1) {
        return null
      }
      var between = html.slice(idx + marker.length, braceStart)
      if (between.indexOf('=') !== -1 && between.length < 12) {
        var json = ontaskYouTubeAdapter.scanBalanced(html, braceStart)
        if (json) {
          try {
            return JSON.parse(json)
          } catch (e) {}
        }
      }
      from = idx + marker.length
    }
  },

  scanBalanced: function (s, start) {
    var depth = 0
    var inStr = false
    var esc = false
    for (var i = start; i < s.length; i++) {
      var c = s[i]
      if (inStr) {
        if (esc) {
          esc = false
        } else if (c === '\\') {
          esc = true
        } else if (c === '"') {
          inStr = false
        }
      } else if (c === '"') {
        inStr = true
      } else if (c === '{') {
        depth++
      } else if (c === '}') {
        depth--
        if (depth === 0) {
          return s.slice(start, i + 1)
        }
      }
    }
    return null
  },

  collectVideoRenderers: function (obj, out) {
    if (!obj || typeof obj !== 'object' || out.length >= 12) {
      return
    }
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length && out.length < 12; i++) {
        ontaskYouTubeAdapter.collectVideoRenderers(obj[i], out)
      }
      return
    }
    if (obj.videoRenderer && obj.videoRenderer.videoId) {
      var v = obj.videoRenderer
      out.push({
        id: v.videoId,
        title: (v.title && (v.title.simpleText || (v.title.runs && v.title.runs[0] && v.title.runs[0].text))) || '',
        channel: (v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].text) ||
          (v.longBylineText && v.longBylineText.runs && v.longBylineText.runs[0] && v.longBylineText.runs[0].text) || '',
        thumb: (v.thumbnail && v.thumbnail.thumbnails && v.thumbnail.thumbnails.length)
          ? v.thumbnail.thumbnails[v.thumbnail.thumbnails.length - 1].url : '',
        length: (v.lengthText && v.lengthText.simpleText) || ''
      })
      return
    }
    for (var k in obj) {
      ontaskYouTubeAdapter.collectVideoRenderers(obj[k], out)
    }
  },

  // best-effort real videos from YouTube's own search HTML (same-origin)
  fetchItems: function (query, done) {
    fetch('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), { credentials: 'same-origin' })
      .then(function (r) { return r.text() })
      .then(function (html) { done(ontaskYouTubeAdapter.parseVideos(html)) })
      .catch(function (err) {
        // fetch failed: the search chips remain as the robust fallback
        console.log('ONTASK youtube injection fell back to chips:', err.message)
        done([])
      })
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

ontaskRegisterInjector({
  name: 'youtube',
  id: 'ontask-focus-panel',
  match: function (loc) { return /(^|\.)youtube\.com$/.test(loc.hostname) },
  shouldInject: function (loc) { return loc.pathname === '/' },
  // insert INSIDE the grid's #contents (stable under Polymer reconciliation);
  // a sibling of #primary gets continuously deleted and re-added (flicker)
  anchor: function () {
    var grid = document.querySelector('ytd-rich-grid-renderer')
    if (!grid) {
      return null
    }
    var contents = grid.querySelector('#contents')
    if (contents) {
      return contents.firstElementChild || contents
    }
    return grid
  },
  searchPath: function (term) { return '/results?search_query=' + encodeURIComponent(term) },
  fetchItems: ontaskYouTubeAdapter.fetchItems
})
