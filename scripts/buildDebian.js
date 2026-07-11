const builder = require('electron-builder')
const Platform = builder.Platform
const Arch = builder.Arch

const createPackage = require('./createPackage.js')

async function afterPackageBuilt (path, arch) {
  var installerOptions = {
    artifactName: 'ontask-${version}-${arch}.deb',
    packageName: 'ontask',
    icon: 'icons/icon256.png',
    category: 'Network;WebBrowser',
    packageCategory: 'Network',
    mimeTypes: ['x-scheme-handler/http', 'x-scheme-handler/https', 'text/html'],
    maintainer: 'OnTask contributors',
    description: 'OnTask is a focus browser that keeps the web aligned with one task.',
    synopsis: 'A local-first focus browser with relevance-aware content and navigation protection.',
    depends: [
      'libsecret-1-0',
      'libasound2',
      'libc6',
      'libcap2',
      'libgtk2.0-0',
      'libudev0 | libudev1',
      'libgcrypt11 | libgcrypt20',
      'libnotify4',
      'libnss3',
      'libxss1',
      'libxtst6',
      'python | python3',
      'xdg-utils'
    ],
    afterInstall: 'resources/postinst_script',
    afterRemove: 'resources/prerm_script'
  }

  console.log('Creating package (this may take a while)')

  const options = {
    linux: {
      target: ['deb']
    },
    directories: {
      buildResources: 'resources',
      output: 'dist/app/'
    },
    deb: installerOptions,
    publish: null
  }

  await builder.build({
    prepackaged: path,
    targets: Platform.LINUX.createTarget(['deb'], arch),
    config: options
  })
    .then(() => console.log('Successfully created package.'))
    .catch(err => {
      console.error(err, err.stack)
      process.exit(1)
    })
}

const arches = [Arch.x64];

(async () => {
  for (const arch of arches) {
    await createPackage('linux', { arch: arch }).then(path => afterPackageBuilt(path, arch))
  }
})()
