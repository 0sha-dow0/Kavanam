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
  resumeButton: document.getElementById('ontask-intake-resume'),
  resumeTask: document.getElementById('ontask-resume-task'),
  firstRunCard: document.getElementById('ontask-first-run'),
  firstRunOk: document.getElementById('ontask-first-run-ok'),

  show: function () {
    intake.container.hidden = false
    try {
      webviews.requestPlaceholder('ontaskIntake')
    } catch (e) {
      // no tab selected yet at early startup; the request is still registered
    }
    // offer resuming the previous session's task if one was persisted
    ipc.invoke('ontask-get-last-task').then(function (lastTask) {
      if (lastTask && !intake.container.hidden) {
        intake.resumeTask.textContent = lastTask
        intake.resumeButton.hidden = false
      }
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

  onResume: function () {
    intake.startSession(intake.resumeTask.textContent)
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
    intake.resumeButton.addEventListener('click', intake.onResume)
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
