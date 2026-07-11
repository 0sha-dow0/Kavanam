// OnTask intentionally collects no telemetry. Keep this compatibility API
// because existing Min modules record counters through it.
const statistics = {
  registerGetter: function () {},
  getValue: function () {},
  setValue: function () {},
  incrementValue: function () {},
  upload: function () {},
  initialize: function () {
    var settings = require('util/settings/settings.js')
    settings.set('collectUsageStats', false)
    settings.set('usageData', null)
    settings.set('clientID', undefined)
    settings.set('installTime', undefined)
  }
}

module.exports = statistics
