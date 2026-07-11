var regedit = require('regedit')

var installPath = process.execPath

var keysToCreate = [
  'HKCU\\Software\\Classes\\OnTask',
  'HKCU\\Software\\Classes\\OnTask\\Application',
  'HKCU\\Software\\Classes\\OnTask\\DefaultIcon',
  'HKCU\\Software\\Classes\\OnTask\\shell\\open\\command',
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\Capabilities\\FileAssociations',
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\Capabilities\\StartMenu',
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\Capabilities\\URLAssociations',
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\DefaultIcon',
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\InstallInfo',
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\shell\\open\\command'
]

var registryConfig = {
  'HKCU\\Software\\RegisteredApplications': {
    OnTask: {
      value: 'Software\\Clients\\StartMenuInternet\\OnTask\\Capabilities',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Classes\\OnTask': {
    default: {
      value: 'OnTask Browser Document',
      type: 'REG_DEFAULT'
    }
  },
  'HKCU\\Software\\Classes\\OnTask\\Application': {
    ApplicationIcon: {
      value: installPath + ',0',
      type: 'REG_SZ'
    },
    ApplicationName: {
      value: 'OnTask',
      type: 'REG_SZ'
    },
    AppUserModelId: {
      value: 'OnTask.Browser',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Classes\\OnTask\\DefaultIcon': {
    ApplicationIcon: {
      value: installPath + ',0',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Classes\\OnTask\\shell\\open\\command': {
    default: {
      value: '"' + installPath + '" "%1"',
      type: 'REG_DEFAULT'
    }
  },
  'HKCU\\Software\\Classes\\.htm\\OpenWithProgIds': {
    OnTask: {
      value: 'Empty',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Classes\\.html\\OpenWithProgIds': {
    OnTask: {
      value: 'Empty',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\Capabilities\\FileAssociations': {
    '.htm': {
      value: 'OnTask',
      type: 'REG_SZ'
    },
    '.html': {
      value: 'OnTask',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\Capabilities\\StartMenu': {
    StartMenuInternet: {
      value: 'OnTask',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\Capabilities\\URLAssociations': {
    http: {
      value: 'OnTask',
      type: 'REG_SZ'
    },
    https: {
      value: 'OnTask',
      type: 'REG_SZ'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\DefaultIcon': {
    default: {
      value: installPath + ',0',
      type: 'REG_DEFAULT'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\InstallInfo': {
    IconsVisible: {
      value: 1,
      type: 'REG_DWORD'
    }
  },
  'HKCU\\Software\\Clients\\StartMenuInternet\\OnTask\\shell\\open\\command': {
    default: {
      value: installPath,
      type: 'REG_DEFAULT'
    }
  }
}

var registryInstaller = {
  install: function () {
    return new Promise(function (resolve, reject) {
      regedit.createKey(keysToCreate, function (err) {
        regedit.putValue(registryConfig, function (err) {
          if (err) {
            reject()
          } else {
            resolve()
          }
        })
      })
    })
  },
  uninstall: function () {
    return new Promise(function (resolve, reject) {
      regedit.deleteKey(keysToCreate, function (err) {
        if (err) {
          reject()
        } else {
          resolve()
        }
      })
    })
  }
}
