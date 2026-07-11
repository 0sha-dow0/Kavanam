/*
OnTask sidebar — the app shell from ontask-pastel.html.
Hosts the brand, the pinned focus card (task + live subtask), Min's tab
strip (moved here as a vertical rail), session controls, and focus timers.
Reserves horizontal view space via webviews.adjustMargin.
*/

var webviews = require('webviews.js')

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
  focusCard: document.querySelector('.ontask-focus-card'),
  sessionMenuButton: document.getElementById('ontask-session-menu-button'),
  sessionMenu: document.getElementById('ontask-session-menu'),
  pauseButton: document.getElementById('ontask-session-pause'),
  editButton: document.getElementById('ontask-session-edit'),
  endButton: document.getElementById('ontask-session-end'),
  footerEndButton: document.getElementById('ontask-end-btn'),
  editDialog: document.getElementById('ontask-edit-prompt'),
  editForm: document.getElementById('ontask-edit-form'),
  editInput: document.getElementById('ontask-edit-input'),
  editCancel: document.getElementById('ontask-edit-cancel'),
  endDialog: document.getElementById('ontask-end-confirm'),
  endCancel: document.getElementById('ontask-end-cancel'),
  endConfirm: document.getElementById('ontask-end-confirm-button'),
  statusBadge: document.getElementById('ontask-status-badge'),
  statusText: document.getElementById('ontask-status-text'),
  toggleButton: document.getElementById('ontask-sidebar-toggle'),
  blockedPanel: document.getElementById('ontask-blocked'),
  blockedDomain: document.getElementById('ontask-blocked-domain'),
  blockedBack: document.getElementById('ontask-blocked-back'),
  motivationBanner: document.getElementById('ontask-motivation'),
  motivationMessage: document.getElementById('ontask-motivation-message'),
  motivationClose: document.getElementById('ontask-motivation-close'),
  curationPanel: document.getElementById('ontask-curation'),
  curationCount: document.getElementById('ontask-curation-count'),
  curationProgress: document.getElementById('ontask-curation-progress'),
  idlePanel: document.getElementById('ontask-idle-prompt'),
  idleResume: document.getElementById('ontask-idle-resume'),
  manualPausePanel: document.getElementById('ontask-manual-pause'),
  manualResume: document.getElementById('ontask-manual-resume'),
  openedAt: null,
  totalFocusMs: 0,
  currentFocusMs: 0,
  lastTickAt: null,
  lastActivityAt: Date.now(),
  nextMotivationAt: null,
  idleNudgeShown: false,
  paused: false,
  pauseReason: null,
  motivationTimer: null,
  curationId: null,
  curationTimer: null,
  curationShownAt: 0,
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

  setSessionMenuOpen: function (open) {
    ontaskSidebar.sessionMenu.hidden = !open
    ontaskSidebar.sessionMenuButton.setAttribute('aria-expanded', String(open))
  },

  renderPauseState: function () {
    ontaskSidebar.focusCard.classList.toggle('paused', ontaskSidebar.paused)
    ontaskSidebar.pauseButton.textContent = ontaskSidebar.paused ? 'Resume session' : 'Pause session'
  },

  pauseManually: function () {
    ontaskSidebar.updateTimer()
    ontaskSidebar.paused = true
    ontaskSidebar.pauseReason = 'manual'
    ontaskSidebar.lastTickAt = Date.now()
    ontaskSidebar.renderPauseState()
    ontaskSidebar.manualPausePanel.hidden = false
    webviews.requestPlaceholder('ontaskManualPause')
    ontaskSidebar.manualResume.focus()
    ipc.invoke('ontask-set-paused', true, ontaskSidebar.currentFocusMs)
  },

  resumeManually: function () {
    var now = Date.now()
    ontaskSidebar.paused = false
    ontaskSidebar.pauseReason = null
    ontaskSidebar.lastActivityAt = now
    ontaskSidebar.lastTickAt = now
    ontaskSidebar.idleNudgeShown = false
    ontaskSidebar.renderPauseState()
    ontaskSidebar.manualPausePanel.hidden = true
    webviews.hidePlaceholder('ontaskManualPause')
    ipc.invoke('ontask-set-paused', false, ontaskSidebar.currentFocusMs)
  },

  toggleManualPause: function () {
    ontaskSidebar.setSessionMenuOpen(false)
    if (ontaskSidebar.paused) {
      if (ontaskSidebar.pauseReason === 'idle') {
        ontaskSidebar.resumeFromIdle()
      } else {
        ontaskSidebar.resumeManually()
      }
    } else {
      ontaskSidebar.pauseManually()
    }
  },

  showEditDialog: function () {
    ontaskSidebar.setSessionMenuOpen(false)
    ontaskSidebar.editInput.value = ontaskSidebar.taskEl.textContent
    ontaskSidebar.editDialog.hidden = false
    webviews.requestPlaceholder('ontaskEditPrompt')
    setTimeout(function () {
      ontaskSidebar.editInput.focus()
      ontaskSidebar.editInput.select()
    }, 0)
  },

  hideEditDialog: function () {
    if (!ontaskSidebar.editDialog.hidden) {
      ontaskSidebar.editDialog.hidden = true
      webviews.hidePlaceholder('ontaskEditPrompt')
    }
  },

  showEndDialog: function () {
    ontaskSidebar.setSessionMenuOpen(false)
    ontaskSidebar.endDialog.hidden = false
    webviews.requestPlaceholder('ontaskEndConfirm')
    ontaskSidebar.endConfirm.focus()
  },

  hideEndDialog: function () {
    if (!ontaskSidebar.endDialog.hidden) {
      ontaskSidebar.endDialog.hidden = true
      webviews.hidePlaceholder('ontaskEndConfirm')
    }
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

  selectedPageMatches: function (url) {
    var selected = tabs.get(tabs.getSelected())
    if (!selected || !selected.url) {
      return false
    }
    try {
      var expected = new URL(url)
      var actual = new URL(selected.url)
      expected.hash = ''
      actual.hash = ''
      return expected.href === actual.href
    } catch (e) {
      return selected.url === url
    }
  },

  showCuration: function (data) {
    if (!data || !data.id || !ontaskSidebar.selectedPageMatches(data.url)) {
      return
    }
    var total = Math.max(1, Number(data.total) || 1)
    var completed = Math.min(total, Math.max(0, Number(data.completed) || 0))
    var percentage = Math.round((completed / total) * 100)
    if (ontaskSidebar.curationPanel.hidden || ontaskSidebar.curationId !== data.id) {
      ontaskSidebar.curationId = data.id
      ontaskSidebar.curationShownAt = Date.now()
      ontaskSidebar.curationPanel.hidden = false
      webviews.requestPlaceholder('ontaskCuration')
    }
    ontaskSidebar.curationProgress.style.width = percentage + '%'
    ontaskSidebar.curationCount.textContent = data.phase === 'complete'
      ? total + ' recommendations curated'
      : completed + ' of ' + total + ' recommendations reviewed'
    clearTimeout(ontaskSidebar.curationTimer)
    if (data.phase === 'complete') {
      var remaining = Math.max(350, 900 - (Date.now() - ontaskSidebar.curationShownAt))
      ontaskSidebar.curationTimer = setTimeout(ontaskSidebar.hideCuration, remaining)
    } else {
      ontaskSidebar.curationTimer = setTimeout(ontaskSidebar.hideCuration, 25000)
    }
  },

  hideCuration: function () {
    clearTimeout(ontaskSidebar.curationTimer)
    ontaskSidebar.curationTimer = null
    ontaskSidebar.curationId = null
    if (!ontaskSidebar.curationPanel.hidden) {
      ontaskSidebar.curationPanel.hidden = true
      webviews.hidePlaceholder('ontaskCuration')
    }
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
    ontaskSidebar.pauseReason = 'idle'
    ontaskSidebar.renderPauseState()
    ontaskSidebar.hideMotivation()
    ontaskSidebar.idlePanel.hidden = false
    document.body.classList.add('ontask-idle-visible')
    webviews.requestPlaceholder('ontaskIdle')
    ipc.invoke('ontask-set-paused', true, ontaskSidebar.currentFocusMs)
  },

  resumeFromIdle: function () {
    if (!ontaskSidebar.paused) {
      return
    }
    var now = Date.now()
    ontaskSidebar.paused = false
    ontaskSidebar.pauseReason = null
    ontaskSidebar.lastActivityAt = now
    ontaskSidebar.lastTickAt = now
    ontaskSidebar.idleNudgeShown = false
    ontaskSidebar.idlePanel.hidden = true
    document.body.classList.remove('ontask-idle-visible')
    webviews.hidePlaceholder('ontaskIdle')
    ontaskSidebar.renderPauseState()
    ipc.invoke('ontask-set-paused', false, ontaskSidebar.currentFocusMs)
  },

  refresh: function () {
    ipc.invoke('ontask-get-session').then(function (session) {
      if (session) {
        if (ontaskSidebar.openedAt !== session.openedAt) {
          ontaskSidebar.hideMotivation()
          if (!ontaskSidebar.idlePanel.hidden) {
            ontaskSidebar.idlePanel.hidden = true
            document.body.classList.remove('ontask-idle-visible')
            webviews.hidePlaceholder('ontaskIdle')
          }
          ontaskSidebar.currentFocusMs = session.currentFocusMs || 0
          ontaskSidebar.lastTickAt = Date.now()
          ontaskSidebar.lastActivityAt = Date.now()
          ontaskSidebar.nextMotivationAt = ontaskSidebar.currentFocusMs + ontaskSidebar.randomMotivationDelay()
          ontaskSidebar.idleNudgeShown = false
          ontaskSidebar.paused = !!session.paused
          ontaskSidebar.pauseReason = session.paused ? 'manual' : null
          ontaskSidebar.renderPauseState()
          ontaskSidebar.manualPausePanel.hidden = !session.paused
          if (session.paused) {
            webviews.requestPlaceholder('ontaskManualPause')
          } else {
            webviews.hidePlaceholder('ontaskManualPause')
          }
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
        ontaskSidebar.paused = false
        ontaskSidebar.pauseReason = null
        ontaskSidebar.renderPauseState()
        ontaskSidebar.manualPausePanel.hidden = true
        webviews.hidePlaceholder('ontaskManualPause')
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
    var centerSearch = document.getElementById('ntp-search-input')
    if (centerSearch && document.body.classList.contains('is-ntp')) {
      centerSearch.focus()
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

    ontaskSidebar.sessionMenuButton.addEventListener('click', function (e) {
      e.stopPropagation()
      ontaskSidebar.setSessionMenuOpen(ontaskSidebar.sessionMenu.hidden)
    })
    ontaskSidebar.sessionMenu.addEventListener('click', function (e) {
      e.stopPropagation()
    })
    ontaskSidebar.pauseButton.addEventListener('click', ontaskSidebar.toggleManualPause)
    ontaskSidebar.manualResume.addEventListener('click', ontaskSidebar.resumeManually)
    ontaskSidebar.editButton.addEventListener('click', ontaskSidebar.showEditDialog)
    ontaskSidebar.endButton.addEventListener('click', ontaskSidebar.showEndDialog)
    ontaskSidebar.footerEndButton.addEventListener('click', function () {
      ontaskSidebar.updateTimer()
      ipc.invoke('ontask-leave-session', ontaskSidebar.currentFocusMs).then(function () {
        window.dispatchEvent(new CustomEvent('ontask-session-changed'))
      })
    })
    ontaskSidebar.editCancel.addEventListener('click', ontaskSidebar.hideEditDialog)
    ontaskSidebar.endCancel.addEventListener('click', ontaskSidebar.hideEndDialog)
    ontaskSidebar.editForm.addEventListener('submit', function (e) {
      e.preventDefault()
      var task = ontaskSidebar.editInput.value.trim()
      if (!task) {
        ontaskSidebar.editInput.focus()
        return
      }
      ipc.invoke('ontask-edit-session', task).then(function () {
        ontaskSidebar.hideEditDialog()
        window.dispatchEvent(new CustomEvent('ontask-session-changed'))
      })
    })
    ontaskSidebar.endConfirm.addEventListener('click', function () {
      ontaskSidebar.updateTimer()
      ipc.invoke('ontask-end-session', ontaskSidebar.currentFocusMs).then(function () {
        ontaskSidebar.hideEndDialog()
        window.dispatchEvent(new CustomEvent('ontask-session-changed'))
      })
    })
    document.addEventListener('click', function () {
      ontaskSidebar.setSessionMenuOpen(false)
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
    ipc.on('ontask-curation-progress', function (e, data) {
      ontaskSidebar.showCuration(data)
    })

    ;['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (eventName) {
      window.addEventListener(eventName, ontaskSidebar.recordActivity, { capture: true, passive: true })
    })

    tasks.on('tab-selected', ontaskSidebar.hideBlocked)
    tasks.on('tab-selected', ontaskSidebar.hideCuration)

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
