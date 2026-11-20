export interface TimelinePhase {
  id: string;
  label: string;
  start: number;
  end: number;
  badgeStyle?: 'normal' | 'frozen' | 'burst';
}

export class Timeline {
  public time = 0;
  public duration = 22;
  public playing = true;
  public speed = 1.0;
  public loop = true;
  public phases: TimelinePhase[] = [];

  public configure(duration: number, phases: TimelinePhase[]): void {
    this.duration = duration;
    this.phases = phases;
    this.time = 0;
  }

  public advance(realDt: number): { delta: number; completed: boolean } {
    if (!this.playing) return { delta: 0, completed: false };
    const clampedDt = Math.min(realDt, 0.05);
    const delta = clampedDt * this.speed;
    this.time += delta;
    if (this.time >= this.duration) {
      if (this.loop) {
        this.time = this.time % this.duration;
        return { delta, completed: true };
      } else {
        this.time = this.duration;
        this.playing = false;
        return { delta, completed: true };
      }
    }
    return { delta, completed: false };
  }

  public setTime(seconds: number): void {
    this.time = Math.max(0, Math.min(this.duration, seconds));
  }

  public getCurrentPhase(): TimelinePhase | null {
    for (let i = this.phases.length - 1; i >= 0; i--) {
      if (this.time >= this.phases[i].start) {
        return this.phases[i];
      }
    }
    return this.phases[0] ?? null;
  }
}
