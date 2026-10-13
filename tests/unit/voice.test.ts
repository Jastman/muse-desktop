import { describe, expect, it } from 'vitest'
import { encodeVoiceWav, MAX_VOICE_BYTES, VOICE_SAMPLE_RATE } from '../../src/shared/voice'
import { validateVoiceAudio } from '../../src/main/voice'

describe('Voice recording boundary', () => {
  it('downmixes stereo and resamples browser audio to a valid 16 kHz PCM WAV', () => {
    const left = new Float32Array(48000).fill(0.75)
    const right = new Float32Array(48000).fill(0.25)
    const wav = validateVoiceAudio(encodeVoiceWav([left, right], 48000))
    expect(wav.length).toBe(44 + VOICE_SAMPLE_RATE * 2)
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.readInt16LE(44)).toBe(16384)
  })
  it('clips audio safely and rejects short, oversized and malformed clips', () => {
    const wav = encodeVoiceWav([new Float32Array(16000).fill(-2)], 16000)
    expect(validateVoiceAudio(wav).readInt16LE(44)).toBe(-32768)
    expect(() => encodeVoiceWav([new Float32Array(50)], 16000)).toThrow('at least')
    expect(() => validateVoiceAudio(new Uint8Array(MAX_VOICE_BYTES + 1))).toThrow('two minutes')
    wav[20] = 3 // Floats cannot be passed off as PCM16.
    expect(() => validateVoiceAudio(wav)).toThrow('PCM')
    expect(() => validateVoiceAudio('/some/local/file.wav')).toThrow()
  })
})
