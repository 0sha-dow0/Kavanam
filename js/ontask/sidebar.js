/*
OnTask sidebar — the app shell from ontask-pastel.html.
Hosts the brand, the pinned focus card (task + live subtask), Min's tab
strip (moved here as a vertical rail), the session allowlist editor, the
focus timer, and the end-session control. Reserves horizontal view space
via webviews.adjustMargin.
*/

var webviews = require('webviews.js')
var tabEditor = require('navbar/tabEditor.js')

const SIDEBAR_WIDTH = 252
const COLLAPSED_SIDEBAR_WIDTH = 52
const MOTIVATION_HEIGHT = 38
const IDLE_NUDGE_MS = 5 * 60 * 1000
const IDLE_PAUSE_MS = 10 * 60 * 1000
const MOTIVATION_MESSAGES = [
  'One focused block down. Breathe, reset, and continue.',
  'Steady progress is still progress. Keep the next step small.',
  'Your attention is working. Protect it for one more block.',
  'The work is taking shape, one calm interval at a time.'
]

const ontaskSidebar = {
  container: document.getElementById('ontask-sidebar'),
  taskEl: document.getElementById('ontask-focus-task'),
  subtaskEl: document.getElementById('ontask-focus-subtask'),
  timerEl: document.getElementById('ontask-timer-val'),
  totalTimerEl: document.getElementById('ontask-timer-total'),
  allowlistEl: document.getElementById('ontask-allowlist'),
  allowForm: document.getElementById('ontask-allow-form'),
  allowInput: document.getElementById('ontask-allow-input'),
  endButton: document.getElementById('ontask-end-btn'),
  statusBadge: document.getElementById('ontask-status-badge'),
  statusText: document.getElementById('ontask-status-text'),
  toggleButton: document.getElementById('ontask-sidebar-toggle'),
  blockedPanel: document.getElementById('ontask-blocked'),
  blockedDomain: document.getElementById('ontask-blocked-domain'),
  blockedBack: document.getElementById('ontask-blocked-back'),
  blockedAllow: document.getElementById('ontask-blocked-allow'),
  motivationBanner: document.getElementById('ontask-motivation'),
  motivationMessage: document.getElementById('ontask-motivation-message'),
  motivationClose: document.getElementById('ontask-motivation-close'),
  idlePanel: document.getElementById('ontask-idle-prompt'),
  idleResume: document.getElementById('ontask-idle-resume'),
  openedAt: null,
  totalFocusMs: 0,
  currentFocusMs: 0,
  lastTickAt: null,
  lastActivityAt: Date.now(),
  nextMotivationAt: null,
  idleNudgeShown: false,
  paused: false,
  motivationTimer: null,
  collapsed: false,
  blockedURL: null,

  setCollapsed: function (collapsed, initialize) {
    if (!initialize && ontaskSidebar.collapsed === collapsed) {
      return
    }
    var previousWidth = ontaskSidebar.collapsed ? COLLAPSED_SIDEBAR_WIDTH : SIDEBAR_WIDTH
    var nextWidth = collapsed ? COLLAPSED_SIDEBAR_WIDTH : SIDEBAR_WIDTH
    ontaskSidebar.collapsed = collapsed
    document.body.classList.toggle('ontask-sidebar-collapsed', collapsed)
    ontaskSidebar.toggleButton.textContent = collapsed ? '›' : '‹'
    ontaskSidebar.toggleButton.setAttribute('aria-expanded', String(!collapsed))
    ontaskSidebar.toggleButton.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar')
    ontaskSidebar.toggleButton.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
    localStorage.setItem('ontask-sidebar-collapsed', String(collapsed))
    webviews.adjustMargin([0, 0, 0, initialize ? nextWidth : nextWidth - previousWidth])
  },

  renderAllowlist: function (allowlist) {
    ontaskSidebar.allowlistEl.innerHTML = ''
    ;(allowlist || []).forEach(function (domain) {
      var item = document.createElement('div')
      item.className = 'ontask-allow-item'
      item.tabIndex = 0
      item.setAttribute('role', 'link')
      item.addEventListener('click', function () {
        ontaskSidebar.hideBlocked()
        webviews.update(tabs.getSelected(), 'https://' + domain)
      })
      item.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          item.click()
        }
      })
      var name = document.createElement('span')
      name.textContent = domain
      var remove = document.createElement('button')
      remove.textContent = '×'
      remove.title = 'Remove ' + domain
      remove.addEventListener('click', function (e) {
        e.stopPropagation()
        ipc.invoke('ontask-allowlist-remove', domain).then(ontaskSidebar.renderAllowlist)
      })
      item.appendChild(name)
      item.appendChild(remove)
      ontaskSidebar.allowlistEl.appendChild(item)
    })
  },

  formatDuration: function (milliseconds) {
    var mins = Math.max(0, Math.floor(milliseconds / 60000))
    if (milliseconds > 0 && mins === 0) {
      return '<1m'
    }
    return mins >= 60
      ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm'
      : mins + 'm'
  },

  updateTimer: function () {
    var now = Date.now()
    if (ontaskSidebar.openedAt && ontaskSidebar.lastTickAt && !ontaskSidebar.paused) {
      var activeUntil = Math.min(now, ontaskSidebar.lastActivityAt + IDLE_PAUSE_MS)
      if (activeUntil > ontaskSidebar.lastTickAt) {
        ontaskSidebar.currentFocusMs += activeUntil - ontaskSidebar.lastTickAt
      }
    }
    ontaskSidebar.lastTickAt = now

    if (ontaskSidebar.openedAt && !ontaskSidebar.paused) {
      var inactiveMs = now - ontaskSidebar.lastActivityAt
      if (inactiveMs >= IDLE_PAUSE_MS) {
        ontaskSidebar.pauseForIdle()
      } else if (inactiveMs >= IDLE_NUDGE_MS && !ontaskSidebar.idleNudgeShown) {
        ontaskSidebar.idleNudgeShown = true
        ontaskSidebar.showMotivation('A quiet reset can help. Move, breathe, then choose the next small step.')
      } else if (ontaskSidebar.nextMotivationAt && ontaskSidebar.currentFocusMs >= ontaskSidebar.nextMotivationAt) {
        ontaskSidebar.showMotivation(MOTIVATION_MESSAGES[Math.floor(Math.random() * MOTIVATION_MESSAGES.length)])
        ontaskSidebar.nextMotivationAt = ontaskSidebar.currentFocusMs + ontaskSidebar.randomMotivationDelay()
      }
    }

    ontaskSidebar.timerEl.textContent = ontaskSidebar.formatDuration(ontaskSidebar.currentFocusMs)
    ontaskSidebar.totalTimerEl.textContent = ontaskSidebar.formatDuration(ontaskSidebar.totalFocusMs + ontaskSidebar.currentFocusMs)
  },

  randomMotivationDelay: function () {
    return (8 + Math.random() * 10) * 60 * 1000
  },

  showMotivation: function (message) {
    ontaskSidebar.motivationMessage.textContent = message
    if (ontaskSidebar.motivationBanner.hidden) {
      ontaskSidebar.motivationBanner.hidden = false
      document.body.classList.add('ontask-motivation-visible')
      webviews.adjustMargin([MOTIVATION_HEIGHT, 0, 0, 0])
    }
    clearTimeout(ontaskSidebar.motivationTimer)
    ontaskSidebar.motivationTimer = setTimeout(ontaskSidebar.hideMotivation, 15000)
  },

  hideMotivation: function () {
    if (ontaskSidebar.motivationBanner.hidden) {
      return
    }
    clearTimeout(ontaskSidebar.motivationTimer)
    ontaskSidebar.motivationTimer = null
    ontaskSidebar.motivationBanner.hidden = true
    document.body.classList.remove('ontask-motivation-visible')
    webviews.adjustMargin([-MOTIVATION_HEIGHT, 0, 0, 0])
  },

  recordActivity: function () {
    if (!ontaskSidebar.paused) {
      ontaskSidebar.lastActivityAt = Date.now()
      ontaskSidebar.idleNudgeShown = false
    }
  },

  pauseForIdle: function () {
    if (ontaskSidebar.paused) {
      return
    }
    ontaskSidebar.paused = true
    ontaskSidebar.hideMotivation()
    ontaskSidebar.idlePanel.hidden = false
    document.body.classList.add('ontask-idle-visible')
    webviews.requestPlaceholder('ontaskIdle')
    ipc.send('ontask-focus-heartbeat', ontaskSidebar.currentFocusMs)
  },

  resumeFromIdle: function () {
    if (!ontaskSidebar.paused) {
      return
    }
    var now = Date.now()
    ontaskSidebar.paused = false
    ontaskSidebar.lastActivityAt = now
    ontaskSidebar.lastTickAt = now
    ontaskSidebar.idleNudgeShown = false
    ontaskSidebar.idlePanel.hidden = true
    document.body.classList.remove('ontask-idle-visible')
    webviews.hidePlaceholder('ontaskIdle')
  },

  refresh: function () {
    ipc.invoke('ontask-get-session').then(function (session) {
      if (session) {
        if (ontaskSidebar.openedAt !== session.openedAt) {
          ontaskSidebar.hideMotivation()
          ontaskSidebar.resumeFromIdle()
          ontaskSidebar.currentFocusMs = session.currentFocusMs || 0
          ontaskSidebar.lastTickAt = Date.now()
          ontaskSidebar.lastActivityAt = Date.now()
          ontaskSidebar.nextMotivationAt = ontaskSidebar.currentFocusMs + ontaskSidebar.randomMotivationDelay()
          ontaskSidebar.idleNudgeShown = false
        } else {
          ontaskSidebar.currentFocusMs = Math.max(ontaskSidebar.currentFocusMs, session.currentFocusMs || 0)
        }
        ontaskSidebar.taskEl.textContent = session.task
        ontaskSidebar.subtaskEl.textContent = session.subtask ? 'Now: ' + session.subtask : 'Getting started'
        ontaskSidebar.startedAt = session.startedAt
        // show how the task was understood — a wrong reading should be
        // visible immediately, not silently enforced all session
        var intentEl = document.getElementById('ontask-focus-intent')
        intentEl.textContent = session.expandedIntent ? 'Understood as: ' + session.expandedIntent : ''
        intentEl.hidden = !session.expandedIntent
        ontaskSidebar.openedAt = session.openedAt
        ontaskSidebar.totalFocusMs = session.totalFocusMs || 0
        ontaskSidebar.renderAllowlist(session.allowlist)
      } else {
        ontaskSidebar.hideMotivation()
        ontaskSidebar.resumeFromIdle()
        ontaskSidebar.taskEl.textContent = '—'
        ontaskSidebar.subtaskEl.textContent = 'No session'
        ontaskSidebar.openedAt = null
        ontaskSidebar.totalFocusMs = 0
        ontaskSidebar.currentFocusMs = 0
        ontaskSidebar.lastTickAt = null
        ontaskSidebar.nextMotivationAt = null
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
    var pending = band === 'ambiguous' || band === 'pending'
    ontaskSidebar.statusBadge.classList.toggle('off', off)
    ontaskSidebar.statusText.textContent = off ? 'Off task' : pending ? 'Checking' : 'On task'
  },

  showBlocked: function (url) {
    var domain = 'This destination'
    try {
      domain = new URL(url).hostname.replace(/^www\./, '')
    } catch (e) {}
    ontaskSidebar.blockedURL = url
    ontaskSidebar.blockedDomain.textContent = domain
    ontaskSidebar.blockedPanel.hidden = false
    webviews.requestPlaceholder('ontaskBlocked')
  },

  hideBlocked: function () {
    if (ontaskSidebar.blockedPanel.hidden) {
      return
    }
    ontaskSidebar.blockedPanel.hidden = true
    ontaskSidebar.blockedURL = null
    webviews.hidePlaceholder('ontaskBlocked')
    ontaskSidebar.setPageStatus(null)
  },

  returnToTask: function () {
    ontaskSidebar.hideBlocked()
    var selectedTab = tabs.get(tabs.getSelected())
    if (selectedTab && (!selectedTab.url || selectedTab.url === 'min://newtab' || selectedTab.url === 'min://app/pages/newtab/index.html')) {
      tabEditor.show(selectedTab.id)
    }
  },

  initialize: function () {
    document.body.classList.add('ontask-shell')

    // move Min's tab strip into the sidebar as the vertical rail
    var tabsElement = document.getElementById('tabs')
    document.getElementById('ontask-tab-slot').appendChild(tabsElement)

    ontaskSidebar.container.hidden = false
    ontaskSidebar.setCollapsed(localStorage.getItem('ontask-sidebar-collapsed') === 'true', true)

    ontaskSidebar.toggleButton.addEventListener('click', function () {
      ontaskSidebar.setCollapsed(!ontaskSidebar.collapsed)
    })

    ontaskSidebar.motivationClose.addEventListener('click', ontaskSidebar.hideMotivation)
    ontaskSidebar.idleResume.addEventListener('click', ontaskSidebar.resumeFromIdle)

    ontaskSidebar.blockedBack.addEventListener('click', ontaskSidebar.returnToTask)
    ontaskSidebar.blockedAllow.addEventListener('click', function () {
      var url = ontaskSidebar.blockedURL
      if (!url) {
        return
      }
      var domain
      try {
        domain = new URL(url).hostname
      } catch (e) {
        return
      }
      ipc.invoke('ontask-allowlist-add', domain).then(function () {
        ontaskSidebar.hideBlocked()
        webviews.update(tabs.getSelected(), url)
      })
    })

    ontaskSidebar.endButton.addEventListener('click', function () {
      ontaskSidebar.updateTimer()
      ipc.invoke('ontask-end-session', ontaskSidebar.currentFocusMs).then(function () {
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
      ontaskSidebar.showBlocked(data && data.url)
      console.log('ONTASK chrome: navigation blocked', data && data.url)
    })
    ipc.on('ontask-user-activity', ontaskSidebar.recordActivity)

    ;['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (eventName) {
      window.addEventListener(eventName, ontaskSidebar.recordActivity, { capture: true, passive: true })
    })

    tasks.on('tab-selected', ontaskSidebar.hideBlocked)

    // renderer-local changes (intake submit, end session)
    window.addEventListener('ontask-session-changed', function () {
      ontaskSidebar.hideBlocked()
      ontaskSidebar.refresh()
    })

    setInterval(ontaskSidebar.updateTimer, 1000)
    setInterval(function () {
      ipc.send('ontask-focus-heartbeat', ontaskSidebar.currentFocusMs)
    }, 30000)
    ontaskSidebar.refresh()
  }
}

module.exports = ontaskSidebar
