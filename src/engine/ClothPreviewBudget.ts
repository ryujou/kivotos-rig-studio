// Only self-contact work is amortized. Body contact follows every displayed pose.
export class ClothPreviewBudget {
  private elapsed = 0
  private frames = 0
  private slow = 0
  private fast = 0
  private frame = 0
  tier = 0
  stride = 1
  update(seconds: number) {
    if (!(seconds > 0) || seconds > 1) {
      this.elapsed = this.frames = this.slow = this.fast = 0
      return
    }
    this.elapsed += seconds
    this.frames++
    if (this.elapsed >= 1 - 1e-9) {
      const fps = this.frames / this.elapsed
      this.slow = fps < 30 - 1e-6 ? this.slow + 1 : 0
      this.fast = fps > 35 ? this.fast + 1 : 0
      if (this.slow >= 2 || this.fast >= 3) {
        this.tier = Math.max(0, Math.min(2, this.tier + (this.slow >= 2 ? 1 : -1)))
        this.fast = this.slow = 0
      }
      this.elapsed = this.frames = 0
    }
    this.stride = this.tier === 0 ? 1 : this.frame++ % 2 === 0 ? 1 + Number(this.tier === 2) : 0
  }
}
