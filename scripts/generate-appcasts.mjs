import { execFileSync } from 'node:child_process'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdtemp, readFile, writeFile, copyFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { config, prepareSparkle, root } from './prepare-sparkle.mjs'

const { version } = JSON.parse(await readFile(join(root, 'package.json')))
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error('The stable feed requires a stable semver version.')
const sparkle = await prepareSparkle()
const key = process.env.SPARKLE_PRIVATE_KEY
if (key) {
  const seed = Buffer.from(key.trim(), 'base64')
  if (seed.length !== 32) throw new Error('Expected the 32-byte Sparkle Ed25519 seed in base64.')
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  })
  const publicKey = createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64')
  if (publicKey !== config.publicKey)
    throw new Error('The signing key does not match the embedded public key.')
}
const temporary = await mkdtemp(join(tmpdir(), 'muse-appcast-'))
const output = resolve(root, 'release/appcasts')
await mkdir(output, { recursive: true })
try {
  for (const arch of ['arm64', 'x64']) {
    const name = `Muse Desktop-${version}-${arch}.zip`
    const source = join(root, 'release', name)
    const appDirectory = join(temporary, `${arch}-verify`)
    execFileSync('/usr/bin/ditto', ['-xk', source, appDirectory])
    const app = join(appDirectory, 'Muse Desktop.app')
    // Inspect the actual archived app, not a different app left in the build folder.
    for (const [command, args] of [
      ['/usr/bin/codesign', ['--verify', '--deep', '--strict', app]],
      ['/usr/sbin/spctl', ['--assess', '--type', 'execute', app]],
      ['/usr/bin/xcrun', ['stapler', 'validate', app]],
    ])
      execFileSync(command, args, { stdio: 'inherit' })
    const publicKey = execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :SUPublicEDKey', join(app, 'Contents/Info.plist')],
      { encoding: 'utf8' },
    ).trim()
    if (publicKey !== config.publicKey)
      throw new Error('The archive uses a different Sparkle public key.')
    const appVersion = execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents/Info.plist')],
      { encoding: 'utf8' },
    ).trim()
    if (appVersion !== version) throw new Error('The archive version does not match package.json.')
    const architecture = execFileSync(
      '/usr/bin/lipo',
      ['-archs', join(app, 'Contents/MacOS/Muse Desktop')],
      { encoding: 'utf8' },
    ).trim()
    if (architecture !== (arch === 'x64' ? 'x86_64' : 'arm64'))
      throw new Error('The archive has the wrong architecture.')
    const archives = join(temporary, arch)
    await mkdir(archives)
    await copyFile(source, join(archives, name))
    const feed = join(archives, 'appcast.xml')
    await copyFile(join(root, `updates/appcast-${arch}.xml`), feed)
    const keyArguments = key ? ['--ed-key-file', '-'] : ['--account', config.keychainAccount]
    const result = execFileSync(
      join(sparkle, 'bin/generate_appcast'),
      [
        ...keyArguments,
        '--maximum-deltas',
        '0',
        '--maximum-versions',
        '3',
        '--download-url-prefix',
        `https://github.com/${config.repository}/releases/download/v${version}/`,
        '--link',
        `https://github.com/${config.repository}/releases/tag/v${version}`,
        '-o',
        feed,
        archives,
      ],
      { input: key, encoding: 'utf8' },
    )
    console.log(result)
    // Generation must produce a signed enclosure before the feed can be published.
    if (!(await readFile(feed, 'utf8')).includes('sparkle:edSignature='))
      throw new Error('No signed update enclosure was generated.')
    execFileSync(join(sparkle, 'bin/sign_update'), [...keyArguments, '--verify', feed], {
      input: key,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
    await writeFile(join(output, `appcast-${arch}.xml`), await readFile(feed))
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
