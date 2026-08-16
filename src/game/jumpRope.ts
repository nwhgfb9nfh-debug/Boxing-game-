// Jump Rope training minigame (Section 4, Endurance stat): 16 beats at a
// fixed rhythm, tap in sync without breaking stride. Graded per beat
// (Perfect/Good/Miss). Unlike Reflex Dots' random single targets, the
// beat is a fixed, predictable metronome — a bouncing marker peaks
// (ground contact) exactly on each beat, and tapping anywhere on screen
// near that moment scores it.

export type JumpRopeResult = "perfect" | "good" | "miss";
export type JumpRopePhase = "countdown" | "active" | "summary";

const BEATS = 16;
const BEAT_INTERVAL = 0.62; // seconds between beats — the fixed rhythm
const PERFECT_WINDOW = 0.1; // +/- seconds around the beat for Perfect
const GOOD_WINDOW = 0.22; // +/- seconds around the beat for Good
const LEAD_IN = BEAT_INTERVAL * 2; // two practice bounces before beat 0 counts
const FLASH_DURATION = 0.25; // seconds the marker holds its result color

export class JumpRopeScene {
  private phase: JumpRopePhase = "countdown";
  private elapsed = 0;
  private beatIndex = 0;
  private results: JumpRopeResult[] = [];
  private scoredThisBeat = false;
  private flash: { result: JumpRopeResult; timer: number } | null = null;

  update(dt: number) {
    if (this.phase === "summary") return;
    this.elapsed += dt;

    if (this.flash) {
      this.flash.timer -= dt;
      if (this.flash.timer <= 0) this.flash = null;
    }

    if (this.phase === "countdown") {
      if (this.elapsed >= LEAD_IN) this.phase = "active";
      return;
    }

    const beatTime = LEAD_IN + this.beatIndex * BEAT_INTERVAL;
    if (!this.scoredThisBeat && this.elapsed >= beatTime + GOOD_WINDOW) {
      this.recordBeat("miss");
    }
  }

  /** Call on any tap — ignored unless it lands within the current beat's window. */
  handleTap() {
    if (this.phase !== "active" || this.scoredThisBeat) return;
    const beatTime = LEAD_IN + this.beatIndex * BEAT_INTERVAL;
    const delta = Math.abs(this.elapsed - beatTime);
    if (delta > GOOD_WINDOW) return; // nowhere near a beat — ignore, don't waste it
    this.recordBeat(delta <= PERFECT_WINDOW ? "perfect" : "good");
  }

  private recordBeat(result: JumpRopeResult) {
    this.results.push(result);
    this.flash = { result, timer: FLASH_DURATION };
    this.beatIndex++;
    this.scoredThisBeat = false;
    if (this.beatIndex >= BEATS) this.phase = "summary";
  }

  isDone(): boolean {
    return this.phase === "summary";
  }

  getResults(): JumpRopeResult[] {
    return this.results;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.save();
    ctx.fillStyle = "#171a21";
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText("Jump Rope", width / 2, 60);

    if (this.phase === "summary") {
      this.renderSummary(ctx, width, height);
      ctx.restore();
      return;
    }

    ctx.font = "16px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    const beatLabel = this.phase === "countdown" ? "Get ready..." : `Beat ${Math.min(this.beatIndex + 1, BEATS)}/${BEATS}`;
    ctx.fillText(beatLabel, width / 2, 92);

    // Streak (consecutive non-miss beats)
    let streak = 0;
    for (let i = this.results.length - 1; i >= 0; i--) {
      if (this.results[i] === "miss") break;
      streak++;
    }
    if (streak > 0) {
      ctx.font = "14px sans-serif";
      ctx.fillStyle = "rgba(255,210,63,0.8)";
      ctx.fillText(`Streak: ${streak}`, width / 2, 118);
    }

    // Bouncing marker — peaks (ground contact) exactly on each beat
    const swingPhase = this.elapsed / BEAT_INTERVAL;
    const bounce = Math.cos(swingPhase * Math.PI * 2); // 1 at each beat, -1 at the midpoint between beats
    const centerY = height * 0.5;
    const amplitude = height * 0.16;
    const markerY = centerY - bounce * amplitude;

    let color = "rgba(255,255,255,0.7)";
    if (this.flash) color = flashColor(this.flash.result);

    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2, centerY - amplitude - 20);
    ctx.lineTo(width / 2, centerY + amplitude + 20);
    ctx.stroke();

    // Ground line = the hit target
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(width / 2 - 60, centerY + amplitude);
    ctx.lineTo(width / 2 + 60, centerY + amplitude);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(width / 2, markerY, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = "14px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("Tap when it hits the line", width / 2, centerY + amplitude + 56);

    ctx.restore();
  }

  private renderSummary(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const counts = { perfect: 0, good: 0, miss: 0 };
    for (const r of this.results) counts[r]++;

    ctx.font = "18px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("Session complete", width / 2, height * 0.32);

    const lines = [
      { label: "Perfect", value: counts.perfect, color: flashColor("perfect") },
      { label: "Good", value: counts.good, color: flashColor("good") },
      { label: "Miss", value: counts.miss, color: flashColor("miss") },
    ];
    lines.forEach((l, i) => {
      ctx.font = "bold 22px sans-serif";
      ctx.fillStyle = l.color;
      ctx.fillText(`${l.label}: ${l.value}`, width / 2, height * 0.44 + i * 38);
    });

    ctx.font = "13px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(
      "(Endurance gain / Energy Star cost land here once camp state is wired up)",
      width / 2,
      height * 0.44 + lines.length * 38 + 30,
    );
  }
}

function flashColor(r: JumpRopeResult): string {
  if (r === "perfect") return "#3fbf6b";
  if (r === "good") return "#ffd23f";
  return "#ff5a5a";
}
