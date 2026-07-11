/*
OnTask shared injection panel — the "On-task picks" surface, site-agnostic.
Any site injector (YouTube, Reddit, …) provides its own anchor, search path,
and a fetch that fills real on-task items; this builds the styled card,
the item grid, and the always-present on-task search chips. The chips are
the robust fallback: even if a site's item fetch fails, the user still gets
clickable on-task search entries.
*/

var ontaskPanel = {
  ensureStyle: function () {
    if (document.getElementById('ontask-panel-style')) {
      return
    }
    var style = document.createElement('style')
    style.id = 'ontask-panel-style'
    style.textContent =
      '.ontask-panel{font-family:"Roboto","Plus Jakarta Sans",system-ui,sans-serif;' +
      'background:#faf7f3;border:1px solid #efe0e6;border-radius:16px;padding:18px 20px 20px;' +
      'margin:0 0 22px 0;box-shadow:0 10px 30px -18px rgba(51,43,51,.4);color:#2c2733;}' +
      '.ontask-panel .otp-head{display:flex;align-items:center;gap:9px;margin-bottom:3px;}' +
      '.ontask-panel .otp-mark{width:22px;height:22px;border-radius:7px;background:#fbe8f0;' +
      'display:grid;place-items:center;color:#b84268;font-size:13px;flex-shrink:0;}' +
      '.ontask-panel .otp-title{font-size:15px;font-weight:700;letter-spacing:-.01em;}' +
      '.ontask-panel .otp-title b{color:#b84268;}' +
      '.ontask-panel .otp-sub{font-size:12.5px;color:#7a7280;margin:2px 0 15px 31px;}' +
      '.ontask-panel .otp-items{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));' +
      'gap:14px;margin-bottom:14px;}' +
      '.ontask-panel .otp-items:empty{display:none;}' +
      '.ontask-panel .otp-card{text-decoration:none;color:inherit;display:block;}' +
      '.ontask-panel .otp-thumb{position:relative;width:100%;aspect-ratio:16/9;border-radius:11px;' +
      'overflow:hidden;background:#efe7e0;}' +
      '.ontask-panel .otp-thumb img{width:100%;height:100%;object-fit:cover;display:block;}' +
      '.ontask-panel .otp-badge{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.8);' +
      'color:#fff;font-size:11px;font-weight:600;padding:1px 5px;border-radius:5px;}' +
      '.ontask-panel .otp-textcard{background:#fff;border:1px solid #f0e7e2;border-radius:11px;padding:12px 13px;}' +
      '.ontask-panel .otp-vt{font-size:13px;font-weight:600;line-height:1.3;margin:8px 2px 2px;' +
      'display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}' +
      '.ontask-panel .otp-textcard .otp-vt{margin-top:0;}' +
      '.ontask-panel .otp-vc{font-size:12px;color:#7a7280;margin:6px 2px 0;}' +
      '.ontask-panel .otp-chips-label{font-size:11.5px;font-weight:700;letter-spacing:.07em;' +
      'text-transform:uppercase;color:#a89fb0;margin:0 0 9px 1px;}' +
      '.ontask-panel .otp-chips{display:flex;flex-wrap:wrap;gap:8px;}' +
      '.ontask-panel .otp-chip{text-decoration:none;font-size:13px;font-weight:600;color:#b84268;' +
      'background:#fff;border:1px solid #f0dbe3;border-radius:999px;padding:7px 14px;transition:all .15s;}' +
      '.ontask-panel .otp-chip:hover{background:#fbe8f0;border-color:#e8799f;}'
    ;(document.head || document.documentElement).appendChild(style)
  },

  /*
  config: { id, task, intent, terms, searchPath(term) -> href }
  returns { panel, itemsEl } — caller fills itemsEl with ontaskPanel.card()
  */
  build: function (config) {
    ontaskPanel.ensureStyle()
    var panel = document.createElement('div')
    panel.id = config.id
    panel.className = 'ontask-panel'

    var head = document.createElement('div')
    head.className = 'otp-head'
    var mark = document.createElement('span')
    mark.className = 'otp-mark'
    mark.textContent = '◎'
    var title = document.createElement('div')
    title.className = 'otp-title'
    title.appendChild(document.createTextNode('On-task picks for '))
    var b = document.createElement('b')
    b.textContent = '“' + config.task + '”'
    title.appendChild(b)
    head.appendChild(mark)
    head.appendChild(title)
    panel.appendChild(head)

    if (config.intent) {
      var sub = document.createElement('div')
      sub.className = 'otp-sub'
      sub.textContent = config.intent
      panel.appendChild(sub)
    }

    var items = document.createElement('div')
    items.className = 'otp-items'
    panel.appendChild(items)

    if (config.terms && config.terms.length && config.searchPath) {
      var chipLabel = document.createElement('div')
      chipLabel.className = 'otp-chips-label'
      chipLabel.textContent = 'Search on-task'
      panel.appendChild(chipLabel)
      var chips = document.createElement('div')
      chips.className = 'otp-chips'
      config.terms.forEach(function (term) {
        var chip = document.createElement('a')
        chip.className = 'otp-chip'
        chip.href = config.searchPath(term)
        chip.textContent = term
        chips.appendChild(chip)
      })
      panel.appendChild(chips)
    }

    return { panel: panel, itemsEl: items }
  },

  // item: { href, title, channel, thumb, badge }  (thumb/badge optional -> text card)
  card: function (item) {
    var card = document.createElement('a')
    card.className = 'otp-card'
    card.href = item.href
    if (item.thumb) {
      var thumb = document.createElement('div')
      thumb.className = 'otp-thumb'
      var img = document.createElement('img')
      img.src = item.thumb
      img.loading = 'lazy'
      thumb.appendChild(img)
      if (item.badge) {
        var badge = document.createElement('span')
        badge.className = 'otp-badge'
        badge.textContent = item.badge
        thumb.appendChild(badge)
      }
      card.appendChild(thumb)
      var vt = document.createElement('div')
      vt.className = 'otp-vt'
      vt.textContent = item.title
      card.appendChild(vt)
      if (item.channel) {
        var vc = document.createElement('div')
        vc.className = 'otp-vc'
        vc.textContent = item.channel
        card.appendChild(vc)
      }
    } else {
      // thumbnail-less items (e.g. link posts) render as a text card
      var box = document.createElement('div')
      box.className = 'otp-textcard'
      var t = document.createElement('div')
      t.className = 'otp-vt'
      t.textContent = item.title
      box.appendChild(t)
      if (item.channel) {
        var c = document.createElement('div')
        c.className = 'otp-vc'
        c.textContent = item.channel
        box.appendChild(c)
      }
      card.appendChild(box)
    }
    return card
  }
}

