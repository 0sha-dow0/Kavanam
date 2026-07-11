/*
OnTask task-intake screen.
Shown at launch until a focus session exists. Captures one free-text task,
writes it to the main-process FocusSessionStore, then gets out of the way.
Must be initialized before sessionRestore so the placeholder request is in
place before the restored tab's view is shown.
*/

var webviews = require('webviews.js')

const intake = {
  container: document.getElementById('ontask-intake'),
  form: document.getElementById('ontask-intake-form'),
  input: document.getElementById('ontask-intake-input'),
  resumeContainer: document.getElementById('ontask-intake-resume'),
  resumeList: document.getElementById('ontask-resume-list'),
  completedOpen: document.getElementById('ontask-completed-open'),
  completedView: document.getElementById('ontask-completed-view'),
  completedClose: document.getElementById('ontask-completed-close'),
  completedStats: document.getElementById('ontask-completed-stats'),
  completedList: document.getElementById('ontask-completed-list'),
  firstRunCard: document.getElementById('ontask-first-run'),
  firstRunOk: document.getElementById('ontask-first-run-ok'),

  formatDuration: function (milliseconds) {
    var minutes = Math.max(0, Math.round((Number(milliseconds) || 0) / 60000))
    if (milliseconds > 0 && minutes === 0) {
      return '<1 min'
    }
    return minutes >= 60
      ? Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm'
      : minutes + ' min'
  },

  renderCompleted: function (sessions) {
    sessions = sessions || []
    intake.completedOpen.hidden = sessions.length === 0
    intake.completedStats.innerHTML = ''
    intake.completedList.innerHTML = ''
    if (!sessions.length) {
      intake.completedView.hidden = true
      return
    }

    var totalMs = sessions.reduce(function (total, session) {
      return total + (Number(session.totalFocusMs) || 0)
    }, 0)
    var longest = sessions.reduce(function (best, session) {
      return !best || session.totalFocusMs > best.totalFocusMs ? session : best
    }, null)
    ;[
      { label: 'Tasks completed', value: String(sessions.length) },
      { label: 'Focused time', value: intake.formatDuration(totalMs) },
      { label: 'Average per task', value: intake.formatDuration(totalMs / sessions.length) },
      { label: 'Longest focus', value: intake.formatDuration(longest && longest.totalFocusMs) }
    ].forEach(function (stat) {
      var card = document.createElement('div')
      card.className = 'ontask-completed-stat'
      var value = document.createElement('strong')
      value.textContent = stat.value
      var label = document.createElement('span')
      label.textContent = stat.label
      card.appendChild(value)
      card.appendChild(label)
      intake.completedStats.appendChild(card)
    })

    sessions.forEach(function (session) {
      var item = document.createElement('article')
      item.className = 'ontask-completed-item'
      var heading = document.createElement('div')
      heading.className = 'ontask-completed-item-heading'
      var task = document.createElement('h2')
      task.textContent = session.task
      var duration = document.createElement('strong')
      duration.textContent = intake.formatDuration(session.totalFocusMs)
      heading.appendChild(task)
      heading.appendChild(duration)

      var dates = document.createElement('div')
      dates.className = 'ontask-completed-dates'
      dates.textContent = 'Started ' + new Date(session.startedAt).toLocaleDateString([], {
        month: 'short', day: 'numeric', year: 'numeric'
      }) + '  ·  Completed ' + new Date(session.completedAt).toLocaleDateString([], {
        month: 'short', day: 'numeric', year: 'numeric'
      })

      var detail = document.createElement('div')
      detail.className = 'ontask-completed-detail'
      detail.textContent = (session.resumeCount || 0) + ' resumes  ·  ' + (session.pauseCount || 0) + ' pauses'
      item.appendChild(heading)
      item.appendChild(dates)
      item.appendChild(detail)
      intake.completedList.appendChild(item)
    })
  },

  show: function () {
    intake.container.hidden = false
    try {
      webviews.requestPlaceholder('ontaskIntake')
    } catch (e) {
      // no tab selected yet at early startup; the request is still registered
    }
    // offer every persisted session so unfinished work is not lost behind the latest task
    ipc.invoke('ontask-get-sessions').then(function (sessions) {
      intake.resumeList.innerHTML = ''
      ;(sessions || []).forEach(function (session) {
        var button = document.createElement('button')
        button.className = 'ontask-resume-item'
        button.type = 'button'

        var task = document.createElement('span')
        task.className = 'ontask-resume-task'
        task.textContent = session.task

        var meta = document.createElement('span')
        meta.className = 'ontask-resume-meta'
        meta.textContent = 'Last worked ' + new Date(session.updatedAt || session.startedAt).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        })

        button.appendChild(task)
        button.appendChild(meta)
        button.addEventListener('click', function () {
          intake.onResume(session.startedAt)
        })
        intake.resumeList.appendChild(button)
      })
      intake.resumeContainer.hidden = !sessions || sessions.length === 0
    })
    ipc.invoke('ontask-get-completed-sessions').then(intake.renderCompleted)
    // one short first-run card: fallibility + honest data statement (Q37)
    ipc.invoke('ontask-first-run').then(function (isFirstRun) {
      if (isFirstRun && !intake.container.hidden) {
        intake.firstRunCard.hidden = false
      }
    })
    setTimeout(function () {
      intake.input.focus()
    }, 0)
  },

  hide: function () {
    intake.container.hidden = true
    intake.completedView.hidden = true
    webviews.hidePlaceholder('ontaskIntake')

    var centerSearch = document.getElementById('ntp-search-input')
    if (centerSearch && document.body.classList.contains('is-ntp')) {
      centerSearch.focus()
    }
  },

  /*
  A NEW task starts on a clean slate: the previous task's tabs are its
  context and must not carry over (resume keeps them — same task).
  A fresh tab is added first so closing never hits the last-tab case.
  */
  resetWorkspace: function () {
    try {
      var browserUI = require('browserUI.js')
      var oldTabs = tabs.get().map(function (tab) { return tab.id })
      console.log('ONTASK intake: resetting workspace, closing ' + oldTabs.length + ' old tab(s)')
      var fresh = tabs.add()
      browserUI.addTab(fresh)
      browserUI.switchToTab(fresh)
      oldTabs.forEach(function (id) {
        browserUI.destroyTab(id)
      })
      console.log('ONTASK intake: workspace reset, tabs now ' + tabs.get().length)
    } catch (e) {
      console.log('ONTASK intake: workspace reset failed', e.message)
    }
  },

  // true once any session has run this app-launch: only THEN does a new
  // task replace a previous one and need the old tabs cleared. The very
  // first task keeps whatever the user already had open.
  sessionEverStarted: false,

  startSession: async function (task) {
    await ipc.invoke('ontask-start-session', task)
    console.log('ONTASK intake: session started with task:', task)
    if (intake.sessionEverStarted) {
      intake.resetWorkspace()
    }
    intake.sessionEverStarted = true
    intake.hide()
    window.dispatchEvent(new CustomEvent('ontask-session-changed'))
  },

  onSubmit: function (e) {
    e.preventDefault()
    const task = intake.input.value.trim()
    if (!task) {
      intake.input.focus()
      return
    }
    intake.startSession(task)
  },

  onResume: function (startedAt) {
    ipc.invoke('ontask-resume-session', startedAt).then(function () {
      console.log('ONTASK intake: previous session resumed')
      intake.sessionEverStarted = true
      intake.hide()
      window.dispatchEvent(new CustomEvent('ontask-session-changed'))
    })
  },

  initialize: function () {
    // show immediately (a fresh main process never has a session), then
    // reconcile: if the chrome was reloaded mid-session, dismiss the intake
    intake.show()
    ipc.invoke('ontask-get-session').then(function (session) {
      if (session) {
        console.log('ONTASK intake: session already active, skipping intake')
        intake.hide()
      }
    })

    intake.form.addEventListener('submit', intake.onSubmit)
    intake.completedOpen.addEventListener('click', function () {
      intake.completedView.hidden = false
      intake.completedClose.focus()
    })
    intake.completedClose.addEventListener('click', function () {
      intake.completedView.hidden = true
      intake.completedOpen.focus()
    })
    intake.firstRunOk.addEventListener('click', function () {
      ipc.send('ontask-first-run-done')
      intake.firstRunCard.hidden = true
    })

    // ending a session brings the intake back (only path to a new task, Q3)
    window.addEventListener('ontask-session-changed', function () {
      ipc.invoke('ontask-get-session').then(function (session) {
        if (!session && intake.container.hidden) {
          intake.show()
        }
      })
    })
  }
}

module.exports = intake
