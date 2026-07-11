/*
OnTask Reddit injector — additive Surface 3 for Reddit's home/popular feeds.
Reddit curation itself stays on the generic extractor; this only injects an
"On-task picks" panel with real task-relevant posts (from Reddit's own
search JSON, same-origin) plus on-task search chips as the robust fallback.
No Reddit curation adapter is registered, so the generic extractor keeps
handling what gets hidden.
*/

var ontaskRedditInjector = {
  name: 'reddit',
  id: 'ontask-focus-panel',

  match: function (loc) {
    return /(^|\.)reddit\.com$/.test(loc.hostname)
  },

  // the distraction feeds only — not specific subreddits or post pages
  shouldInject: function (loc) {
    return loc.pathname === '/' || /^\/(r\/(popular|all)|best|hot)\/?$/i.test(loc.pathname)
  },

  anchor: function () {
    return document.querySelector('shreddit-feed') ||
      document.querySelector('shreddit-app main') ||
      (document.querySelector('main') && document.querySelector('main').firstElementChild) ||
      document.querySelector('.content .siteTable')
  },

  searchPath: function (term) {
    return '/search/?q=' + encodeURIComponent(term)
  },

  // best-effort real posts from Reddit's search JSON (same-origin)
  fetchItems: function (query, done) {
    fetch('https://www.reddit.com/search.json?q=' + encodeURIComponent(query) + '&limit=6&sort=relevance', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(function (r) { return r.json() })
      .then(function (json) {
        var children = (json && json.data && json.data.children) || []
        var items = children.map(function (c) {
          var p = c.data || {}
          var thumb = (typeof p.thumbnail === 'string' && p.thumbnail.indexOf('http') === 0) ? p.thumbnail : ''
          return {
            href: p.permalink || ('/comments/' + p.id),
            title: p.title || '',
            channel: (p.subreddit_name_prefixed || '') +
              (typeof p.num_comments === 'number' ? ' · ' + p.num_comments + ' comments' : ''),
            thumb: thumb
          }
        }).filter(function (item) { return item.title && item.href })
        done(items.slice(0, 6))
      })
      .catch(function (err) {
        // fetch failed: the search chips remain as the robust fallback
        console.log('ONTASK reddit injection fell back to chips:', err.message)
        done([])
      })
  }
}

ontaskRegisterInjector(ontaskRedditInjector)
