// Sends a take to the local likeness server (backend/server.py) for a YAMNet bark probability.
// The browser decodes and resamples the take to 16 kHz mono, so the server needs no FFmpeg.

const YAMNET_SR = 16000

export interface LikenessResult {
  probability: number
  durationS: number
  top: { name: string; score: number }[]
}

async function toMono16k(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
  } finally {
    void ctx.close()
  }
  // A one-channel offline context downmixes and resamples in one render.
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * YAMNET_SR), YAMNET_SR)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  return (await offline.startRendering()).getChannelData(0)
}

export async function scoreLikeness(blob: Blob): Promise<LikenessResult> {
  let samples: Float32Array
  try {
    samples = await toMono16k(blob)
  } catch {
    throw new Error('This browser couldn’t decode the take, so it can’t be scored here.')
  }

  let res: Response
  try {
    res = await fetch(`/api/likeness?sr=${YAMNET_SR}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Blob([new Float32Array(samples)]),
    })
  } catch {
    throw new Error('The scoring server isn’t reachable. Start it with python backend/server.py.')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(body?.error ?? 'The scoring server isn’t reachable. Start it with python backend/server.py.')
  }
  return body as LikenessResult
}