/*
Generic injector driver: an injector declares match(loc), an anchor to
insert before, term->searchPath, and a fetch that fills real items. This
handles idempotency (one panel per page), suggestion lookup, and cleanup.
*/
var ontaskInjectors = []

function ontaskRegisterInjector (injector) {
  ontaskInjectors.push(injector)
}

var ontaskInjectState = { busy: {}, token: 0, cache: {} }

// SPA feeds (Reddit, YouTube) re-render and can wipe an injected sibling;
// a light heartbeat re-adds it whenever it goes missing, even during the
// site's quiet periods when no DOM mutation would trigger a re-run.
var ontaskInjectWatch = null
function ontaskEnsureInjectorWatch () {
  if (ontaskInjectWatch) {
    return
  }
  ontaskInjectWatch = setInterval(function () {
    if (typeof ontaskBridge !== 'undefined' && ontaskBridge.statusCache && ontaskBridge.statusCache.enforcing) {
      ontaskRunInjectors()
    }
  }, 1500)
}

function ontaskRunInjectors () {
  ontaskInjectors.forEach(function (inj) {
    try {
      if (!inj.match(window.location)) {
        ontaskPanelRemove(inj.id)
        return
      }
      ontaskInjectOne(inj)
    } catch (e) {
      console.log('ONTASK injector error (no-op):', e.message)
    }
  })
}

function ontaskPanelRemove (id) {
  var existing = document.getElementById(id)
  if (existing) {
    existing.remove()
  }
}

function ontaskInjectOne (inj) {
  if (!inj.shouldInject(window.location)) {
    ontaskPanelRemove(inj.id)
    return
  }
  if (document.getElementById(inj.id) || ontaskInjectState.busy[inj.name]) {
    return
  }
  if (!inj.anchor()) {
    return
  }
  ontaskInjectState.busy[inj.name] = true
  ontaskBridge.getSuggestions(function (data) {
    ontaskInjectState.busy[inj.name] = false
    if (!data || !data.task || !inj.shouldInject(window.location)) {
      return
    }
    if (document.getElementById(inj.id)) {
      return
    }
    var anchor = inj.anchor()
    if (!anchor || !anchor.parentNode) {
      return
    }
    var built = ontaskPanel.build({
      id: inj.id,
      task: data.task,
      intent: data.intent,
      terms: data.terms,
      searchPath: inj.searchPath
    })
    anchor.parentNode.insertBefore(built.panel, anchor)

    var query = (data.terms && data.terms[0]) || data.task
    var cached = ontaskInjectState.cache[inj.name]
    // reuse fetched items when re-injecting after an SPA wipe (same query):
    // no re-fetch, no flicker
    if (cached && cached.query === query && cached.items.length) {
      ontaskPanelFill(built.itemsEl, cached.items)
      return
    }
    var token = ++ontaskInjectState.token
    inj.fetchItems(query, function (items) {
      items = (items || []).filter(function (i) { return i && i.href && i.title })
      ontaskInjectState.cache[inj.name] = { query: query, items: items }
      if (token !== ontaskInjectState.token || !built.itemsEl.isConnected) {
        return
      }
      ontaskPanelFill(built.itemsEl, items)
      console.log('ONTASK injected ' + items.length + ' on-task items on ' + inj.name)
    })
  })
}

function ontaskPanelFill (itemsEl, items) {
  items.forEach(function (item) {
    itemsEl.appendChild(ontaskPanel.card(item))
  })
}

// task change / session end: remove every injected panel and its cache
function ontaskClearInjectors () {
  ontaskInjectors.forEach(function (inj) {
    ontaskPanelRemove(inj.id)
  })
  ontaskInjectState.cache = {}
  ontaskInjectState.token++
}
