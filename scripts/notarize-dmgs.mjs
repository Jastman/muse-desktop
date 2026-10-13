import { execFileSync } from 'node:child_process'
import { notarize } from '@electron/notarize'

export default async function notarizeDiskImages({ artifactPaths, configuration }) {
  const images = artifactPaths.filter((path) => path.endsWith('.dmg'))
  if (
    !images.length ||
    configuration.mac?.identity === null ||
    configuration.mac?.notarize === false
  )
    return []
  let credentials
  if (process.env.APPLE_KEYCHAIN_PROFILE) {
    credentials = {
      keychainProfile: process.env.APPLE_KEYCHAIN_PROFILE,
      keychain: process.env.APPLE_KEYCHAIN,
    }
  } else if (
    process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID
  ) {
    credentials = {
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID,
    }
  } else if (
    process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER
  ) {
    credentials = {
      appleApiKey: process.env.APPLE_API_KEY,
      appleApiKeyId: process.env.APPLE_API_KEY_ID,
      appleApiIssuer: process.env.APPLE_API_ISSUER,
    }
  } else {
    throw new Error(
      'Notarization credentials are required for release disk images. See docs/releasing.md.',
    )
  }
  for (const appPath of images) {
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', appPath], { stdio: 'inherit' })
    console.log(`Notarizing disk image: ${appPath}`)
    await notarize({ appPath, ...credentials })
    execFileSync('/usr/bin/xcrun', ['stapler', 'validate', appPath], { stdio: 'inherit' })
    execFileSync(
      '/usr/sbin/spctl',
      ['--assess', '--type', 'open', '--context', 'context:primary-signature', appPath],
      { stdio: 'inherit' },
    )
  }
  return []
}
