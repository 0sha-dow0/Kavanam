/*
OnTask RelevanceEngine — one engine, three surfaces.
Local tier: bundled all-MiniLM-L6-v2 (transformers.js/ONNX, offline) with
cosine similarity against the task AND live subtask (keep the higher, Q10).
Groq tier: ambiguity tiebreaker for the 0.40–0.55 band only (Q7/Q8).
Failure classes: engine outage fails OPEN (Q27); ambiguity fails CLOSED
while a tiebreak is pending (Q8); cold start shows items then filters (Q11).
*/

const ontaskRelevanceEngine = {
  status: 'cold', // cold | loading | ready | failed
  loadPromise: null,
  extractor: null,
  taskText: null,
  taskEmbedding: null,
  subtaskEmbedding: null,
  taskReadyPromise: null,
  verdictCache: {},
  tiebreakInflight: {},
  revision: 0,
  bands: { on: 0.55, off: 0.40 },

  broadcast: function (channel) {
    webContents.getAllWebContents().forEach(function (wc) {
      try {
        wc.send(channel)
      } catch (e) {}
    })
  },

  disable: function (err) {
    ontaskRelevanceEngine.status = 'failed'
    ontaskRelevanceEngine.extractor = null
    ontaskRelevanceEngine.taskEmbedding = null
    ontaskRelevanceEngine.subtaskEmbedding = null
    ontaskRelevanceEngine.goalEmbeddings = []
    ontaskRelevanceEngine.verdictCache = {}
    ontaskRelevanceEngine.tiebreakInflight = {}
    console.warn('ONTASK engine failure - enforcement disabled:', err && err.message)
    ontaskRelevanceEngine.broadcast('ontask-clear')
  },

  invalidate: function () {
    ontaskRelevanceEngine.revision++
    ontaskRelevanceEngine.verdictCache = {}
    ontaskRelevanceEngine.tiebreakInflight = {}
    ontaskRelevanceEngine.broadcast('ontask-rescore')
  },

  ensureLoaded: function () {
    if (ontaskRelevanceEngine.loadPromise) {
      return ontaskRelevanceEngine.loadPromise
    }
    ontaskRelevanceEngine.status = 'loading'
    ontaskRelevanceEngine.loadPromise = import('@xenova/transformers')
      .then(function (tf) {
        tf.env.allowRemoteModels = false
        tf.env.localModelPath = path.join(__dirname, 'models', 'minilm')
        return tf.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true })
      })
      .then(function (extractor) {
        ontaskRelevanceEngine.extractor = extractor
        ontaskRelevanceEngine.status = 'ready'
        console.log('ONTASK engine ready (MiniLM loaded)')
        return extractor
      })
      .catch(function (err) {
        ontaskRelevanceEngine.disable(err)
        return null
      })
    return ontaskRelevanceEngine.loadPromise
  },

  embed: async function (text) {
    var extractor = await ontaskRelevanceEngine.ensureLoaded()
    if (!extractor) {
      return null
    }
    try {
      var output = await extractor(String(text).slice(0, 512), { pooling: 'mean', normalize: true })
      return output.data
    } catch (err) {
      ontaskRelevanceEngine.disable(err)
      return null
    }
  },

  // embeddings are normalized, so cosine similarity is the dot product
  similarity: function (a, b) {
    if (!a || !b) {
      return null
    }
    var dot = 0
    for (var i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
    }
    return dot
  },

  onSessionStart: function (task) {
    var session = focusSession.get()
    ontaskRelevanceEngine.taskText = task
    ontaskRelevanceEngine.subtaskEmbedding = null
    ontaskRelevanceEngine.taskEmbedding = null
    ontaskRelevanceEngine.goalEmbeddings = []
    ontaskRelevanceEngine.invalidate()
    ontaskRelevanceEngine.taskReadyPromise = ontaskRelevanceEngine.embed(task).then(function (embedding) {
      if (focusSession.get() !== session || ontaskRelevanceEngine.taskText !== task) {
        return null
      }
      ontaskRelevanceEngine.taskEmbedding = embedding
      if (embedding) {
        console.log('ONTASK task embedded (' + embedding.length + ' dims)')
        ontaskRelevanceEngine.broadcast('ontask-rescore')
      }
      return embedding
    })
    return ontaskRelevanceEngine.taskReadyPromise
  },

  goalEmbeddings: [], // one embedding per Groq sub-task: a page matching ANY sub-goal is on-task

  // once Groq expands the goal, re-embed a richer task text AND each
  // sub-task separately: "research professors" matches a faculty page far
  // better than the whole task sentence ever will
  onGoalExpanded: async function (session) {
    var rich = session.task
    if (session.expandedIntent) {
      rich += '. ' + session.expandedIntent
    }
    if (session.keywords && session.keywords.length) {
      rich += '. ' + session.keywords.join(', ')
    }
    var subtasks = session.subtasks || []
    var embeddings = await Promise.all(
      [rich].concat(subtasks).map(function (text) {
        return ontaskRelevanceEngine.embed(text)
      })
    )
    if (embeddings[0] && focusSession.session === session) {
      ontaskRelevanceEngine.taskEmbedding = embeddings[0]
      ontaskRelevanceEngine.goalEmbeddings = embeddings.slice(1).filter(Boolean)
      ontaskRelevanceEngine.invalidate()
      console.log('ONTASK task embedding enriched; sub-task embeddings: ' + ontaskRelevanceEngine.goalEmbeddings.length)
    }
  },

  onSubtask: async function (subtask) {
    var session = focusSession.get()
    var emb = await ontaskRelevanceEngine.embed(subtask)
    if (emb && focusSession.get() === session && session.subtask === subtask) {
      ontaskRelevanceEngine.subtaskEmbedding = emb
      ontaskRelevanceEngine.invalidate()
    }
  },

  onSessionEnd: function () {
    ontaskRelevanceEngine.taskText = null
    ontaskRelevanceEngine.taskEmbedding = null
    ontaskRelevanceEngine.subtaskEmbedding = null
    ontaskRelevanceEngine.goalEmbeddings = []
    ontaskRelevanceEngine.taskReadyPromise = null
    ontaskRelevanceEngine.verdictCache = {}
    ontaskRelevanceEngine.tiebreakInflight = {}
    ontaskRelevanceEngine.revision++
  },

  enforcing: function () {
    return ontaskRelevanceEngine.status === 'ready' &&
      !!ontaskRelevanceEngine.taskEmbedding &&
      focusSession.isActive()
  },

  /*
  score = max(sim(task), sim(subtask)) — Q10.
  opts.taskOnly skips the subtask: the subtask is inferred from page titles,
  so judging a PAGE against it would let any page validate itself.
  */
  scoreText: async function (text, opts) {
    if (!ontaskRelevanceEngine.enforcing()) {
      return null
    }
    var emb = await ontaskRelevanceEngine.embed(text)
    if (!emb) {
      return null
    }
    var best = ontaskRelevanceEngine.similarity(emb, ontaskRelevanceEngine.taskEmbedding)
    // Groq sub-goals are part of the task definition (not page-derived),
    // so they count even under taskOnly
    ontaskRelevanceEngine.goalEmbeddings.forEach(function (goalEmb) {
      var s = ontaskRelevanceEngine.similarity(emb, goalEmb)
      if (s !== null && (best === null || s > best)) {
        best = s
      }
    })
    if (opts && opts.taskOnly) {
      return best
    }
    var s2 = ontaskRelevanceEngine.similarity(emb, ontaskRelevanceEngine.subtaskEmbedding)
    return Math.max(best === null ? -1 : best, s2 === null ? -1 : s2)
  },

  band: function (score) {
    if (score === null) {
      return null
    }
    if (score >= ontaskRelevanceEngine.bands.on) {
      return 'on'
    }
    if (score < ontaskRelevanceEngine.bands.off) {
      return 'off'
    }
    return 'ambiguous'
  },

  /*
  Score a batch of {id, text}. Returns [{id, verdict}] where verdict is
  show | hide | pending. Ambiguous items return 'pending' (fail closed, Q8)
  and resolve later through onUpdate([{id, verdict}]).
  */
  HARD_OFF: 0.28, // below this an item is unambiguously unrelated

  scoreItems: async function (items, onUpdate, pageURL, pageContext) {
    var results = []
    var ambiguous = []
    var session = focusSession.get()
    var overrides = session && Array.isArray(session.overrides) ? session.overrides : []

    /*
    Context-aware banding: when the page the user is on is itself on-task
    (an approved search, an on-task article), items there deserve the
    benefit of the doubt — snippets embed noisily ("Try free templates")
    even when the destination is exactly what the task needs. On such
    pages the local tier only hides unambiguous junk; everything mid-band
    is judged by Groq WITH the page context.
    */
    var lenientOffBar = ontaskRelevanceEngine.bands.off
    // a search page that loaded at all was already judged on-task by the
    // navigation guard (off-task searches are blocked before they load) —
    // its results deserve leniency by construction
    try {
      if (pageURL && ontaskNavigationGuard.searchQueryOf(new URL(pageURL))) {
        lenientOffBar = ontaskRelevanceEngine.HARD_OFF
      }
    } catch (e) {}
    if (lenientOffBar !== ontaskRelevanceEngine.HARD_OFF && pageContext) {
      var contextScore = await ontaskRelevanceEngine.scoreText(pageContext, { taskOnly: true })
      if (contextScore !== null && contextScore >= ontaskRelevanceEngine.bands.on) {
        lenientOffBar = ontaskRelevanceEngine.HARD_OFF
      }
    }

    // a link into a Groq-endorsed task domain is on-task by definition —
    // no judging, no latency
    var allowlist = (session && session.allowlist) || []
    function allowlistedHost (id) {
      try {
        var hostname = new URL(id).hostname
        return allowlist.some(function (d) {
          return ontaskNavigationGuard.hostMatches(hostname, d)
        })
      } catch (e) {
        return false
      }
    }

    var toScore = []
    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      var overridden = overrides.some(function (record) {
        return record.page === pageURL && record.id === item.id
      })
      if (overridden || allowlistedHost(item.id)) {
        results.push({ id: item.id, verdict: 'show' })
        continue
      }
      var cached = ontaskRelevanceEngine.verdictCache[ontaskRelevanceEngine.cacheKey(item)]
      if (cached) {
        results.push({ id: item.id, verdict: cached })
        continue
      }
      toScore.push(item)
    }

    // embed the batch concurrently: serial awaits made the first reveal
    // wave feel slow on large feeds
    var scores = await Promise.all(toScore.map(function (item) {
      return ontaskRelevanceEngine.scoreText(item.text)
    }))
    for (var j = 0; j < toScore.length; j++) {
      var scoredItem = toScore[j]
      var score = scores[j]
      var cacheKey = ontaskRelevanceEngine.cacheKey(scoredItem)
      var band = ontaskRelevanceEngine.band(score)
      if (band === null) {
        results.push({ id: scoredItem.id, verdict: 'show' }) // engine off: fail open
      } else if (band === 'on') {
        ontaskRelevanceEngine.verdictCache[cacheKey] = 'show'
        results.push({ id: scoredItem.id, verdict: 'show' })
      } else if (band === 'off' && score < lenientOffBar) {
        ontaskRelevanceEngine.verdictCache[cacheKey] = 'hide'
        results.push({ id: scoredItem.id, verdict: 'hide' })
      } else {
        // mid-band (including off-band items on an on-task page): withhold
        // and let Groq judge with context (Q8)
        results.push({ id: scoredItem.id, verdict: 'pending' })
        ambiguous.push(scoredItem)
      }
    }
    if (ambiguous.length) {
      // one batched Groq call per chunk — never one request per item
      ontaskRelevanceEngine.tiebreakBatchLater(ambiguous, onUpdate, pageContext)
    }
    return results
  },

  TIEBREAK_CHUNK: 20,
  TIEBREAK_TIMEOUT: 15000,

  tiebreakBatchLater: function (items, onUpdate, pageContext) {
    var session = focusSession.get()
    var task = ontaskRelevanceEngine.taskText
    var revision = ontaskRelevanceEngine.revision
    if (!ontaskGroqClient.available()) {
      // degraded mode: stay decisive — ambiguous resolves to hidden
      onUpdate(items.map(function (item) {
        return { id: item.id, verdict: 'hide' }
      }))
      return
    }
    for (var i = 0; i < items.length; i += ontaskRelevanceEngine.TIEBREAK_CHUNK) {
      (function (chunk) {
        var timeout = new Promise(function (resolve, reject) {
          setTimeout(function () {
            reject(new Error('tiebreak timeout'))
          }, ontaskRelevanceEngine.TIEBREAK_TIMEOUT)
        })
        Promise.race([
          ontaskGroqClient.tiebreakBatch(task, session ? session.expandedIntent : '', chunk, pageContext, session ? session.subtasks : []),
          timeout
        ]).then(function (judged) {
          if (revision !== ontaskRelevanceEngine.revision || focusSession.get() !== session) {
            return
          }
          onUpdate(judged.map(function (record) {
            var final = record.verdict === 'on' ? 'show' : 'hide'
            ontaskRelevanceEngine.verdictCache[ontaskRelevanceEngine.cacheKey(record)] = final
            return { id: record.id, verdict: final }
          }))
        }).catch(function (err) {
          // tiebreak outage: reveal rather than trap items in pending forever
          console.warn('ONTASK tiebreak batch failed, revealing:', err.message)
          onUpdate(chunk.map(function (item) {
            return { id: item.id, verdict: 'show' }
          }))
        })
      })(items.slice(i, i + ontaskRelevanceEngine.TIEBREAK_CHUNK))
    }
  },

  cacheKey: function (item) {
    return ontaskRelevanceEngine.revision + '|' + item.id + '|' + String(item.text || '').replace(/\s+/g, ' ').trim()
  },

  tiebreakLater: function (item, onUpdate) {
    var session = focusSession.get()
    var task = ontaskRelevanceEngine.taskText
    var revision = ontaskRelevanceEngine.revision
    var cacheKey = ontaskRelevanceEngine.cacheKey(item)
    if (!ontaskGroqClient.available()) {
      // degraded mode: stay decisive — ambiguous resolves to hidden
      onUpdate([{ id: item.id, verdict: 'hide' }])
      return
    }
    if (!ontaskRelevanceEngine.tiebreakInflight[cacheKey]) {
      ontaskRelevanceEngine.tiebreakInflight[cacheKey] = ontaskGroqClient.tiebreak(
        task,
        session ? session.expandedIntent : '',
        item.text,
        session ? session.subtasks : []
      ).finally(function () {
        delete ontaskRelevanceEngine.tiebreakInflight[cacheKey]
      })
    }
    ontaskRelevanceEngine.tiebreakInflight[cacheKey]
      .then(function (verdict) {
        if (revision !== ontaskRelevanceEngine.revision || focusSession.get() !== session) {
          return
        }
        var final = verdict === 'on' ? 'show' : 'hide'
        ontaskRelevanceEngine.verdictCache[cacheKey] = final
        onUpdate([{ id: item.id, verdict: final }])
      })
      .catch(function (err) {
        console.warn('ONTASK tiebreak failed, revealing:', err.message)
        onUpdate([{ id: item.id, verdict: 'show' }])
      })
  },

  finalVerdict: async function (id, text) {
    try {
      var score = await ontaskRelevanceEngine.scoreText(text)
      var band = ontaskRelevanceEngine.band(score)
      if (band === null) {
        return 'show'
      }
      if (band === 'on') {
        return 'show'
      }
      if (band === 'off') {
        return 'hide'
      }
      if (!ontaskGroqClient.available()) {
        return 'hide'
      }
      var session = focusSession.get()
      var verdict = await ontaskGroqClient.tiebreak(
        session.task,
        session.expandedIntent,
        text,
        session.subtasks
      )
      return verdict === 'on' ? 'show' : 'hide'
    } catch (err) {
      return 'show'
    }
  }
}

