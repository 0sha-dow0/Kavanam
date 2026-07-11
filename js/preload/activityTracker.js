/* Reports coarse user activity without recording event details. */

var ontaskLastActivitySent = 0

function ontaskReportActivity () {
  var now = Date.now()
  if (now - ontaskLastActivitySent >= 15000) {
    ontaskLastActivitySent = now
    ipc.send('ontask-user-activity')
  }
}

;['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (eventName) {
  document.addEventListener(eventName, ontaskReportActivity, { capture: true, passive: true })
})

document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    ontaskReportActivity()
  }
})
