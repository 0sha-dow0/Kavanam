/*
OnTask persistence — stores the task (plus allowlist/overrides snapshot and a
short task history) in userData so a relaunch can offer resume-or-new.
Uses the shared fs/path/app/ipc from the concatenated main bundle.
*/

const ontaskWriteFileAtomic = require('write-file-atomic')

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
      var parsed = JSON.parse(fs.readFileSync(ontaskPersistence.filePath(), 'utf-8'))
      ontaskPersistence.data = {
        lastSession: parsed && parsed.lastSession ? parsed.lastSession : null,
        history: parsed && Array.isArray(parsed.history) ? parsed.history : [],
        firstRunDone: !!(parsed && parsed.firstRunDone)
      }
    } catch (e) {
      ontaskPersistence.data = { lastSession: null, history: [] }
    }
  },

  save: function () {
    try {
      ontaskWriteFileAtomic.sync(
        ontaskPersistence.filePath(),
        JSON.stringify(ontaskPersistence.data),
        { encoding: 'utf-8', mode: 0o600 }
      )
    } catch (e) {
      console.warn('ONTASK persistence write failed', e)
    }
  },

  onSessionStart: function (session) {
    ontaskPersistence.load()
    ontaskPersistence.data.lastSession = {
      task: session.task,
      startedAt: session.startedAt,
      allowlist: session.allowlist.slice(),
      overrides: session.overrides.slice()
    }
    ontaskPersistence.data.history = [session.task]
      .concat(ontaskPersistence.data.history.filter(t => t !== session.task))
      .slice(0, 10)
    ontaskPersistence.save()
  },

  onSessionUpdate: function (session) {
    ontaskPersistence.load()
    if (ontaskPersistence.data.lastSession && ontaskPersistence.data.lastSession.task === session.task) {
      ontaskPersistence.data.lastSession.allowlist = session.allowlist.slice()
      ontaskPersistence.data.lastSession.overrides = session.overrides.slice()
      ontaskPersistence.save()
    }
  },

  getLastSession: function () {
    ontaskPersistence.load()
    var saved = ontaskPersistence.data.lastSession
    if (!saved || typeof saved.task !== 'string' || !saved.task.trim()) {
      return null
    }
    var task
    try {
      task = ontaskIPC.cleanTask(saved.task)
    } catch (e) {
      return null
    }
    var allowlist = (Array.isArray(saved.allowlist) ? saved.allowlist : []).slice(0, 50).map(function (domain) {
      try {
        return ontaskIPC.cleanDomain(domain)
      } catch (e) {
        return null
      }
    }).filter(Boolean)
    var overrides = (Array.isArray(saved.overrides) ? saved.overrides : []).slice(0, 500).map(function (record) {
      try {
        var page = ontaskIPC.canonicalPageURL(record && record.page)
        if (!page) {
          return null
        }
        return { page: page, id: ontaskIPC.cleanText(record.id, 256, 1) }
      } catch (e) {
        return null
      }
    }).filter(Boolean)
    return {
      task: task,
      startedAt: Number(saved.startedAt) || Date.now(),
      allowlist: allowlist,
      overrides: overrides
    }
  }
}

ipc.handle('ontask-get-last-session', function (e) {
  ontaskIPC.requireChrome(e)
  return ontaskPersistence.getLastSession()
})
