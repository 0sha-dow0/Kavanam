/*
OnTask GroqClient — the only cloud dependency, used exactly twice:
goal expansion at session start and the ambiguity tiebreaker.
Key comes from GROQ_API_KEY or Electron safeStorage.
Unavailable/unreachable Groq degrades to local-only mode; it never crashes.
*/

const ontaskGroqClient = {
  keyCache: undefined,
  MODEL: 'llama-3.3-70b-versatile',

  secureKeyPath: function () {
    return path.join(app.getPath('userData'), 'ontask-groq-key.enc')
  },

  legacyKeyPath: function () {
    return path.join(app.getPath('userData'), 'ontask-groq-key.txt')
  },

  legacyKeyPaths: function () {
    return [
      ontaskGroqClient.legacyKeyPath(),
      path.join(app.getPath('appData'), 'Min-development', 'ontask-groq-key.txt'),
      path.join(app.getPath('appData'), 'Min', 'ontask-groq-key.txt')
    ]
  },

  storeKey: function (key) {
    if (!electron.safeStorage.isEncryptionAvailable()) {
      return false
    }
    var encrypted = electron.safeStorage.encryptString(String(key).trim())
    ontaskWriteFileAtomic.sync(ontaskGroqClient.secureKeyPath(), encrypted.toString('base64'), {
      encoding: 'utf-8',
      mode: 0o600
    })
    ontaskGroqClient.keyCache = String(key).trim()
    return true
  },

  readStoredKey: function () {
    if (!electron.safeStorage.isEncryptionAvailable()) {
      return null
    }
    try {
      var encoded = fs.readFileSync(ontaskGroqClient.secureKeyPath(), 'utf-8')
      return electron.safeStorage.decryptString(Buffer.from(encoded, 'base64')).trim() || null
    } catch (e) {
      return null
    }
  },

  key: function () {
    if (ontaskGroqClient.keyCache !== undefined) {
      return ontaskGroqClient.keyCache
    }
    var k = process.env.GROQ_API_KEY || ontaskGroqClient.readStoredKey()
    if (!k && electron.safeStorage.isEncryptionAvailable()) {
      ontaskGroqClient.legacyKeyPaths().some(function (legacyPath) {
        try {
          var legacy = fs.readFileSync(legacyPath, 'utf-8').trim()
          if (legacy && ontaskGroqClient.storeKey(legacy)) {
            fs.unlinkSync(legacyPath)
            k = legacy
            return true
          }
        } catch (e) {}
        return false
      })
    }
    ontaskGroqClient.keyCache = k
    return k
  },

  available: function () {
    return !!ontaskGroqClient.key()
  },

  status: function () {
    if (process.env.GROQ_API_KEY) {
      return { configured: true, source: 'environment' }
    }
    return { configured: !!ontaskGroqClient.key(), source: 'secure-storage' }
  },

  clearStoredKey: function () {
    try {
      fs.unlinkSync(ontaskGroqClient.secureKeyPath())
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e
      }
    }
    ontaskGroqClient.keyCache = undefined
  },

  complete: async function (systemPrompt, userPrompt, expectJson) {
    var key = ontaskGroqClient.key()
    if (!key) {
      throw new Error('ONTASK groq: no API key')
    }
    var controller = new AbortController()
    var timer = setTimeout(function () { controller.abort() }, 8000)
    try {
      var res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key
        },
        body: JSON.stringify({
          model: ontaskGroqClient.MODEL,
          temperature: 0,
          response_format: expectJson ? { type: 'json_object' } : undefined,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      })
      if (!res.ok) {
        throw new Error('ONTASK groq: HTTP ' + res.status)
      }
      var data = await res.json()
      return data.choices[0].message.content
    } finally {
      clearTimeout(timer)
    }
  },

  // session start: task -> structured intent + keywords + seed domain allowlist (Q16)
  expandGoal: async function (task) {
    var content = await ontaskGroqClient.complete(
      'You expand a user\'s work task into search intent for a focus tool. ' +
      'The task is typed by an individual person in their own web browser — interpret ambiguous ' +
      'acronyms and shorthand as a person\'s personal task, not corporate jargon ' +
      '(e.g. for a person, "sop" almost always means statement of purpose for university ' +
      'applications, not standard operating procedure). Respond with JSON only: ' +
      '{"intent": "<one-sentence description of what content is relevant>", ' +
      '"keywords": ["..up to 12 short keywords/phrases.."], ' +
      '"domains": ["..up to 10 bare domains (no scheme) a person doing this task legitimately needs.."]}',
      'Task: ' + task,
      true
    )
    var parsed = JSON.parse(content)
    return {
      intent: typeof parsed.intent === 'string' ? parsed.intent : '',
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter(k => typeof k === 'string').slice(0, 12) : [],
      domains: Array.isArray(parsed.domains) ? parsed.domains.filter(d => typeof d === 'string').map(d => d.toLowerCase().replace(/^www\./, '')).slice(0, 10) : []
    }
  },

  /* search-query judgment: navigational queries (reaching a site) always
     pass; only content searches clearly unrelated to the task block */
  judgeSearch: async function (task, intent, query) {
    var content = await ontaskGroqClient.complete(
      'A user typed a web search during a focus session. Decide if it should be allowed. ' +
      'ALLOW navigational queries (trying to reach a specific website, app, or tool — e.g. "google", "youtube", "gmail login"). ' +
      'ALLOW content searches related to the task. ' +
      'BLOCK only content searches clearly unrelated to the task. ' +
      'Respond with JSON only: {"verdict": "allow"} or {"verdict": "block"}.',
      'Task: ' + task + (intent ? '\nTask intent: ' + intent : '') + '\nSearch query: ' + query,
      true
    )
    var parsed = JSON.parse(content)
    return parsed.verdict === 'block' ? 'block' : 'allow'
  },

  // batched ambiguity tiebreaker: one call judges a whole chunk of items,
  // instead of one request per item (which floods the API on wide feeds)
  tiebreakBatch: async function (task, intent, items, pageContext) {
    var numbered = items.map(function (item, i) {
      return (i + 1) + '. ' + String(item.text).slice(0, 200)
    }).join('\n')
    var content = await ontaskGroqClient.complete(
      'You judge whether content items are relevant to the user\'s current task. ' +
      'Mark "on" anything plausibly useful for the task — tools, services, guides, and results count even when their snippet reads like marketing. ' +
      'Mark "off" only content clearly unrelated to the task. ' +
      'Respond with JSON only, keyed by item number: {"verdicts": {"1": "on", "2": "off", ...}} — one entry per numbered item.',
      'Task: ' + task + (intent ? '\nTask intent: ' + intent : '') +
      (pageContext ? '\nThe user is currently viewing: ' + pageContext : '') +
      '\nItems:\n' + numbered,
      true
    )
    var parsed = JSON.parse(content)
    var verdicts = parsed.verdicts || {}
    return items.map(function (item, i) {
      var entry = Array.isArray(verdicts) ? verdicts[i] : verdicts[String(i + 1)]
      // a missing or malformed entry means uncertainty — never hide on that
      return { id: item.id, text: item.text, verdict: entry === 'off' ? 'off' : 'on' }
    })
  },

  /* ambiguity tiebreaker (Q8): used to decide whether a PAGE the user
     opened gets bounced — the harshest intervention, so give the benefit
     of the doubt. A person's task implies a larger goal: researching
     related people, schools, organizations, and requirements serves it. */
  tiebreak: async function (task, intent, itemText) {
    var content = await ontaskGroqClient.complete(
      'You judge whether content is relevant to the user\'s current task. ' +
      'Consider what a person doing this task plausibly needs — researching related people, ' +
      'institutions, requirements, and tools counts as relevant when it serves the task\'s ' +
      'likely larger goal. Answer "off" only for content clearly unrelated to the task ' +
      '(entertainment, shopping, unrelated topics). ' +
      'Respond with JSON only: {"verdict": "on"} or {"verdict": "off"}.',
      'Task: ' + task + (intent ? '\nTask intent: ' + intent : '') + '\nContent: ' + itemText,
      true
    )
    var parsed = JSON.parse(content)
    return parsed.verdict === 'on' ? 'on' : 'off'
  }
}

ipc.handle('ontask-groq-key-status', function (e) {
  ontaskIPC.requireChrome(e)
  return ontaskGroqClient.status()
})

ipc.handle('ontask-groq-key-set', function (e, value) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'groq-key', 5, 60000)
  var key = ontaskIPC.cleanText(value, 512, 10)
  if (!/^[!-~]+$/.test(key) || !ontaskGroqClient.storeKey(key)) {
    throw new Error('Secure key storage is unavailable')
  }
  return ontaskGroqClient.status()
})

ipc.handle('ontask-groq-key-clear', function (e) {
  ontaskIPC.requireChrome(e)
  ontaskIPC.take(e, 'groq-key', 5, 60000)
  ontaskGroqClient.clearStoredKey()
  return ontaskGroqClient.status()
})
