/*
OnTask preload↔main IPC wiring.
Collected card batches go up to the main process; verdicts come back down
(scoring lands in Phase 3 — until then the send is a harmless no-listener).
Uses the shared `ipc` from js/preload/default.js in the concatenated bundle.
*/

var ontaskBridge = {
  sendCards: function (items) {
    try {
      ipc.send('ontask-cards-collected', { url: window.location.href, items: items })
    } catch (e) {
      console.log('ONTASK bridge send failed', e)
    }
  }
}
