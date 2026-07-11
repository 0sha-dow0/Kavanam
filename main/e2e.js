/* Deterministic scoring seam for Electron E2E tests. Never active normally. */
if (isOnTaskE2EMode) {
  var ontaskE2EMode = 'ready'

  ontaskGroqClient.keyCache = null
  ontaskGroqClient.available = function () { return false }
  ontaskGroqClient.status = function () { return { configured: false, source: 'secure-storage' } }

  ontaskRelevanceEngine.onSessionStart = function (task) {
    ontaskRelevanceEngine.taskText = task
    ontaskRelevanceEngine.taskEmbedding = [1]
    ontaskRelevanceEngine.subtaskEmbedding = null
    ontaskRelevanceEngine.status = 'ready'
    ontaskRelevanceEngine.taskReadyPromise = Promise.resolve([1])
    ontaskRelevanceEngine.invalidate()
    return ontaskRelevanceEngine.taskReadyPromise
  }
  ontaskRelevanceEngine.onGoalExpanded = async function () {}
  ontaskRelevanceEngine.onSubtask = async function () {}
  // deterministic 1-dim embeddings carrying the intended score; scoreItems
  // embeds via embedPassage then reads it back via scoreFromEmb
  var ontaskE2EScore = function (text) {
    text = String(text || '')
    if (/\[ON\]|on-task/i.test(text)) {
      return 0.9
    }
    if (/\[AMBIG\]|ambiguous/i.test(text)) {
      return 0.5
    }
    return 0.1
  }
  ontaskRelevanceEngine.embedPassage = async function (text) {
    if (ontaskE2EMode === 'outage') {
      throw new Error('E2E scoring outage')
    }
    return [ontaskE2EScore(text)]
  }
  ontaskRelevanceEngine.scoreFromEmb = function (emb) {
    return emb ? emb[0] : null
  }
  ontaskRelevanceEngine.scoreText = async function (text) {
    if (ontaskE2EMode === 'outage') {
      throw new Error('E2E scoring outage')
    }
    return ontaskE2EScore(text)
  }

  global.__ontaskE2E = {
    setEngineMode: function (mode) {
      ontaskE2EMode = mode
      if (mode === 'outage') {
        ontaskRelevanceEngine.disable(new Error('E2E scoring outage'))
      }
    }
  }
}
