/*
OnTask persistent focus bar.
Pins the session task (and later the live subtask) below the navbar on every
tab. Reads from the main-process FocusSessionStore; reserves view space via
webviews.adjustMargin so page content never sits underneath it.
*/

var webviews = require('webviews.js')

const BAR_HEIGHT = 46

const focusBar = {
  container: document.getElementById('ontask-focus-bar'),
  taskEl: document.getElementById('ontask-focus-task'),
  subtaskEl: document.getElementById('ontask-focus-subtask'),
  visible: false,

  show: function (session) {
    focusBar.taskEl.textContent = session.task
    if (session.subtask) {
      focusBar.subtaskEl.textContent = session.subtask
      focusBar.subtaskEl.hidden = false
    } else {
      focusBar.subtaskEl.hidden = true
    }
    if (!focusBar.visible) {
      focusBar.container.hidden = false
      webviews.adjustMargin([BAR_HEIGHT, 0, 0, 0])
      focusBar.visible = true
    }
  },

  hide: function () {
    if (focusBar.visible) {
      focusBar.container.hidden = true
      webviews.adjustMargin([-BAR_HEIGHT, 0, 0, 0])
      focusBar.visible = false
    }
  },

  refresh: function () {
    ipc.invoke('ontask-get-session').then(function (session) {
      if (session) {
        focusBar.show(session)
      } else {
        focusBar.hide()
      }
    })
  },

  initialize: function () {
    window.addEventListener('ontask-session-changed', focusBar.refresh)
    focusBar.refresh()
  }
}

module.exports = focusBar
