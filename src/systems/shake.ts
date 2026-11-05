// Screen shake in logical units. offsetX/Y are refreshed by update(), so reading them allocates nothing.
export class Shake {
  offsetX = 0;
  offsetY = 0;
  private size = 0;
  private time = 0;
  private total = 1;

  add(size: number, time: number): void {
    this.size = Math.max(this.time > 0 ? this.size : 0, size);
    this.time = Math.max(this.time, time);
    this.total = this.time;
  }

  clear(): void {
    this.time = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  update(dt: number): void {
    this.time = Math.max(0, this.time - dt);
    const m = this.size * (this.time / this.total);
    this.offsetX = (Math.random() * 2 - 1) * m;
    this.offsetY = (Math.random() * 2 - 1) * m;
  }
}
