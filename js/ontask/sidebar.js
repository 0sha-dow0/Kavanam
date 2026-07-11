/*
OnTask sidebar — the app shell from ontask-pastel.html.
Hosts the brand, the pinned focus card (task + live subtask), Min's tab
strip (moved here as a vertical rail), the focus timer, and the
end-session control. The session allowlist is seeded by Groq and applied
invisibly — no user-facing editor, so it can't be used to self-bypass.
Reserves horizontal view space via webviews.adjustMargin.
*/

var webviews = require('webviews.js')

const SIDEBAR_WIDTH = 252

const ontaskSidebar = {
  container: document.getElementById('ontask-sidebar'),
  taskEl: document.getElementById('ontask-focus-task'),
  subtaskEl: document.getElementById('ontask-focus-subtask'),
  timerEl: document.getElementById('ontask-timer-val'),
  endButton: document.getElementById('ontask-end-btn'),
  statusBadge: document.getElementById('ontask-status-badge'),
  statusText: document.getElementById('ontask-status-text'),
  startedAt: null,

  updateTimer: function () {
    if (!ontaskSidebar.startedAt) {
      ontaskSidebar.timerEl.textContent = '0m'
      return
    }
    var mins = Math.max(0, Math.round((Date.now() - ontaskSidebar.startedAt) / 60000))
    ontaskSidebar.timerEl.textContent = mins >= 60
      ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm'
      : mins + 'm'
  },

  refresh: function () {
    ipc.invoke('ontask-get-session').then(function (session) {
      if (session) {
        ontaskSidebar.taskEl.textContent = session.task
        ontaskSidebar.subtaskEl.textContent = session.subtask ? 'Now: ' + session.subtask : 'Getting started'
        ontaskSidebar.startedAt = session.startedAt
        // show how the task was understood — a wrong reading should be
        // visible immediately, not silently enforced all session
        var intentEl = document.getElementById('ontask-focus-intent')
        intentEl.textContent = session.expandedIntent ? 'Understood as: ' + session.expandedIntent : ''
        intentEl.hidden = !session.expandedIntent
      } else {
        ontaskSidebar.taskEl.textContent = '—'
        ontaskSidebar.subtaskEl.textContent = 'No session'
        ontaskSidebar.startedAt = null
        ontaskSidebar.statusBadge.hidden = true
      }
      ontaskSidebar.updateTimer()
    })
  },

  currentBand: null,
  blockedFlashTimer: null,

  setPageStatus: function (band) {
    clearTimeout(ontaskSidebar.blockedFlashTimer)
    ontaskSidebar.currentBand = band
    ontaskSidebar.renderStatus(band, false)
  },

  renderStatus: function (band, blockedFlash) {
    if (!band) {
      ontaskSidebar.statusBadge.hidden = true
      ontaskSidebar.statusText.textContent = ''
      return
    }
    ontaskSidebar.statusBadge.hidden = false
    var off = band === 'off'
    var pending = band === 'ambiguous' || band === 'pending'
    ontaskSidebar.statusBadge.classList.toggle('off', off)
    ontaskSidebar.statusText.textContent = blockedFlash ? 'Blocked' : off ? 'Off task' : pending ? 'Checking' : 'On task'
  },

  // a block is an event, not a state: flash it, then show the page's real band
  flashBlocked: function () {
    clearTimeout(ontaskSidebar.blockedFlashTimer)
    ontaskSidebar.renderStatus('off', true)
    ontaskSidebar.blockedFlashTimer = setTimeout(function () {
      ontaskSidebar.renderStatus(ontaskSidebar.currentBand, false)
    }, 2500)
  },

  initialize: function () {
    document.body.classList.add('ontask-shell')

    // move Min's tab strip into the sidebar as the vertical rail
    var tabs = document.getElementById('tabs')
    document.getElementById('ontask-tab-slot').appendChild(tabs)

    ontaskSidebar.container.hidden = false
    webviews.adjustMargin([0, 0, 0, SIDEBAR_WIDTH])

    ontaskSidebar.endButton.addEventListener('click', function () {
      ipc.invoke('ontask-end-session').then(function () {
        window.dispatchEvent(new CustomEvent('ontask-session-changed'))
      })
    })

    // main-process pushes (goal expansion, subtask updates)
    ipc.on('ontask-session-changed', ontaskSidebar.refresh)
    ipc.on('ontask-page-status', function (e, data) {
      ontaskSidebar.setPageStatus(data && data.band)
    })
    ipc.on('ontask-nav-blocked', function (e, data) {
      ontaskSidebar.flashBlocked()
      console.log('ONTASK chrome: navigation blocked', data && data.url)
    })

    // renderer-local changes (intake submit, end session)
    window.addEventListener('ontask-session-changed', ontaskSidebar.refresh)

    setInterval(ontaskSidebar.updateTimer, 30000)
    ontaskSidebar.refresh()
  }
}

module.exports = ontaskSidebar
