import qrcode from 'qrcode-generator'

/**
 * Minimal QR encoding helpers on top of `qrcode-generator` (MIT, zero deps).
 *
 * The output is a module matrix plus run-length-merged rectangles, which the PDF
 * generator draws as vector fills. Vectors rather than an embedded bitmap: one
 * fill per run keeps the content stream small, the code stays crisp at any zoom,
 * and it sidesteps every PDF/A image and colour-space question — a black fill
 * under the document's existing sRGB output intent is unambiguously conformant.
 */

/**
 * EPC069-12 mandates error correction level M for Girocodes.
 */
const ERROR_CORRECTION_LEVEL = 'M'

/**
 * `qrcode-generator` encodes byte mode via `qrcode.stringToBytes`, which is
 * `charCodeAt(i) & 0xff` — i.e. it treats the input as one byte per character.
 * So we UTF-8 encode ourselves and hand it a string whose char codes *are* the
 * bytes we want. Doing it this way keeps the library's default behaviour
 * untouched instead of monkey-patching a shared module-level function.
 */
function toBinaryString(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}

/** `matrix[row][col] === true` means a dark module. */
export function encodeQrMatrix(text: string): boolean[][] {
  const qr = qrcode(0 /* auto-size */, ERROR_CORRECTION_LEVEL)
  qr.addData(toBinaryString(text), 'Byte')
  qr.make()

  const count = qr.getModuleCount()
  const matrix: boolean[][] = []
  for (let row = 0; row < count; row++) {
    const line: boolean[] = []
    for (let col = 0; col < count; col++) line.push(qr.isDark(row, col))
    matrix.push(line)
  }
  return matrix
}

export interface QrRun {
  /** Offset from the left edge of the code, in points. */
  x: number
  /** Offset from the *top* edge of the code, in points. */
  y: number
  width: number
  height: number
}

/**
 * Flatten a module matrix into horizontal runs of dark modules, sized in points
 * so the whole code fits `sizeInPoints` square.
 *
 * `bleed` overlaps each run very slightly so that vertically adjacent rows fuse
 * instead of showing hairline seams in viewers that anti-alias abutting fills.
 * Overlapping black with black is invisible and cannot affect scannability.
 */
export function qrMatrixToRuns(matrix: boolean[][], sizeInPoints: number, bleed = 0.02): QrRun[] {
  const count = matrix.length
  if (count === 0) return []
  const module = sizeInPoints / count
  const runs: QrRun[] = []

  for (let row = 0; row < count; row++) {
    let start: number | null = null
    for (let col = 0; col <= count; col++) {
      const dark = col < count && matrix[row][col]
      if (dark && start === null) {
        start = col
      } else if (!dark && start !== null) {
        runs.push({
          x: start * module,
          y: row * module,
          width: (col - start) * module + bleed,
          height: module + bleed,
        })
        start = null
      }
    }
  }
  return runs
}