/* ---------- IPC: scoring pipeline ---------- */

ipc.on('ontask-cards-collected', function (e, payload) {
  var cleaned
  try {
    ontaskIPC.take(e, 'cards', 8, 1000)
    cleaned = ontaskIPC.cleanItems(e, payload)
  } catch (err) {
    return
  }
  var sender = cleaned.sender
  var items = cleaned.items
  var pageURL = cleaned.url
  var pageContext = cleaned.context
  var requestRevision = ontaskRelevanceEngine.revision
  if (!items.length) {
    return
  }

  function push (verdicts) {
    try {
      if (!sender.isDestroyed() && requestRevision === ontaskRelevanceEngine.revision &&
          ontaskIPC.canonicalPageURL(sender.getURL()) === pageURL) {
        sender.send('ontask-verdicts', { url: pageURL, verdicts: verdicts })
      }
    } catch (err) {}
  }

  if (!ontaskRelevanceEngine.enforcing()) {
    // inactive session, cold start, or failed engine: everything visible (Q11/Q27)
    push(items.map(function (it) { return { id: it.id, verdict: 'show' } }))
    if (focusSession.isActive() && ontaskRelevanceEngine.status !== 'failed') {
      // cold start: score once the model is warm, then re-apply (Q11)
      var ready = ontaskRelevanceEngine.taskReadyPromise || ontaskRelevanceEngine.ensureLoaded()
      ready.then(function () {
        if (!ontaskRelevanceEngine.enforcing()) {
          return
        }
        ontaskRelevanceEngine.scoreItems(items, push, pageURL, pageContext).then(push).catch(function () {
          push(items.map(function (it) { return { id: it.id, verdict: 'show' } }))
        })
      })
    }
    return
  }

  ontaskRelevanceEngine.scoreItems(items, push, pageURL, pageContext).then(push).catch(function () {
    push(items.map(function (it) { return { id: it.id, verdict: 'show' } }))
  })
})

