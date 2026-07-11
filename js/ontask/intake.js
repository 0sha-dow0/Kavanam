/*
OnTask task-intake screen.
Shown at launch until a focus session exists. Captures one free-text task,
writes it to the main-process FocusSessionStore, then gets out of the way.
Must be initialized before sessionRestore so the placeholder request is in
place before the restored tab's view is shown.
*/

var webviews = require('webviews.js')
var tabEditor = require('navbar/tabEditor.js')

const intake = {
  container: document.getElementById('ontask-intake'),
  form: document.getElementById('ontask-intake-form'),
  input: document.getElementById('ontask-intake-input'),
  resumeContainer: document.getElementById('ontask-intake-resume'),
  resumeList: document.getElementById('ontask-resume-list'),
  firstRunCard: document.getElementById('ontask-first-run'),
  firstRunOk: document.getElementById('ontask-first-run-ok'),

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
    webviews.hidePlaceholder('ontaskIntake')

    var selectedTab = tabs.get(tabs.getSelected())
    if (selectedTab && (!selectedTab.url || selectedTab.url === 'min://newtab' || selectedTab.url === 'min://app/pages/newtab/index.html')) {
      tabEditor.show(selectedTab.id)
    }
  },

  startSession: async function (task) {
    await ipc.invoke('ontask-start-session', task)
    console.log('ONTASK intake: session started with task:', task)
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
