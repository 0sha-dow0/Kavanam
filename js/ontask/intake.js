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

  show: function () {
    intake.container.hidden = false
    try {
      webviews.requestPlaceholder('ontaskIntake')
    } catch (e) {
      // no tab selected yet at early startup; the request is still registered
    }
    setTimeout(function () {
      intake.input.focus()
    }, 0)
  },

  hide: function () {
    intake.container.hidden = true
    webviews.hidePlaceholder('ontaskIntake')
  },

  onSubmit: async function (e) {
    e.preventDefault()
    const task = intake.input.value.trim()
    if (!task) {
      intake.input.focus()
      return
    }
    await ipc.invoke('ontask-start-session', task)
    console.log('ONTASK intake: session started with task:', task)
    intake.hide()
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
  }
}

module.exports = intake
