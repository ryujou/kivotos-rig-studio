// gifenc 1.0.x ships JavaScript without declarations.
declare module 'gifenc/dist/gifenc.esm.js' {
  type Format = 'rgb565' | 'rgb444' | 'rgba4444'
  export function quantize(
    rgba: Uint8ClampedArray,
    colors: number,
    options: {
      format: Format
      oneBitAlpha?: boolean
    },
  ): number[][]
  export function applyPalette(rgba: Uint8ClampedArray, palette: number[][], format: Format): Uint8Array
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        palette?: number[][]
        transparent: boolean
        transparentIndex: number
        dispose: number
        delay: number
        repeat: number
      },
    ): void
    finish(): void
    bytesView(): Uint8Array<ArrayBuffer>
  }
}
