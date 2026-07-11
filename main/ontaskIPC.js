/* Trust and input boundary for all OnTask IPC. */
const ontaskIPC = {
  rates: {},

  reject: function () {
    throw new Error('Invalid OnTask IPC request')
  },

  requireChrome: function (event) {
    var sender = event && event.sender
    var frame = event && event.senderFrame
    var trusted = sender && frame && !sender.isDestroyed() &&
      windows.windowFromContents(sender) &&
      frame === sender.mainFrame &&
      sender.getURL() === 'min://app/index.html' &&
      frame.url === 'min://app/index.html'
    if (!trusted) {
      ontaskIPC.reject()
    }
    return sender
  },

  requireContent: function (event) {
    var sender = event && event.sender
    var frame = event && event.senderFrame
    if (!sender || !frame || sender.isDestroyed() ||
        !ontaskNavigationGuard.isWebView(sender) || frame !== sender.mainFrame) {
      ontaskIPC.reject()
    }
    var frameURL = ontaskIPC.canonicalPageURL(frame.url)
    var senderURL = ontaskIPC.canonicalPageURL(sender.getURL())
    if (!frameURL || frameURL !== senderURL) {
      ontaskIPC.reject()
    }
    return { sender: sender, url: senderURL }
  },

  canonicalPageURL: function (value) {
    try {
      var url = new URL(String(value))
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null
      }
      url.hash = ''
      return url.href.slice(0, 2048)
    } catch (e) {
      return null
    }
  },

  cleanText: function (value, max, min) {
    if (typeof value !== 'string') {
      ontaskIPC.reject()
    }
    var text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .replace(/\s+/g, ' ').trim()
    if (text.length < (min || 1) || text.length > max || Buffer.byteLength(text, 'utf8') > max * 4) {
      ontaskIPC.reject()
    }
    return text
  },

  cleanTask: function (value) {
    return ontaskIPC.cleanText(value, 512, 1)
  },

  cleanDomain: function (value) {
    if (typeof value !== 'string' || value.length > 253 || /[\u0000-\u0020\u007F]/.test(value)) {
      ontaskIPC.reject()
    }
    var raw = value.trim().toLowerCase()
    var parsed
    try {
      parsed = new URL(raw.indexOf('://') === -1 ? 'https://' + raw : raw)
    } catch (e) {
      ontaskIPC.reject()
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username || parsed.password || parsed.port ||
        (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
      ontaskIPC.reject()
    }
    var domain = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
    if (!domain || domain.length > 253 || domain.split('.').some(function (label) {
      return !label || label.length > 63 || /^-|-$/.test(label) || !/^[a-z0-9-]+$/i.test(label)
    })) {
      ontaskIPC.reject()
    }
    return domain
  },

  cleanOverride: function (event, value) {
    var content = ontaskIPC.requireContent(event)
    if (!value || typeof value !== 'object') {
      ontaskIPC.reject()
    }
    return {
      page: content.url,
      id: ontaskIPC.cleanText(value.id, 256, 1)
    }
  },

  cleanItems: function (event, payload) {
    var content = ontaskIPC.requireContent(event)
    if (!payload || !Array.isArray(payload.items) || payload.items.length > 50) {
      ontaskIPC.reject()
    }
    // real-world feeds produce occasional duplicate ids and odd items
    // (e.g. two stories by one author sharing a link): skip those items
    // rather than rejecting the whole batch, or one bad card silently
    // disables curation for the entire page
    var seen = {}
    var items = []
    payload.items.forEach(function (item) {
      if (!item || typeof item !== 'object') {
        return
      }
      var clean
      try {
        clean = {
          id: ontaskIPC.cleanText(item.id, 256, 1),
          text: ontaskIPC.cleanText(item.text, 512, 1)
        }
      } catch (e) {
        return
      }
      if (seen[clean.id]) {
        return
      }
      seen[clean.id] = true
      items.push(clean)
    })
    if (Buffer.byteLength(JSON.stringify(items), 'utf8') > 32768) {
      ontaskIPC.reject()
    }
    return { sender: content.sender, url: content.url, items: items }
  },

  take: function (event, bucket, limit, windowMs) {
    var sender = event && event.sender
    if (!sender) {
      ontaskIPC.reject()
    }
    var key = sender.id + ':' + bucket
    var now = Date.now()
    var record = ontaskIPC.rates[key]
    if (!record || now - record.startedAt >= windowMs) {
      record = { startedAt: now, count: 0 }
      ontaskIPC.rates[key] = record
    }
    record.count++
    if (record.count > limit) {
      ontaskIPC.reject()
    }
  }
}
