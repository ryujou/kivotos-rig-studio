// The compute-only subset used by the studio. Keep the renderer and Node tests
// independent of WebGPU globals (including GPUBufferUsage and GPUMapMode).
export interface GpuBufferLike {
  mapAsync(mode: number): Promise<void>
  getMappedRange(): ArrayBuffer
  unmap(): void
  destroy(): void
}
interface GpuBindGroupLike {}
interface GpuBindGroupLayoutLike {}
export interface GpuComputePipelineLike {
  getBindGroupLayout(index: number): GpuBindGroupLayoutLike
}
interface GpuPassLike {
  setPipeline(pipeline: GpuComputePipelineLike): void
  setBindGroup(index: number, group: GpuBindGroupLike): void
  dispatchWorkgroups(x: number): void
  end(): void
}
export interface GpuEncoderLike {
  beginComputePass(): GpuPassLike
  copyBufferToBuffer(src: GpuBufferLike, from: number, dst: GpuBufferLike, to: number, size: number): void
  finish(): object
}
export interface GpuDeviceLike {
  lost: Promise<unknown>
  queue: {
    writeBuffer(buffer: GpuBufferLike, offset: number, data: ArrayBufferView<ArrayBufferLike>): void
    submit(commands: object[]): void
  }
  createBuffer(descriptor: { label?: string; size: number; usage: number }): GpuBufferLike
  createShaderModule(descriptor: { code: string }): object
  createComputePipeline(descriptor: {
    layout: 'auto'
    compute: { module: object; entryPoint: string }
  }): GpuComputePipelineLike
  createBindGroup(descriptor: {
    layout: GpuBindGroupLayoutLike
    entries: { binding: number; resource: { buffer: GpuBufferLike; offset?: number; size?: number } }[]
  }): GpuBindGroupLike
  createCommandEncoder(): GpuEncoderLike
  pushErrorScope?(filter: 'validation' | 'out-of-memory'): void
  popErrorScope?(): Promise<{ message: string } | null>
}
interface GpuAdapterLike {
  info?: {
    vendor?: string
    architecture?: string
    device?: string
    description?: string
    isFallbackAdapter?: boolean
  }
  isFallbackAdapter?: boolean
  requestDevice(): Promise<GpuDeviceLike>
}
export interface GpuApi {
  requestAdapter(options: {
    powerPreference?: 'high-performance'
    featureLevel?: 'compatibility'
  }): Promise<GpuAdapterLike | null>
}
export interface WebGPUState {
  status: 'probing' | 'webgpu' | 'fallback'
  label: string
  reason?: string
  device?: GpuDeviceLike
}

const listeners = new WeakMap<WebGPUState, Set<() => void>>()
export function onWebGPULost(state: WebGPUState, callback: () => void) {
  const callbacks = listeners.get(state)
  callbacks?.add(callback)
  return () => callbacks?.delete(callback)
}

export async function detectWebGPU(gpuOverride?: GpuApi | null): Promise<WebGPUState> {
  const fallback = (reason: string): WebGPUState => ({ status: 'fallback', label: '', reason })
  try {
    const gpu =
      gpuOverride !== undefined
        ? gpuOverride
        : typeof navigator !== 'undefined'
          ? (navigator as Navigator & { gpu?: GpuApi }).gpu
          : undefined
    if (!gpu?.requestAdapter) return fallback('unsupported')
    // The cloth kernels fit the compatibility profile (64 threads, four storage
    // buffers per stage). Mobile WebKit may prefer its default power policy;
    // Android Chrome can also expose compute through its GLES compatibility adapter.
    let lastReason = 'no-adapter'
    for (const options of [
      { powerPreference: 'high-performance' },
      {},
      { featureLevel: 'compatibility' },
    ] as const) {
      let adapter: GpuAdapterLike | null
      try {
        adapter = await gpu.requestAdapter(options)
      } catch {
        lastReason = 'request-failed'
        continue
      }
      if (!adapter) continue
      const info = adapter.info
      const names = [info?.description, info?.device, info?.architecture, info?.vendor].map((s) =>
        s?.replace(/\s+/g, ' ').trim(),
      )
      if (
        adapter.isFallbackAdapter ||
        info?.isFallbackAdapter ||
        /swiftshader|llvmpipe|lavapipe|software|basic render|warp/i.test(names.join(' '))
      ) {
        lastReason = 'software'
        continue
      }
      let device: GpuDeviceLike
      try {
        device = await adapter.requestDevice()
      } catch {
        lastReason = 'request-failed'
        continue
      }
      const state: WebGPUState = {
        status: 'webgpu',
        label: (names.find(Boolean) || 'WebGPU').slice(0, 36).trimEnd(),
        device,
      }
      const callbacks = new Set<() => void>()
      listeners.set(state, callbacks)
      const lost = () => {
        Object.assign(state, fallback('device-lost'))
        delete state.device
        for (const callback of callbacks) callback()
        callbacks.clear()
      }
      void device.lost.then(lost, lost)
      return state
    }
    return fallback(lastReason)
  } catch {
    return fallback('request-failed')
  }
}

let probe: Promise<WebGPUState> | undefined
export const getWebGPU = () => (probe ??= detectWebGPU())
export function resetWebGPUCache() {
  probe = undefined
}
