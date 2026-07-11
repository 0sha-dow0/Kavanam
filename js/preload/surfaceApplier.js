/*
OnTask SurfaceApplier.
Applies verdicts to DOM nodes: injects the hiding stylesheet and toggles
the .ontask-hidden class on cards by id (nodes resolved via DomReader's map).
*/

var ontaskSurfaceApplier = {
  STYLE_ID: 'ontask-style',

  ensureStyle: function () {
    if (document.getElementById(ontaskSurfaceApplier.STYLE_ID)) {
      return
    }
    var style = document.createElement('style')
    style.id = ontaskSurfaceApplier.STYLE_ID
    style.textContent = '.ontask-hidden { display: none !important; }'
    var parent = document.head || document.documentElement
    if (parent) {
      parent.appendChild(style)
    }
  },

  hide: function (id) {
    var node = ontaskDomReader.nodesById[id]
    if (node) {
      ontaskSurfaceApplier.ensureStyle()
      node.classList.add('ontask-hidden')
    }
  },

  show: function (id) {
    var node = ontaskDomReader.nodesById[id]
    if (node) {
      node.classList.remove('ontask-hidden')
    }
  }
}

/* debug handle on the isolated-world global (unreachable from page scripts):
   the sandboxed preload is function-wrapped, so devtools/tests need this to
   reach OnTask internals */
globalThis.ontaskDebug = {
  domReader: ontaskDomReader,
  applier: ontaskSurfaceApplier,
  getAdapter: ontaskGetAdapter,
  activeAdapter: ontaskActiveAdapter
}
