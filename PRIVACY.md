# OnTask Privacy

OnTask keeps your task on your machine and decides most things locally. To
judge whether something fits your task, it sends the text it needs - your task
and the titles and text of what's being checked - to Groq.

OnTask does not send your full browsing history, sell your data, show ads, or
collect telemetry.

## Stored Locally

OnTask stores the current task, a short task history, allowed domains, and
content overrides so sessions can be resumed. The bundled relevance model and
most relevance decisions run locally.

The Groq API key is stored using Electron's operating-system-backed secure
storage. It is never returned to website content or displayed after saving.

## Sent To Groq

When Groq assist is configured, OnTask sends the task for goal expansion and
the text of ambiguous items for a final relevance decision. Groq is not sent a
continuous browsing-history log or full page bodies wholesale.

Without a Groq key, OnTask remains functional in local-only mode.
