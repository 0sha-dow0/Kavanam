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
      startedAt: Date.now()
    }
    console.log('ONTASK session started:', task)
    ontaskPersistence.onSessionStart(focusSession.session)

    // local task embedding (never blocks session start)
    ontaskRelevanceEngine.onSessionStart(task)
    focusSession.runGoalExpansion(focusSession.session)
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
      expandedIntent: null,
      keywords: [],
      subtask: null,
      subtaskEmbedding: null,
      allowlist: (Array.isArray(saved.allowlist) ? saved.allowlist : []).filter(function (d) {
        return !ontaskNavigationGuard.isSearchEngineDomain(d)
      }),
      overrides: Array.isArray(saved.overrides) ? saved.overrides.slice() : [],
      subtasks: [],
      approvedHosts: [],
      judgedSearches: {},
      startedAt: Number(saved.startedAt) || Date.now()
    }
    ontaskPersistence.onSessionUpdate(focusSession.session)
    ontaskRelevanceEngine.onSessionStart(focusSession.session.task)
    focusSession.runGoalExpansion(focusSession.session)
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
      expandedIntent: focusSession.session.expandedIntent,
      allowlist: focusSession.session.allowlist,
      overrides: focusSession.session.overrides,
      startedAt: focusSession.session.startedAt
    }
  }
}

ipc.handle('ontask-get-session', function (e) {
  ontaskIPC.requireChrome(e)
  return focusSession.publicState()
})

ipc.handle('ontask-start-session', function (e, task) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'session', 5, 60000)
  focusSession.start(ontaskIPC.cleanTask(task))
  return focusSession.publicState()
})

ipc.handle('ontask-resume-session', function (e) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'session', 5, 60000)
  focusSession.resume(ontaskPersistence.getLastSession())
  return focusSession.publicState()
})

ipc.handle('ontask-end-session', function (e) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'session', 5, 60000)
  focusSession.end()
  return null
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
