/*
OnTask FocusSessionStore — single source of truth for the focus session.
Lives in the main process so every tab shares one task context.
The task is immutable for the session: there is no API to change it once set.
*/

var focusSession = {
  session: null,

  start: function (task) {
    if (focusSession.session) {
      throw new Error('A focus session is already active')
    }
    task = String(task || '').trim()
    if (!task) {
      throw new Error('A focus task is required')
    }
    var now = Date.now()
    focusSession.session = {
      task: task,
      taskEmbedding: null,
      expandedIntent: null,
      keywords: [],
      subtask: null,
      subtaskEmbedding: null,
      allowlist: [],
      overrides: [],
      startedAt: now,
      openedAt: now,
      totalFocusMs: 0,
      currentFocusMs: 0
    }
    console.log('ONTASK session started:', task)
    ontaskPersistence.onSessionStart(focusSession.session)

    // local task embedding (never blocks session start)
    ontaskRelevanceEngine.onSessionStart(task)

    // Groq goal expansion: intent + keywords + seed allowlist (Q16);
    // unreachable Groq -> local-only degraded mode (Q28)
    if (ontaskGroqClient.available()) {
      var startedSession = focusSession.session
      ontaskGroqClient.expandGoal(task).then(function (expansion) {
        if (focusSession.session !== startedSession) {
          return
        }
        startedSession.expandedIntent = expansion.intent
        startedSession.keywords = expansion.keywords
        expansion.domains.forEach(function (d) {
          if (startedSession.allowlist.indexOf(d) === -1) {
            startedSession.allowlist.push(d)
          }
        })
        ontaskPersistence.onSessionUpdate(startedSession)
        ontaskRelevanceEngine.onGoalExpanded(startedSession)
        console.log('ONTASK goal expanded:', JSON.stringify({ intent: expansion.intent, keywords: expansion.keywords, allowlist: startedSession.allowlist }))
        try {
          sendIPCToWindow(windows.getCurrent(), 'ontask-session-changed', {})
        } catch (e) {}
      }).catch(function (err) {
        console.warn('ONTASK goal expansion failed, local-only degraded mode:', err.message)
      })
    } else {
      console.log('ONTASK no Groq key — local-only degraded mode')
    }
    return focusSession.session
  },

  resume: function (saved) {
    if (focusSession.session) {
      throw new Error('A focus session is already active')
    }
    if (!saved || typeof saved.task !== 'string' || !saved.task.trim()) {
      throw new Error('No focus session is available to resume')
    }
    focusSession.session = {
      task: saved.task.trim(),
      taskEmbedding: null,
      expandedIntent: null,
      keywords: [],
      subtask: null,
      subtaskEmbedding: null,
      allowlist: Array.isArray(saved.allowlist) ? saved.allowlist.slice() : [],
      overrides: Array.isArray(saved.overrides) ? saved.overrides.slice() : [],
      startedAt: Number(saved.startedAt) || Date.now(),
      openedAt: Date.now(),
      totalFocusMs: Math.max(0, Number(saved.totalFocusMs) || 0),
      currentFocusMs: 0
    }
    ontaskPersistence.onSessionUpdate(focusSession.session)
    ontaskRelevanceEngine.onSessionStart(focusSession.session.task)
    console.log('ONTASK session resumed:', focusSession.session.task)
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

  updateCurrentFocusMs: function (milliseconds) {
    if (focusSession.session && Number.isFinite(Number(milliseconds))) {
      focusSession.session.currentFocusMs = Math.max(
        focusSession.session.currentFocusMs,
        Number(milliseconds)
      )
    }
  },

  end: function () {
    console.log('ONTASK session ended')
    if (focusSession.session) {
      ontaskPersistence.onSessionUpdate(focusSession.session)
    }
    focusSession.session = null
    ontaskRelevanceEngine.onSessionEnd()
    // un-hide everything everywhere; tabs stay open (Q40)
    webContents.getAllWebContents().forEach(function (wc) {
      try {
        wc.send('ontask-clear')
      } catch (e) {}
    })
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
      overrides: focusSession.session.overrides,
      startedAt: focusSession.session.startedAt,
      openedAt: focusSession.session.openedAt,
      totalFocusMs: focusSession.session.totalFocusMs,
      currentFocusMs: focusSession.session.currentFocusMs
    }
  }
}

ipc.handle('ontask-get-session', function () {
  return focusSession.publicState()
})

ipc.on('ontask-focus-heartbeat', function (e, currentFocusMs) {
  if (focusSession.session) {
    focusSession.updateCurrentFocusMs(currentFocusMs)
    ontaskPersistence.onSessionUpdate(focusSession.session)
  }
})

ipc.on('ontask-user-activity', function () {
  try {
    sendIPCToWindow(windows.getCurrent(), 'ontask-user-activity', {})
  } catch (e) {}
})

ipc.handle('ontask-start-session', function (e, task) {
  focusSession.start(task)
  return focusSession.publicState()
})

ipc.handle('ontask-resume-session', function (e, startedAt) {
  var saved = startedAt
    ? ontaskPersistence.getSession(startedAt)
    : ontaskPersistence.getLastSession()
  focusSession.resume(saved)
  return focusSession.publicState()
})

ipc.handle('ontask-end-session', function (e, currentFocusMs) {
  focusSession.updateCurrentFocusMs(currentFocusMs)
  focusSession.end()
  return null
})

ipc.handle('ontask-override-add', function (e, record) {
  var session = focusSession.get()
  if (!session || !record || !record.page || !record.id) {
    return false
  }
  var exists = session.overrides.some(function (item) {
    return item.page === record.page && item.id === record.id
  })
  if (!exists) {
    session.overrides.push({ page: String(record.page), id: String(record.id) })
    ontaskPersistence.onSessionUpdate(session)
  }
  return true
})

ipc.handle('ontask-override-remove', function (e, record) {
  var session = focusSession.get()
  if (!session || !record) {
    return false
  }
  session.overrides = session.overrides.filter(function (item) {
    return item.page !== record.page || item.id !== record.id
  })
  ontaskPersistence.onSessionUpdate(session)
  return true
})

ipc.handle('ontask-first-run', function () {
  ontaskPersistence.load()
  return !ontaskPersistence.data.firstRunDone
})

ipc.on('ontask-first-run-done', function () {
  ontaskPersistence.load()
  ontaskPersistence.data.firstRunDone = true
  ontaskPersistence.save()
})

if (process.argv.includes('--ontask-selftest')) {
  focusSession.start('selftest dummy task')
  console.log('ONTASK selftest read-back:', JSON.stringify(focusSession.publicState()))
  focusSession.end()
}
