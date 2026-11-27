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
  requestAdapter(options: { powerPreference: 'high-performance' }): Promise<GpuAdapterLike | null>
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
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return fallback('no-adapter')
    const info = adapter.info
    const names = [info?.description, info?.device, info?.architecture, info?.vendor].map((s) =>
      s?.replace(/\s+/g, ' ').trim(),
    )
    if (
      adapter.isFallbackAdapter ||
      info?.isFallbackAdapter ||
      /swiftshader|llvmpipe|lavapipe|software|basic render|warp/i.test(names.join(' '))
    )
      return fallback('software')
    const device = await adapter.requestDevice()
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
  } catch {
    return fallback('request-failed')
  }
}

let probe: Promise<WebGPUState> | undefined
export const getWebGPU = () => (probe ??= detectWebGPU())
export function resetWebGPUCache() {
  probe = undefined
}
