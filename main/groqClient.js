/*
OnTask GroqClient — the only cloud dependency, used exactly twice:
goal expansion at session start and the ambiguity tiebreaker.
Key comes from GROQ_API_KEY or <userData>/ontask-groq-key.txt.
Unavailable/unreachable Groq degrades to local-only mode; it never crashes.
*/

const ontaskGroqClient = {
  keyCache: undefined,
  MODEL: 'llama-3.1-8b-instant',

  key: function () {
    if (ontaskGroqClient.keyCache !== undefined) {
      return ontaskGroqClient.keyCache
    }
    var k = process.env.GROQ_API_KEY || null
    if (!k) {
      try {
        k = fs.readFileSync(path.join(app.getPath('userData'), 'ontask-groq-key.txt'), 'utf-8').trim() || null
      } catch (e) {}
    }
    ontaskGroqClient.keyCache = k
    return k
  },

  available: function () {
    return !!ontaskGroqClient.key()
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
      'You expand a user\'s work task into search intent for a focus tool. Respond with JSON only: ' +
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

  // ambiguity tiebreaker (Q8): strict on/off verdict for one item
  tiebreak: async function (task, intent, itemText) {
    var content = await ontaskGroqClient.complete(
      'You judge whether a content item is relevant to the user\'s current task. ' +
      'Respond with JSON only: {"verdict": "on"} or {"verdict": "off"}.',
      'Task: ' + task + (intent ? '\nTask intent: ' + intent : '') + '\nItem: ' + itemText,
      true
    )
    var parsed = JSON.parse(content)
    return parsed.verdict === 'on' ? 'on' : 'off'
  }
}
