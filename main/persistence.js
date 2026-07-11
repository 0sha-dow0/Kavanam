/*
OnTask persistence — stores resumable and completed focus sessions in userData.
Uses the shared fs/path/app/ipc from the concatenated main bundle.
*/

const ontaskWriteFileAtomic = require('write-file-atomic')

const ontaskPersistence = {
  data: null,

  normalizeSession: function (saved) {
    if (!saved || typeof saved.task !== 'string' || !saved.task.trim()) {
      return null
    }
    return {
      task: saved.task.trim(),
      startedAt: Number(saved.startedAt) || Date.now(),
      updatedAt: Number(saved.updatedAt) || Number(saved.startedAt) || Date.now(),
      completedAt: Number(saved.completedAt) || null,
      totalFocusMs: Math.max(0, Number(saved.totalFocusMs) || 0),
      resumeCount: Math.max(0, Number(saved.resumeCount) || 0),
      pauseCount: Math.max(0, Number(saved.pauseCount) || 0),
      expandedIntent: typeof saved.expandedIntent === 'string' ? saved.expandedIntent : '',
      keywords: Array.isArray(saved.keywords) ? saved.keywords.slice() : [],
      allowlist: Array.isArray(saved.allowlist) ? saved.allowlist.slice() : [],
      overrides: Array.isArray(saved.overrides) ? saved.overrides.slice() : []
    }
  },

  filePath: function () {
    return path.join(app.getPath('userData'), 'ontask.json')
  },

  load: function () {
    if (ontaskPersistence.data) {
      return
    }
    try {
      var parsed = JSON.parse(fs.readFileSync(ontaskPersistence.filePath(), 'utf-8'))
      var sessions = parsed && Array.isArray(parsed.sessions)
        ? parsed.sessions.map(ontaskPersistence.normalizeSession).filter(Boolean)
        : []
      var lastSession = ontaskPersistence.normalizeSession(parsed && parsed.lastSession)
      if (lastSession && !sessions.some(s => s.startedAt === lastSession.startedAt)) {
        sessions.push(lastSession)
      }
      var history = parsed && Array.isArray(parsed.history) ? parsed.history : []
      var migrationTime = lastSession ? lastSession.updatedAt : Date.now()
      history.forEach(function (task, index) {
        if (typeof task === 'string' && task.trim() && !sessions.some(s => s.task === task.trim())) {
          sessions.push(ontaskPersistence.normalizeSession({
            task: task,
            startedAt: migrationTime - index - 1,
            updatedAt: migrationTime - index - 1
          }))
        }
      })
      ontaskPersistence.data = {
        lastSession: lastSession && !lastSession.completedAt ? lastSession : null,
        sessions: sessions,
        history: history,
        firstRunDone: !!(parsed && parsed.firstRunDone)
      }
    } catch (e) {
      ontaskPersistence.data = { lastSession: null, sessions: [], history: [], firstRunDone: false }
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

  totalFocusMs: function (session) {
    var total = Math.max(0, Number(session.totalFocusMs) || 0)
    return total + Math.max(0, Number(session.currentFocusMs) || 0)
  },

  onSessionStart: function (session) {
    ontaskPersistence.load()
    var saved = {
      task: session.task,
      startedAt: session.startedAt,
      updatedAt: Date.now(),
      completedAt: null,
      totalFocusMs: ontaskPersistence.totalFocusMs(session),
      resumeCount: Math.max(0, Number(session.resumeCount) || 0),
      pauseCount: Math.max(0, Number(session.pauseCount) || 0),
      expandedIntent: session.expandedIntent || '',
      keywords: Array.isArray(session.keywords) ? session.keywords.slice() : [],
      allowlist: session.allowlist.slice(),
      overrides: session.overrides.slice()
    }
    ontaskPersistence.data.lastSession = saved
    ontaskPersistence.data.sessions.push(saved)
    ontaskPersistence.data.history = [session.task]
      .concat(ontaskPersistence.data.history.filter(t => t !== session.task))
    ontaskPersistence.save()
  },

  onSessionUpdate: function (session) {
    ontaskPersistence.load()
    var saved = ontaskPersistence.data.sessions.find(s => s.startedAt === session.startedAt)
    if (!saved) {
      saved = ontaskPersistence.normalizeSession(session)
      ontaskPersistence.data.sessions.push(saved)
    }
    saved.task = session.task
    saved.expandedIntent = session.expandedIntent || ''
    saved.keywords = Array.isArray(session.keywords) ? session.keywords.slice() : []
    saved.allowlist = session.allowlist.slice()
    saved.overrides = session.overrides.slice()
    saved.resumeCount = Math.max(0, Number(session.resumeCount) || 0)
    saved.pauseCount = Math.max(0, Number(session.pauseCount) || 0)
    saved.updatedAt = Date.now()
    saved.totalFocusMs = ontaskPersistence.totalFocusMs(session)
    ontaskPersistence.data.lastSession = saved
    ontaskPersistence.save()
  },

  getSessions: function () {
    ontaskPersistence.load()
    return ontaskPersistence.data.sessions
      .filter(session => !session.completedAt)
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(ontaskPersistence.normalizeSession)
  },

  getCompletedSessions: function () {
    ontaskPersistence.load()
    return ontaskPersistence.data.sessions
      .filter(session => !!session.completedAt)
      .slice()
      .sort((a, b) => b.completedAt - a.completedAt)
      .map(ontaskPersistence.normalizeSession)
  },

  onSessionComplete: function (session) {
    ontaskPersistence.onSessionUpdate(session)
    var saved = ontaskPersistence.data.sessions.find(s => s.startedAt === session.startedAt)
    if (saved) {
      saved.completedAt = Date.now()
      saved.updatedAt = saved.completedAt
    }
    if (ontaskPersistence.data.lastSession && ontaskPersistence.data.lastSession.startedAt === session.startedAt) {
      ontaskPersistence.data.lastSession = null
    }
    ontaskPersistence.save()
    return ontaskPersistence.normalizeSession(saved)
  },

  getSession: function (startedAt) {
    ontaskPersistence.load()
    var saved = ontaskPersistence.data.sessions.find(s => s.startedAt === Number(startedAt))
    return ontaskPersistence.normalizeSession(saved)
  },

  getLastSession: function () {
    ontaskPersistence.load()
    return ontaskPersistence.normalizeSession(ontaskPersistence.data.lastSession)
  }
}

ipc.handle('ontask-get-last-session', function () {
  return ontaskPersistence.getLastSession()
})

ipc.handle('ontask-get-sessions', function () {
  return ontaskPersistence.getSessions()
})

ipc.handle('ontask-get-completed-sessions', function () {
  return ontaskPersistence.getCompletedSessions()
})
