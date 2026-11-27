// Keep Three's real scene graph, cameras, animation mixers and controls. Stand in
// only for the WebGL canvas when the Node suite runs without a display.
export * from 'three'
export class WebGLRenderer {
  domElement = Object.assign(new EventTarget(), {
    style: {},
    ownerDocument: new EventTarget(),
    getRootNode() {
      return this.ownerDocument
    },
    remove() {},
  })
  capabilities = { getMaxAnisotropy: () => 1 }
  shadowMap = {}
  alpha = 0
  rendered = 0
  setClearColor(_, alpha) {
    this.alpha = alpha
  }
  setClearAlpha(alpha) {
    this.alpha = alpha
  }
  getClearAlpha() {
    return this.alpha
  }
  getPixelRatio() {
    return this.ratio
  }
  getContext() {
    return { isContextLost: () => false }
  }
  setDrawingBufferSize(width, height, ratio) {
    this.ratio = ratio
    this.domElement.width = width * ratio
    this.domElement.height = height * ratio
  }
  render() {
    this.rendered++
  }
  dispose() {}
}
