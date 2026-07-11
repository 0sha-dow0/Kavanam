/*
OnTask sidebar — the app shell from ontask-pastel.html.
Hosts the brand, the pinned focus card (task + live subtask), Min's tab
strip (moved here as a vertical rail), the session allowlist editor, the
focus timer, and the end-session control. Reserves horizontal view space
via webviews.adjustMargin.
*/

var webviews = require('webviews.js')

const SIDEBAR_WIDTH = 252

const ontaskSidebar = {
  container: document.getElementById('ontask-sidebar'),
  taskEl: document.getElementById('ontask-focus-task'),
  subtaskEl: document.getElementById('ontask-focus-subtask'),
  timerEl: document.getElementById('ontask-timer-val'),
  allowlistEl: document.getElementById('ontask-allowlist'),
  allowForm: document.getElementById('ontask-allow-form'),
  allowInput: document.getElementById('ontask-allow-input'),
  endButton: document.getElementById('ontask-end-btn'),
  statusBadge: document.getElementById('ontask-status-badge'),
  statusText: document.getElementById('ontask-status-text'),
  startedAt: null,

  renderAllowlist: function (allowlist) {
    ontaskSidebar.allowlistEl.innerHTML = ''
    ;(allowlist || []).forEach(function (domain) {
      var item = document.createElement('div')
      item.className = 'ontask-allow-item'
      var name = document.createElement('span')
      name.textContent = domain
      var remove = document.createElement('button')
      remove.textContent = '×'
      remove.title = 'Remove ' + domain
      remove.addEventListener('click', function () {
        ipc.invoke('ontask-allowlist-remove', domain).then(ontaskSidebar.renderAllowlist)
      })
      item.appendChild(name)
      item.appendChild(remove)
      ontaskSidebar.allowlistEl.appendChild(item)
    })
  },

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
        ontaskSidebar.renderAllowlist(session.allowlist)
      } else {
        ontaskSidebar.taskEl.textContent = '—'
        ontaskSidebar.subtaskEl.textContent = 'No session'
        ontaskSidebar.startedAt = null
        ontaskSidebar.renderAllowlist([])
        ontaskSidebar.statusBadge.hidden = true
      }
      ontaskSidebar.updateTimer()
    })
  },

  setPageStatus: function (band) {
    if (!band) {
      ontaskSidebar.statusBadge.hidden = true
      return
    }
    ontaskSidebar.statusBadge.hidden = false
    var off = band === 'off'
    ontaskSidebar.statusBadge.classList.toggle('off', off)
    ontaskSidebar.statusText.textContent = off ? 'Off task' : 'On task'
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

    ontaskSidebar.allowForm.addEventListener('submit', function (e) {
      e.preventDefault()
      var domain = ontaskSidebar.allowInput.value.trim()
      if (domain) {
        ipc.invoke('ontask-allowlist-add', domain).then(function (allowlist) {
          ontaskSidebar.allowInput.value = ''
          ontaskSidebar.renderAllowlist(allowlist)
        })
      }
    })

    // main-process pushes (goal expansion, subtask updates)
    ipc.on('ontask-session-changed', ontaskSidebar.refresh)
    ipc.on('ontask-page-status', function (e, data) {
      ontaskSidebar.setPageStatus(data && data.band)
    })
    ipc.on('ontask-nav-blocked', function (e, data) {
      ontaskSidebar.setPageStatus('off')
      console.log('ONTASK chrome: navigation blocked', data && data.url)
    })

    // renderer-local changes (intake submit, end session)
    window.addEventListener('ontask-session-changed', ontaskSidebar.refresh)

    setInterval(ontaskSidebar.updateTimer, 30000)
    ontaskSidebar.refresh()
  }
}

module.exports = ontaskSidebar
