/*
OnTask adapter registry — getAdapter(host) resolution.
The generic extractor is the DEFAULT; site adapters are an optional
precision layer. A site adapter wins only when it matches the host AND
covers the current page (handles); anything else falls back to generic,
so a broken or partial adapter never disables enforcement.
*/

var ontaskSiteAdapters = []

function ontaskRegisterAdapter (adapter) {
  ontaskSiteAdapters.push(adapter)
}

function ontaskGetAdapter (host) {
  for (var i = 0; i < ontaskSiteAdapters.length; i++) {
    var adapter = ontaskSiteAdapters[i]
    try {
      if (adapter.match(window.location) && (!adapter.handles || adapter.handles(window.location))) {
        return adapter
      }
    } catch (e) {
      // a throwing adapter falls through to the generic path
    }
  }
  return ontaskGenericExtractor
}

function ontaskActiveAdapter () {
  return ontaskGetAdapter(window.location.hostname)
}
