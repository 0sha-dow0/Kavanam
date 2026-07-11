/*
OnTask FocusSessionStore — single source of truth for the focus session.
Lives in the main process so every tab shares one task context.
Task edits retain timing history while rebuilding the relevance context.
*/

var focusSession = {
  session: null,

  initializeTaskContext: function (session) {
    ontaskRelevanceEngine.onSessionStart(session.task)
    focusSession.runGoalExpansion(session)
  },

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
      subtasks: [],
      approvedHosts: [], // hosts Groq ruled on-task this session (skip re-judging)
      judgedSearches: {}, // search query -> allow/block from Groq this session
      startedAt: now,
      openedAt: now,
      totalFocusMs: 0,
      currentFocusMs: 0,
      resumeCount: 0,
      pauseCount: 0,
      paused: false
    }
    console.log('ONTASK session started:', task)
    ontaskPersistence.onSessionStart(focusSession.session)

    focusSession.initializeTaskContext(focusSession.session)
    return focusSession.session
  },

  // Groq goal expansion: intent + keywords + seed allowlist (Q16);
  // unreachable Groq -> local-only degraded mode (Q28). Runs on start AND
  // resume — a resumed session must judge as sharply as a fresh one.
  runGoalExpansion: function (session) {
    if (!ontaskGroqClient.available()) {
      console.log('ONTASK no Groq key — local-only degraded mode')
      return
    }
    ontaskGroqClient.expandGoal(session.task).then(function (expansion) {
      if (focusSession.session !== session) {
        return
      }
      session.expandedIntent = expansion.intent
      session.subtasks = expansion.subtasks || []
      session.keywords = expansion.keywords
      expansion.domains.forEach(function (d) {
        // Groq sometimes returns phrases (" university websites") instead
        // of bare domains: validate before they pollute the allowlist
        var clean
        try {
          clean = ontaskIPC.cleanDomain(d)
        } catch (e) {
          return
        }
        // utility hosts (search engines) never get blanket trust
        if (ontaskNavigationGuard.isSearchEngineDomain(clean)) {
          return
        }
        if (session.allowlist.indexOf(clean) === -1) {
          session.allowlist.push(clean)
        }
      })
      ontaskPersistence.onSessionUpdate(session)
      ontaskRelevanceEngine.onGoalExpanded(session)
      console.log('ONTASK goal expanded:', JSON.stringify({ intent: expansion.intent, keywords: expansion.keywords, allowlist: session.allowlist }))
      try {
        sendIPCToWindow(windows.getCurrent(), 'ontask-session-changed', {})
      } catch (e) {}
    }).catch(function (err) {
      console.warn('ONTASK goal expansion failed, local-only degraded mode:', err.message)
    })
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
      expandedIntent: saved.expandedIntent || null,
      keywords: Array.isArray(saved.keywords) ? saved.keywords.slice() : [],
      subtask: null,
      subtaskEmbedding: null,
      allowlist: (Array.isArray(saved.allowlist) ? saved.allowlist : []).filter(function (d) {
        return !ontaskNavigationGuard.isSearchEngineDomain(d)
      }),
      overrides: Array.isArray(saved.overrides) ? saved.overrides.slice() : [],
      subtasks: [],
      approvedHosts: [],
      judgedSearches: {},
      startedAt: Number(saved.startedAt) || Date.now(),
      openedAt: Date.now(),
      totalFocusMs: Math.max(0, Number(saved.totalFocusMs) || 0),
      currentFocusMs: 0,
      resumeCount: Math.max(0, Number(saved.resumeCount) || 0) + 1,
      pauseCount: Math.max(0, Number(saved.pauseCount) || 0),
      paused: false
    }
    ontaskPersistence.onSessionUpdate(focusSession.session)
    focusSession.initializeTaskContext(focusSession.session)
    console.log('ONTASK session resumed:', focusSession.session.task)
    return focusSession.session
  },

  edit: function (task) {
    if (!focusSession.session) {
      throw new Error('No focus session is active')
    }
    task = String(task || '').trim()
    if (!task) {
      throw new Error('A focus task is required')
    }
    var session = focusSession.session
    session.task = task
    session.taskEmbedding = null
    session.expandedIntent = null
    session.keywords = []
    session.subtask = null
    session.subtaskEmbedding = null
    session.allowlist = []
    session.overrides = []
    ontaskPersistence.onSessionUpdate(session)
    focusSession.initializeTaskContext(session)
    webContents.getAllWebContents().forEach(function (wc) {
      try {
        wc.send('ontask-clear')
      } catch (e) {}
    })
    console.log('ONTASK session task edited:', task)
    return session
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

  setPaused: function (paused) {
    if (!focusSession.session) {
      return null
    }
    paused = !!paused
    if (paused && !focusSession.session.paused) {
      focusSession.session.pauseCount += 1
    }
    focusSession.session.paused = paused
    ontaskPersistence.onSessionUpdate(focusSession.session)
    return focusSession.session
  },

  end: function () {
    console.log('ONTASK session ended')
    if (focusSession.session) {
      ontaskPersistence.onSessionComplete(focusSession.session)
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

  leave: function () {
    console.log('ONTASK session left unfinished')
    if (focusSession.session) {
      ontaskPersistence.onSessionUpdate(focusSession.session)
    }
    focusSession.session = null
    ontaskRelevanceEngine.onSessionEnd()
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
      expandedIntent: focusSession.session.expandedIntent,
      allowlist: focusSession.session.allowlist,
      overrides: focusSession.session.overrides,
      startedAt: focusSession.session.startedAt,
      openedAt: focusSession.session.openedAt,
      totalFocusMs: focusSession.session.totalFocusMs,
      currentFocusMs: focusSession.session.currentFocusMs,
      resumeCount: focusSession.session.resumeCount,
      pauseCount: focusSession.session.pauseCount,
      paused: focusSession.session.paused
    }
  }
}

ipc.handle('ontask-get-session', function (e) {
  ontaskIPC.requireChrome(e)
  return focusSession.publicState()
})

ipc.on('ontask-focus-heartbeat', function (e, currentFocusMs) {
  ontaskIPC.requireChrome(e)
  if (focusSession.session) {
    focusSession.updateCurrentFocusMs(currentFocusMs)
    ontaskPersistence.onSessionUpdate(focusSession.session)
  }
})

ipc.on('ontask-user-activity', function (e) {
  try {
    ontaskIPC.requireContent(e)
  } catch (err) {
    return
  }
  try {
    sendIPCToWindow(windows.getCurrent(), 'ontask-user-activity', {})
  } catch (e) {}
})

ipc.handle('ontask-start-session', function (e, task) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'session', 5, 60000)
  focusSession.start(ontaskIPC.cleanTask(task))
  return focusSession.publicState()
})

