import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverCli, execCli } from './cli'
import { MAX_VOICE_BYTES, VOICE_SAMPLE_RATE } from '../shared/voice'

export function validateVoiceAudio(value: unknown): Buffer {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 6444 ||
    value.byteLength > MAX_VOICE_BYTES
  )
    throw new Error('Record between a moment and two minutes of speech.')
  const data = Buffer.from(value)
  if (
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
    data.readUInt32LE(4) !== data.length - 8 ||
    data.readUInt32LE(16) !== 16 ||
    data.readUInt16LE(20) !== 1 ||
    data.readUInt16LE(22) !== 1 ||
    data.readUInt32LE(24) !== VOICE_SAMPLE_RATE ||
    data.readUInt32LE(28) !== VOICE_SAMPLE_RATE * 2 ||
    data.readUInt16LE(32) !== 2 ||
    data.readUInt16LE(34) !== 16 ||
    data.toString('ascii', 36, 40) !== 'data' ||
    data.readUInt32LE(40) !== data.length - 44 ||
    (data.length - 44) % 2 !== 0
  )
    throw new Error('The recording is not a supported PCM audio clip. Please record it again.')
  return data
}

export class VoiceTranscriber {
  private active?: AbortController
  private finished?: Promise<void>

  async cancel() {
    this.active?.abort()
    await this.finished
  }

  async transcribe(value: unknown, cliPath: string): Promise<string> {
    const data = validateVoiceAudio(value)
    if (this.active) throw new Error('A voice recording is already being transcribed.')
    const controller = new AbortController()
    this.active = controller
    let finish!: () => void
    this.finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    let directory: string | undefined
    try {
      const cli = await discoverCli(cliPath)
      controller.signal.throwIfAborted()
      directory = await mkdtemp(join(tmpdir(), 'muse-desktop-voice-'))
      const path = join(directory, 'recording.wav')
      await writeFile(path, data, { mode: 0o600 })
      const { stdout } = await execCli(cli.path, ['voice', 'transcribe', path], {
        env: cli.environment,
        signal: controller.signal,
        timeout: 90_000,
        maxBuffer: 256 * 1024,
        encoding: 'utf8',
      })
      const text = stdout.trim()
      if (!text)
        throw new Error('No speech was detected. Try recording again, closer to your microphone.')
      return text
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Voice transcription cancelled.')
      const failure = error as Error & { stderr?: string; killed?: boolean; code?: string }
      if (failure.killed)
        throw new Error('Voice transcription timed out. Check your connection and try again.')
      if (failure.stderr) {
        // CLI diagnostics may contain local paths; keep them out of the composer and logs.
        if (/unauth|login|sign.in|credential|401|403/i.test(failure.stderr))
          throw new Error(
            'Muse voice needs authentication. Run muse login in Terminal, then try again.',
          )
        if (/unrecognized|unexpected|unknown (command|subcommand)/i.test(failure.stderr))
          throw new Error(
            'This Muse Code version does not support voice transcription. Update your CLI and reconnect.',
          )
        throw new Error(
          'Muse Code could not transcribe this recording. Check your connection and CLI voice setup, then try again.',
        )
      }
      throw error
    } finally {
      try {
        if (directory) await rm(directory, { recursive: true, force: true })
      } finally {
        if (this.active === controller) this.active = undefined
        finish()
      }
    }
  }
}
