// mod-prompts / hooks/tail.ts, by v-amorim
// Reads a byte range of a file through a process, for files past what one fs.read takes. Copied from mod-transcript.

// Bytes per process read: base64 grows a third, so the output stays under the 4 MiB the process result keeps.
export const CHUNK_BYTES = 2 * 1024 * 1024

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// The command that prints `length` bytes of `path` from byte `from`, as base64 so no byte is lost in decoding. Windows reads through PowerShell, elsewhere through tail and head.
export function chunkArgv(path: string, from: number, length: number): string[] {
  if (/^[A-Za-z]:|\\/.test(path)) {
    const quoted = path.replace(/'/g, "''")
    return ['powershell', '-NoProfile', '-NonInteractive', '-Command', `$s = [IO.File]::OpenRead('${quoted}'); try { [void]$s.Seek(${from}, 'Begin'); $b = [byte[]]::new(${length}); $n = $s.Read($b, 0, $b.Length); [Convert]::ToBase64String($b, 0, $n) } finally { $s.Dispose() }`]
  }
  return ['sh', '-c', 'tail -c +"$2" "$1" | head -c "$3" | base64 | tr -d "\\n"', 'sh', path, String(from + 1), String(length)]
}

// Decodes base64 by hand: the mod runtime does not promise atob.
export function bytesOf(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let value = 0
  let at = 0
  for (const char of clean) {
    value = (value << 6) | BASE64.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at++] = (value >> bits) & 0xff
    }
  }
  return out
}

// UTF-8 to text by hand, for the same reason; a broken sequence becomes U+FFFD.
export function textOf(bytes: Uint8Array): string {
  let out = ''
  for (let at = 0; at < bytes.length; ) {
    const lead = bytes[at]!
    const extra = lead < 0x80 ? 0 : lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : -1
    if (extra < 0 || at + extra >= bytes.length) {
      out += '�'
      at++
      continue
    }
    let code = extra === 0 ? lead : lead & (0x3f >> extra)
    for (let k = 1; k <= extra; k++) code = (code << 6) | (bytes[at + k]! & 0x3f)
    out += String.fromCodePoint(code)
    at += extra + 1
  }
  return out
}

// Whole lines of the file's last `maxChunks` chunks, newest chunk first, each handed to `visit` as text; `visit` returns a value to stop. A line cut by a chunk start joins the chunk before it. Copied from mod-wrap-up.
export async function scanTail<T>(
  size: number,
  maxChunks: number,
  readChunk: (from: number, length: number) => Promise<Uint8Array>,
  visit: (text: string) => T | undefined,
): Promise<T | undefined> {
  let end = size
  let carry = new Uint8Array(0)
  for (let chunk = 0; chunk < maxChunks && end > 0; chunk++) {
    const from = Math.max(0, end - CHUNK_BYTES)
    const read = await readChunk(from, end - from)
    const joined = new Uint8Array(read.length + carry.length)
    joined.set(read)
    joined.set(carry, read.length)
    const firstBreak = from > 0 ? joined.indexOf(0x0a) : -1
    carry = from > 0 ? joined.slice(0, firstBreak < 0 ? joined.length : firstBreak) : new Uint8Array(0)
    const whole = from > 0 ? (firstBreak < 0 ? new Uint8Array(0) : joined.slice(firstBreak + 1)) : joined
    const found = visit(textOf(whole))
    if (found !== undefined) return found
    end = from
  }
  return undefined
}

// How many bytes the text takes in UTF-8, without building them.
export function utf8Length(text: string) {
  let bytes = 0
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      at++
    } else bytes += 3
  }
  return bytes
}