ipc.handle('ontask-status', function (e) {
  ontaskIPC.requireContent(e)
  return {
    active: focusSession.isActive(),
    engine: ontaskRelevanceEngine.status,
    enforcing: ontaskRelevanceEngine.enforcing()
  }
})

// one-off text scoring (autoplay target, navigation assist)
ipc.handle('ontask-score-text', async function (e, text) {
  try {
    ontaskIPC.requireContent(e)
    ontaskIPC.take(e, 'score-text', 30, 60000)
    var score = await ontaskRelevanceEngine.scoreText(ontaskIPC.cleanText(text, 512, 1))
    return { score: score, band: ontaskRelevanceEngine.band(score) }
  } catch (err) {
    return { score: null, band: null }
  }
})

ipc.handle('ontask-final-verdict', function (e, payload) {
  ontaskIPC.requireContent(e)
  ontaskIPC.take(e, 'final-verdict', 30, 60000)
  if (!payload || typeof payload !== 'object') {
    ontaskIPC.reject()
  }
  return ontaskRelevanceEngine.finalVerdict(
    ontaskIPC.cleanText(payload.id, 256, 1),
    ontaskIPC.cleanText(payload.text, 512, 1)
  )
})

/* warm the model at app launch so the first judgment after task intake
   doesn't pay the 1-3s model load */
if (typeof app !== 'undefined' && typeof isOnTaskE2EMode !== 'undefined' && !isOnTaskE2EMode) {
  app.whenReady().then(function () {
    ontaskRelevanceEngine.ensureLoaded()
  })
}
