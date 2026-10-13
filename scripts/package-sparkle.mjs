import { execFileSync } from 'node:child_process'
import { mkdir, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config, prepareSparkle, root } from './prepare-sparkle.mjs'

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') throw new Error('Muse Desktop requires macOS.')
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  if (!arch) throw new Error('Build Apple Silicon and Intel as separate architectures.')
  const sparkle = await prepareSparkle()
  const contents = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app/Contents`,
  )
  const framework = join(contents, 'Frameworks/Sparkle.framework')
  await rm(framework, { recursive: true, force: true })
  execFileSync('/usr/bin/ditto', [join(sparkle, 'Sparkle.framework'), framework])
  // These optional services are only for App Sandbox, which the CLI host cannot use.
  await rm(join(framework, 'Versions/B/XPCServices'), { recursive: true, force: true })
  await rm(join(framework, 'XPCServices'), { force: true })
  const resources = join(contents, 'Resources')
  await mkdir(resources, { recursive: true })
  await copyFile(join(sparkle, 'LICENSE'), join(resources, 'Sparkle-LICENSE.txt'))
  execFileSync(
    '/usr/bin/xcrun',
    [
      'clang++',
      '-std=c++17',
      '-fobjc-arc',
      '-fblocks',
      '-bundle',
      '-mmacosx-version-min=13.0',
      '-arch',
      arch === 'x64' ? 'x86_64' : 'arm64',
      '-I',
      join(root, 'node_modules/node-api-headers/include'),
      '-F',
      sparkle,
      '-framework',
      'Cocoa',
      '-framework',
      'Sparkle',
      '-undefined',
      'dynamic_lookup',
      '-Wl,-rpath,@loader_path/../Frameworks',
      join(root, 'native/sparkle.mm'),
      '-o',
      join(resources, 'sparkle.node'),
    ],
    { stdio: 'inherit' },
  )
  const plist = join(contents, 'Info.plist')
  const values = {
    SUFeedURL: [
      'string',
      `https://raw.githubusercontent.com/${config.repository}/main/updates/appcast-${arch}.xml`,
    ],
    SUPublicEDKey: ['string', config.publicKey],
    SUEnableAutomaticChecks: ['bool', 'false'],
    SUAllowsAutomaticUpdates: ['bool', 'false'],
    SUEnableSystemProfiling: ['bool', 'false'],
    SUVerifyUpdateBeforeExtraction: ['bool', 'true'],
    SURequireSignedFeed: ['bool', 'true'],
  }
  for (const [key, [type, value]] of Object.entries(values)) {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist])
  }
}
