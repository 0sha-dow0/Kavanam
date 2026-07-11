/*
OnTask SurfaceApplier.
Applies verdicts to DOM nodes: pending items are withheld (fail closed on
ambiguity, Q8), off-task items hidden, on-task revealed. A floating chip
offers the reversible "show anyway" (Q14) and the calm hidden-count.
*/

var ontaskSurfaceApplier = {
  STYLE_ID: 'ontask-style',
  hiddenIds: {},
  revealed: false,
  chip: null,

  ensureStyle: function () {
    if (document.getElementById(ontaskSurfaceApplier.STYLE_ID)) {
      return
    }
    var style = document.createElement('style')
    style.id = ontaskSurfaceApplier.STYLE_ID
    style.textContent =
      '.ontask-pending { visibility: hidden !important; }' +
      '.ontask-hidden { display: none !important; }' +
      'html.ontask-reveal .ontask-hidden { display: revert !important; opacity: .55; }'
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
    }
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
      } else if (v.verdict === 'hide') {
        node.classList.remove('ontask-pending')
        node.classList.add('ontask-hidden')
        ontaskSurfaceApplier.hiddenIds[v.id] = true
      } else if (v.verdict === 'pending') {
        node.classList.add('ontask-pending')
      }
    })
    ontaskSurfaceApplier.updateChip()
  },

  hiddenCount: function () {
    return Object.keys(ontaskSurfaceApplier.hiddenIds).length
  },

  /* reversible one-click "show anyway" (Q14) */
  updateChip: function () {
    var count = ontaskSurfaceApplier.hiddenCount()
    if (!count) {
      if (ontaskSurfaceApplier.chip) {
        ontaskSurfaceApplier.chip.remove()
        ontaskSurfaceApplier.chip = null
      }
      return
    }
    if (!ontaskSurfaceApplier.chip) {
      var chip = document.createElement('button')
      chip.id = 'ontask-chip'
      chip.style.cssText =
        'position:fixed;bottom:18px;right:18px;z-index:2147483647;' +
        'display:flex;align-items:center;gap:7px;padding:9px 15px;border:1px solid #EFE7E0;' +
        'border-radius:999px;background:#FFFFFF;color:#847B85;cursor:pointer;' +
        "font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:12.5px;font-weight:600;" +
        'box-shadow:0 6px 22px -8px rgba(51,43,51,.25);'
      chip.addEventListener('click', function () {
        ontaskSurfaceApplier.revealed = !ontaskSurfaceApplier.revealed
        document.documentElement.classList.toggle('ontask-reveal', ontaskSurfaceApplier.revealed)
        ontaskSurfaceApplier.updateChip()
      })
      document.documentElement.appendChild(chip)
      ontaskSurfaceApplier.chip = chip
    }
    ontaskSurfaceApplier.chip.textContent = ontaskSurfaceApplier.revealed
      ? 'Hide off-task again'
      : count + ' off-task hidden · show anyway'
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
    ontaskSurfaceApplier.revealed = false
    document.documentElement.classList.remove('ontask-reveal')
    ontaskSurfaceApplier.updateChip()
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
