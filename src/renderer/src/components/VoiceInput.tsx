import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Mic, Square, X } from 'lucide-react'
import { encodeVoiceWav, MAX_VOICE_SECONDS } from '../../../shared/voice'
import { IconButton } from './Primitives'

type Phase = 'idle' | 'permission' | 'recording' | 'transcribing'

export function VoiceInput({
  disabled,
  onText,
  onError,
  onBusy,
}: {
  disabled: boolean
  onText: (text: string) => void
  onError: (message: string) => void
  onBusy: (busy: boolean) => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const capture = useRef<{
    recorder?: MediaRecorder
    stream?: MediaStream
    timer?: ReturnType<typeof setInterval>
    generation: number
  }>({ generation: 0 })
  const callbacks = useRef({ onText, onError, onBusy })
  callbacks.current = { onText, onError, onBusy }
  const busy = useRef(false)

  const release = () => {
    clearInterval(capture.current.timer)
    capture.current.stream?.getTracks().forEach((track) => track.stop())
    capture.current.stream = undefined
    capture.current.recorder = undefined
  }
  const cancel = () => {
    capture.current.generation++
    const recorder = capture.current.recorder
    if (recorder?.state === 'recording') recorder.stop()
    release()
    busy.current = false
    callbacks.current.onBusy(false)
    setPhase('idle')
    void window.muse.cancelVoice().catch((error: Error) => callbacks.current.onError(error.message))
  }
  useEffect(
    () => () => {
      capture.current.generation++
      const recorder = capture.current.recorder
      if (recorder?.state === 'recording') recorder.stop()
      release()
      callbacks.current.onBusy(false)
      if (busy.current)
        void window.muse.cancelVoice().catch(() => {
          /* Window teardown: no UI remains. */
        })
    },
    [],
  )

  const toggle = async () => {
    if (phase === 'recording') {
      capture.current.recorder?.stop()
      return
    }
    if (busy.current || disabled) return
    busy.current = true
    callbacks.current.onBusy(true)
    setPhase('permission')
    const generation = ++capture.current.generation
    try {
      await window.muse.requestMicrophone()
      if (generation !== capture.current.generation) return
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      })
      if (generation !== capture.current.generation) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      capture.current.stream = stream
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      capture.current.recorder = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onerror = () => {
        cancel()
        callbacks.current.onError(
          'The microphone stopped recording. Check your input device and try again.',
        )
      }
      recorder.onstop = () => {
        if (generation !== capture.current.generation) return
        release()
        setPhase('transcribing')
        void (async () => {
          const context = new AudioContext()
          try {
            const audio = await context.decodeAudioData(
              await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer(),
            )
            if (generation !== capture.current.generation) return
            const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
              audio.getChannelData(i),
            )
            const text = await window.muse.transcribeVoice(
              encodeVoiceWav(channels, audio.sampleRate),
            )
            if (generation === capture.current.generation) callbacks.current.onText(text)
          } catch (error) {
            if (generation === capture.current.generation)
              callbacks.current.onError(
                error instanceof Error
                  ? error.message
                  : 'Voice transcription failed. Please try again.',
              )
          } finally {
            await context.close()
            if (generation === capture.current.generation) {
              busy.current = false
              callbacks.current.onBusy(false)
              setPhase('idle')
            }
          }
        })()
      }
      recorder.start(250)
      setSeconds(0)
      setPhase('recording')
      const started = Date.now()
      capture.current.timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000)
        setSeconds(elapsed)
        // Leave room for the final encoder frame before the two-minute limit.
        if (elapsed >= MAX_VOICE_SECONDS - 1 && recorder.state === 'recording') recorder.stop()
      }, 250)
    } catch (error) {
      if (generation !== capture.current.generation) return
      release()
      busy.current = false
      callbacks.current.onBusy(false)
      setPhase('idle')
      callbacks.current.onError(
        error instanceof Error && error.name === 'NotAllowedError'
          ? 'Microphone access is off. Enable Muse Desktop in System Settings → Privacy & Security → Microphone.'
          : error instanceof Error
            ? error.message
            : 'Could not start your microphone.',
      )
    }
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        event.code === 'KeyV' &&
        !event.repeat &&
        !document.querySelector('dialog[open]')
      ) {
        event.preventDefault()
        void toggle()
      }
      if (event.key === 'Escape' && busy.current) {
        event.preventDefault()
        cancel()
      }
    }
    const visibility = () => {
      if (document.hidden && busy.current) cancel()
    }
    const voiceCommand = () => {
      void toggle()
    }
    window.addEventListener('keydown', shortcut)
    window.addEventListener('muse:voice', voiceCommand)
    window.addEventListener('muse:voice-cancel', cancel)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('keydown', shortcut)
      window.removeEventListener('muse:voice', voiceCommand)
      window.removeEventListener('muse:voice-cancel', cancel)
      document.removeEventListener('visibilitychange', visibility)
    }
  })

  return (
    <div className={`voice-control ${phase === 'recording' ? 'recording' : ''}`}>
      <IconButton
        label={phase === 'recording' ? 'Stop recording (⌥V)' : 'Voice input (⌥V)'}
        disabled={
          phase === 'transcribing' || phase === 'permission' || (phase === 'idle' && disabled)
        }
        active={phase === 'recording'}
        onClick={() => {
          void toggle()
        }}
      >
        {phase === 'recording' ? (
          <Square size={15} fill="currentColor" />
        ) : phase === 'idle' ? (
          <Mic size={17} />
        ) : (
          <LoaderCircle size={17} className="spin" />
        )}
      </IconButton>
      {phase !== 'idle' && (
        <div className="voice-status" role="status">
          <span>
            {phase === 'recording'
              ? `Listening · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
              : phase === 'transcribing'
                ? 'Transcribing with Muse…'
                : 'Opening microphone…'}
          </span>
          <IconButton label="Cancel voice input" onClick={cancel}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  )
}
