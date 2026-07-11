/*
OnTask SurfaceApplier.
Applies verdicts to DOM nodes: pending items are withheld (fail closed on
ambiguity, Q8), off-task items hidden, on-task revealed. A floating chip
offers the reversible "show anyway" (Q14) and the calm hidden-count.
*/

var ontaskSurfaceApplier = {
  STYLE_ID: 'ontask-style',
  hiddenIds: {},
  controls: {},
  pendingSince: {},
  PENDING_TIMEOUT: 20000,
  watchdogTimer: null,

  ensureStyle: function () {
    if (document.getElementById(ontaskSurfaceApplier.STYLE_ID)) {
      return
    }
    var style = document.createElement('style')
    style.id = ontaskSurfaceApplier.STYLE_ID
    style.textContent =
      '.ontask-pending { visibility: hidden !important; }' +
      '.ontask-hidden { display: none !important; }' +
      '.ontask-override-control { margin:8px 0;padding:7px 12px;border:1px solid #EFE7E0;' +
      'border-radius:999px;background:#fff;color:#847B85;cursor:pointer;font:600 12px system-ui; }' +
      '.ontask-override-visible { opacity:.65 !important; }'
    var parent = document.head || document.documentElement
    if (parent) {
      parent.appendChild(style)
    }
  },

  node: function (id) {
    return ontaskDomReader.nodesById[id]
  },

  markPending: function (id) {
    var node = ontaskSurfaceApplier.node(id)
    if (node) {
      ontaskSurfaceApplier.ensureStyle()
      node.classList.add('ontask-pending')
      ontaskSurfaceApplier.pendingSince[id] = Date.now()
      ontaskSurfaceApplier.armWatchdog()
    }
  },

  /* a verdict can be lost (dropped batch, dying view): withheld items must
     never stay invisible forever — reveal after a deadline (fail open) */
  armWatchdog: function () {
    if (ontaskSurfaceApplier.watchdogTimer) {
      return
    }
    ontaskSurfaceApplier.watchdogTimer = setInterval(function () {
      var now = Date.now()
      var ids = Object.keys(ontaskSurfaceApplier.pendingSince)
      if (!ids.length) {
        clearInterval(ontaskSurfaceApplier.watchdogTimer)
        ontaskSurfaceApplier.watchdogTimer = null
        return
      }
      var expired = ids.filter(function (id) {
        return now - ontaskSurfaceApplier.pendingSince[id] > ontaskSurfaceApplier.PENDING_TIMEOUT
      })
      if (expired.length) {
        console.log('ONTASK pending verdicts timed out, revealing ' + expired.length + ' items')
        ontaskSurfaceApplier.applyVerdicts(expired.map(function (id) {
          return { id: id, verdict: 'show' }
        }))
      }
    }, 5000)
  },

  applyVerdicts: function (verdicts) {
    ontaskSurfaceApplier.ensureStyle()
    verdicts.forEach(function (v) {
      var node = ontaskSurfaceApplier.node(v.id)
      if (!node) {
        return
      }
      if (v.verdict === 'show') {
        node.classList.remove('ontask-pending')
        node.classList.remove('ontask-hidden')
        delete ontaskSurfaceApplier.hiddenIds[v.id]
        delete ontaskSurfaceApplier.pendingSince[v.id]
        ontaskSurfaceApplier.removeControl(v.id)
      } else if (v.verdict === 'hide') {
        node.classList.remove('ontask-pending')
        node.classList.add('ontask-hidden')
        ontaskSurfaceApplier.hiddenIds[v.id] = true
        delete ontaskSurfaceApplier.pendingSince[v.id]
        ontaskSurfaceApplier.ensureControl(v.id, node)
      } else if (v.verdict === 'pending') {
        node.classList.add('ontask-pending')
        ontaskSurfaceApplier.pendingSince[v.id] = Date.now()
        ontaskSurfaceApplier.armWatchdog()
      }
    })
  },

  hiddenCount: function () {
    return Object.keys(ontaskSurfaceApplier.hiddenIds).length
  },

  removeControl: function (id) {
    var control = ontaskSurfaceApplier.controls[id]
    if (control) {
      control.remove()
      delete ontaskSurfaceApplier.controls[id]
    }
  },

  /* Reversible, item-scoped override. One mistake never reveals the feed. */
  ensureControl: function (id, node) {
    if (ontaskSurfaceApplier.controls[id] || !node.parentNode) {
      return
    }
    var control = document.createElement('button')
    control.className = 'ontask-override-control'
    control.textContent = 'Off-task item hidden - show anyway'
    control.addEventListener('click', function () {
      var revealed = node.classList.contains('ontask-hidden')
      node.classList.toggle('ontask-hidden', !revealed)
      node.classList.toggle('ontask-override-visible', revealed)
      control.textContent = revealed ? 'Hide off-task item again' : 'Off-task item hidden - show anyway'
      ipc.invoke(revealed ? 'ontask-override-add' : 'ontask-override-remove', {
        page: window.location.href,
        id: id
      }).catch(function () {})
    })
    node.parentNode.insertBefore(control, node)
    ontaskSurfaceApplier.controls[id] = control
  },

  /* session end: un-hide everything, forget state (Q40) */
  clearAll: function () {
    Object.keys(ontaskDomReader.nodesById).forEach(function (id) {
      var node = ontaskDomReader.nodesById[id]
      if (node && node.classList) {
        node.classList.remove('ontask-pending')
        node.classList.remove('ontask-hidden')
      }
    })
    ontaskSurfaceApplier.hiddenIds = {}
    ontaskSurfaceApplier.pendingSince = {}
    Object.keys(ontaskSurfaceApplier.controls).forEach(ontaskSurfaceApplier.removeControl)
    ontaskSurfaceApplier.controls = {}
  }
}

/* debug handle on the isolated-world global (unreachable from page scripts):
   the sandboxed preload is function-wrapped, so devtools/tests need this to
   reach OnTask internals */
globalThis.ontaskDebug = {
  domReader: ontaskDomReader,
  applier: ontaskSurfaceApplier,
  bridge: ontaskBridge,
  getAdapter: ontaskGetAdapter,
  activeAdapter: ontaskActiveAdapter
}
