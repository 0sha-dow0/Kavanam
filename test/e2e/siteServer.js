const http = require('node:http')

function html (body) {
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="description" content="[ON] Academic thesis writing and research">' +
    '</head><body>' + body + '</body></html>'
}

async function createSiteServer () {
  const requests = {}
  const server = http.createServer(function (req, res) {
    requests[req.url] = (requests[req.url] || 0) + 1
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (req.url === '/on-task/feed') {
      const port = server.address().port
      res.end(html(
        '<title>[ON] Thesis research feed</title>' +
        '<main><h1>[ON] Thesis research and writing references</h1>' +
        '<a id="blocked-nav" href="http://127.0.0.1:' + port + '/off-task/page">Open unrelated entertainment</a>' +
        '<section role="feed">' +
        '<article id="on-card"><a href="/item/on">[ON] Literature review and citation methods for a thesis</a></article>' +
        '<article id="off-card"><a href="/item/off">[OFF] Celebrity gossip and sports highlights today</a></article>' +
        '<article id="ambiguous-card"><a href="/item/ambiguous">[AMBIG] General productivity discussion and advice</a></article>' +
        '<article id="second-on-card"><a href="/item/on-two">[ON] Academic methodology and evidence organization</a></article>' +
        '<article id="unscoreable-card"><a href="/short">short</a></article>' +
        '</section></main>'
      ))
      return
    }
    if (req.url === '/off-task/page') {
      res.end(html('<title>[OFF] Entertainment</title><main><h1>[OFF] Unrelated entertainment page</h1></main>'))
      return
    }
    res.statusCode = 404
    res.end('not found')
  })

  await new Promise(function (resolve, reject) {
    server.once('error', reject)
    server.listen({ host: '::', port: 0, ipv6Only: false }, resolve)
  })

  const port = server.address().port
  return {
    feedURL: 'http://localhost:' + port + '/on-task/feed',
    offTaskURL: 'http://127.0.0.1:' + port + '/off-task/page',
    requestCount: path => requests[path] || 0,
    close: () => new Promise(resolve => server.close(resolve))
  }
}

module.exports = { createSiteServer }
