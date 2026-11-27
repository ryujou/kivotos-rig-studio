import { AnimationMixer, LoopOnce, type AnimationAction, type AnimationClip, type Object3D } from 'three'

// Absolute sampling retains the GLTFLoader interpolant factories (including cubic splines).
export class ClipPlayer {
  private readonly mixer: AnimationMixer
  private action?: AnimationAction
  constructor(private root: Object3D) {
    this.mixer = new AnimationMixer(root)
  }
  sample(clip: AnimationClip | undefined, time: number) {
    if (clip !== this.action?.getClip()) {
      this.action?.stop()
      this.action = clip ? this.mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play() : undefined
      if (this.action) this.action.clampWhenFinished = true
    }
    if (this.action) {
      this.action.time = time
      this.mixer.update(0)
    }
    this.root.updateWorldMatrix(true, true)
  }
  dispose() {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.root)
  }
}
