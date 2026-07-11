/*
OnTask persistence — stores the task (plus allowlist/overrides snapshot and a
short task history) in userData so a relaunch can offer resume-or-new.
Uses the shared fs/path/app/ipc from the concatenated main bundle.
*/

const ontaskPersistence = {
  data: null,

  filePath: function () {
    return path.join(app.getPath('userData'), 'ontask.json')
  },

  load: function () {
    if (ontaskPersistence.data) {
      return
    }
    try {
      ontaskPersistence.data = JSON.parse(fs.readFileSync(ontaskPersistence.filePath(), 'utf-8'))
    } catch (e) {
      ontaskPersistence.data = { lastSession: null, history: [] }
    }
  },

  save: function () {
    try {
      fs.writeFileSync(ontaskPersistence.filePath(), JSON.stringify(ontaskPersistence.data))
    } catch (e) {
      console.warn('ONTASK persistence write failed', e)
    }
  },

  onSessionStart: function (session) {
    ontaskPersistence.load()
    ontaskPersistence.data.lastSession = {
      task: session.task,
      startedAt: session.startedAt,
      allowlist: session.allowlist,
      overrides: session.overrides
    }
    ontaskPersistence.data.history = [session.task]
      .concat(ontaskPersistence.data.history.filter(t => t !== session.task))
      .slice(0, 10)
    ontaskPersistence.save()
  },

  onSessionUpdate: function (session) {
    ontaskPersistence.load()
    if (ontaskPersistence.data.lastSession && ontaskPersistence.data.lastSession.task === session.task) {
      ontaskPersistence.data.lastSession.allowlist = session.allowlist
      ontaskPersistence.data.lastSession.overrides = session.overrides
      ontaskPersistence.save()
    }
  },

  getLastTask: function () {
    ontaskPersistence.load()
    return ontaskPersistence.data.lastSession ? ontaskPersistence.data.lastSession.task : null
  }
}

ipc.handle('ontask-get-last-task', function () {
  return ontaskPersistence.getLastTask()
})
