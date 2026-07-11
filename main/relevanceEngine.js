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
  verdictCache: {}, // itemId -> 'show' | 'hide' (includes resolved tiebreaks)
  bands: { on: 0.55, off: 0.40 },

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
        ontaskRelevanceEngine.status = 'failed' // fail open: no enforcement (Q27)
        console.warn('ONTASK engine failed to load — enforcement disabled:', err.message)
        return null
      })
    return ontaskRelevanceEngine.loadPromise
  },

  embed: async function (text) {
    var extractor = await ontaskRelevanceEngine.ensureLoaded()
    if (!extractor) {
      return null
    }
    var output = await extractor(String(text).slice(0, 512), { pooling: 'mean', normalize: true })
    return output.data
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

  onSessionStart: async function (task) {
    ontaskRelevanceEngine.taskText = task
    ontaskRelevanceEngine.subtaskEmbedding = null
    ontaskRelevanceEngine.verdictCache = {}
    ontaskRelevanceEngine.taskEmbedding = await ontaskRelevanceEngine.embed(task)
    if (ontaskRelevanceEngine.taskEmbedding) {
      console.log('ONTASK task embedded (' + ontaskRelevanceEngine.taskEmbedding.length + ' dims)')
    }
  },

  onSubtask: async function (subtask) {
    ontaskRelevanceEngine.subtaskEmbedding = await ontaskRelevanceEngine.embed(subtask)
  },

  onSessionEnd: function () {
    ontaskRelevanceEngine.taskText = null
    ontaskRelevanceEngine.taskEmbedding = null
    ontaskRelevanceEngine.subtaskEmbedding = null
    ontaskRelevanceEngine.verdictCache = {}
  },

  enforcing: function () {
    return ontaskRelevanceEngine.status === 'ready' &&
      !!ontaskRelevanceEngine.taskEmbedding &&
      focusSession.isActive()
  },

  // score = max(sim(task), sim(subtask)) — Q10
  scoreText: async function (text) {
    if (!ontaskRelevanceEngine.enforcing()) {
      return null
    }
    var emb = await ontaskRelevanceEngine.embed(text)
    if (!emb) {
      return null
    }
    var s1 = ontaskRelevanceEngine.similarity(emb, ontaskRelevanceEngine.taskEmbedding)
    var s2 = ontaskRelevanceEngine.similarity(emb, ontaskRelevanceEngine.subtaskEmbedding)
    return Math.max(s1 === null ? -1 : s1, s2 === null ? -1 : s2)
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
  scoreItems: async function (items, onUpdate) {
    var results = []
    for (var i = 0; i < items.length; i++) {
      var item = items[i]
      var cached = ontaskRelevanceEngine.verdictCache[item.id]
      if (cached) {
        results.push({ id: item.id, verdict: cached })
        continue
      }
      var score = await ontaskRelevanceEngine.scoreText(item.text)
      var band = ontaskRelevanceEngine.band(score)
      if (band === null) {
        results.push({ id: item.id, verdict: 'show' }) // engine off: fail open
      } else if (band === 'on') {
        ontaskRelevanceEngine.verdictCache[item.id] = 'show'
        results.push({ id: item.id, verdict: 'show' })
      } else if (band === 'off') {
        ontaskRelevanceEngine.verdictCache[item.id] = 'hide'
        results.push({ id: item.id, verdict: 'hide' })
      } else {
        results.push({ id: item.id, verdict: 'pending' })
        ontaskRelevanceEngine.tiebreakLater(item, onUpdate)
      }
    }
    return results
  },

  tiebreakLater: function (item, onUpdate) {
    var session = focusSession.get()
    var task = ontaskRelevanceEngine.taskText
    if (!ontaskGroqClient.available()) {
      // degraded mode: stay decisive — ambiguous resolves to hidden
      onUpdate([{ id: item.id, verdict: 'hide' }])
      return
    }
    ontaskGroqClient.tiebreak(task, session ? session.expandedIntent : '', item.text)
      .then(function (verdict) {
        var final = verdict === 'on' ? 'show' : 'hide'
        ontaskRelevanceEngine.verdictCache[item.id] = final // cached by id (Q8)
        onUpdate([{ id: item.id, verdict: final }])
      })
      .catch(function (err) {
        console.warn('ONTASK tiebreak failed, hiding:', err.message)
        onUpdate([{ id: item.id, verdict: 'hide' }]) // not cached: retried next visit
      })
  }
}

/* ---------- IPC: scoring pipeline ---------- */

ipc.on('ontask-cards-collected', function (e, payload) {
  var sender = e.sender
  var items = (payload && payload.items) || []
  if (!items.length) {
    return
  }

  function push (verdicts) {
    try {
      if (!sender.isDestroyed()) {
        sender.send('ontask-verdicts', { verdicts: verdicts })
      }
    } catch (err) {}
  }

  if (!ontaskRelevanceEngine.enforcing()) {
    // inactive session, cold start, or failed engine: everything visible (Q11/Q27)
    push(items.map(function (it) { return { id: it.id, verdict: 'show' } }))
    if (focusSession.isActive() && ontaskRelevanceEngine.status !== 'failed') {
      // cold start: score once the model is warm, then re-apply (Q11)
      ontaskRelevanceEngine.ensureLoaded().then(function (extractor) {
        if (!extractor || !ontaskRelevanceEngine.enforcing()) {
          return
        }
        ontaskRelevanceEngine.scoreItems(items, push).then(push)
      })
    }
    return
  }

  ontaskRelevanceEngine.scoreItems(items, push).then(push)
})

ipc.handle('ontask-status', function () {
  return {
    active: focusSession.isActive(),
    engine: ontaskRelevanceEngine.status,
    enforcing: ontaskRelevanceEngine.enforcing()
  }
})

// one-off text scoring (autoplay target, navigation assist)
ipc.handle('ontask-score-text', async function (e, text) {
  var score = await ontaskRelevanceEngine.scoreText(String(text || ''))
  return { score: score, band: ontaskRelevanceEngine.band(score) }
})
