/*
OnTask FocusSessionStore — single source of truth for the focus session.
Lives in the main process so every tab shares one task context.
The task is immutable for the session: there is no API to change it once set.
*/

var focusSession = {
  session: null,

  start: function (task) {
    focusSession.session = {
      task: task,
      taskEmbedding: null,
      expandedIntent: null,
      keywords: [],
      subtask: null,
      subtaskEmbedding: null,
      allowlist: [],
      overrides: [],
      startedAt: Date.now()
    }
    console.log('ONTASK session started:', task)
    return focusSession.session
  },

  get: function () {
    return focusSession.session
  },

  isActive: function () {
    return !!focusSession.session
  },

  setSubtask: function (subtask) {
    if (focusSession.session) {
      focusSession.session.subtask = subtask
    }
  },

  end: function () {
    console.log('ONTASK session ended')
    focusSession.session = null
  },

  // serializable view for renderers/preloads (no embeddings)
  publicState: function () {
    if (!focusSession.session) {
      return null
    }
    return {
      task: focusSession.session.task,
      subtask: focusSession.session.subtask,
      keywords: focusSession.session.keywords,
      allowlist: focusSession.session.allowlist,
      startedAt: focusSession.session.startedAt
    }
  }
}

ipc.handle('ontask-get-session', function () {
  return focusSession.publicState()
})

ipc.handle('ontask-start-session', function (e, task) {
  focusSession.start(task)
  return focusSession.publicState()
})

if (process.argv.includes('--ontask-selftest')) {
  focusSession.start('selftest dummy task')
  console.log('ONTASK selftest read-back:', JSON.stringify(focusSession.publicState()))
  focusSession.end()
}