ipc.handle('ontask-resume-session', function (e, startedAt) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'session', 5, 60000)
  var saved = startedAt
    ? ontaskPersistence.getSession(startedAt)
    : ontaskPersistence.getLastSession()
  focusSession.resume(saved)
  return focusSession.publicState()
})

ipc.handle('ontask-end-session', function (e, currentFocusMs) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'session', 5, 60000)
  focusSession.updateCurrentFocusMs(currentFocusMs)
  focusSession.end()
  return null
})

ipc.handle('ontask-leave-session', function (e, currentFocusMs) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'session', 5, 60000)
  focusSession.updateCurrentFocusMs(currentFocusMs)
  focusSession.leave()
  return null
})

ipc.handle('ontask-edit-session', function (e, task) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'session', 5, 60000)
  focusSession.edit(ontaskIPC.cleanTask(task))
  return focusSession.publicState()
})

ipc.handle('ontask-set-paused', function (e, paused, currentFocusMs) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'control', 30, 60000)
  focusSession.updateCurrentFocusMs(currentFocusMs)
  focusSession.setPaused(paused)
  return focusSession.publicState()
})

ipc.handle('ontask-override-add', function (e, record) {
  ontaskIPC.take(e, 'override', 30, 60000)
  record = ontaskIPC.cleanOverride(e, record)
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
  ontaskIPC.take(e, 'override', 30, 60000)
  record = ontaskIPC.cleanOverride(e, record)
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

ipc.handle('ontask-first-run', function (e) {
  ontaskIPC.requireChrome(e)
  ontaskPersistence.load()
  return !ontaskPersistence.data.firstRunDone
})

ipc.on('ontask-first-run-done', function (e) {
  ontaskIPC.requireChrome(e)
  ontaskPersistence.load()
  ontaskPersistence.data.firstRunDone = true
  ontaskPersistence.save()
})

/* on-task suggestions for content injection (Surface 3, additive): the
   task-relevant search terms Groq already produced. Content pages read
   these to offer on-task alternatives in place of a distracting feed. */
ipc.handle('ontask-suggestions', function (e) {
  ontaskIPC.requireContent(e)
  var session = focusSession.get()
  if (!session) {
    return null
  }
  var terms = []
  var seen = {}
  ;(session.subtasks || []).concat(session.keywords || []).forEach(function (t) {
    var clean = String(t || '').replace(/\s+/g, ' ').trim()
    var key = clean.toLowerCase()
    if (clean && clean.length <= 60 && !seen[key]) {
      seen[key] = true
      terms.push(clean)
    }
  })
  return {
    task: session.task,
    intent: session.expandedIntent || '',
    terms: terms.slice(0, 8)
  }
})

if (process.argv.includes('--ontask-selftest')) {
  focusSession.start('selftest dummy task')
  console.log('ONTASK selftest read-back:', JSON.stringify(focusSession.publicState()))
  focusSession.end()
}
