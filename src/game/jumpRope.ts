// Jump Rope training minigame (Section 4, Endurance stat): 16 beats at a
// fixed rhythm, tap in sync without breaking stride. Graded per beat
// (Perfect/Good/Miss) — purely by the ball's position at the moment of
// tap, no clock and no decay over time. The grade is read directly off
// what's on screen: the ball's center Y vs. the dashed line's Y, measured
// in ball radii.
//   Perfect: the ball is fully clear of the line (center >= 1 radius
//     past it). This holds for as long as the ball stays fully clear —
//     tapping early or late within that whole window is equally Perfect.
//   Good: the ball is touching/overlapping the line — center has passed
//     it, but by less than 1 radius.
//   Miss: center hasn't reached the line at all (more than half the
//     circle still above it), or no tap before the beat's window closes.

export type JumpRopeResult = "perfect" | "good" | "miss";
export type JumpRopePhase = "countdown" | "active" | "summary";

const BEATS = 16;
const BEAT_INTERVAL = 0.62; // seconds per bounce cycle — the fixed rhythm
const COUNTDOWN_DURATION = 1.2; // seconds the ball sits still at the top before the first drop
const FLASH_DURATION = 0.25; // seconds the marker holds its result color
const BALL_RADIUS = 22;

export class JumpRopeScene {
  private phase: JumpRopePhase = "countdown";
  private countdownElapsed = 0;
  private activeElapsed = 0; // resets to 0 when "active" begins — the ball starts at the top here
  private beatIndex = 0;
  private results: JumpRopeResult[] = [];
  private scoredThisBeat = false;
  private flash: { result: JumpRopeResult; timer: number } | null = null;

  update(dt: number) {
    if (this.phase === "summary") return;

    if (this.flash) {
      this.flash.timer -= dt;
      if (this.flash.timer <= 0) this.flash = null;
    }

    if (this.phase === "countdown") {
      this.countdownElapsed += dt;
      if (this.countdownElapsed >= COUNTDOWN_DURATION) {
        this.phase = "active";
        this.activeElapsed = 0;
      }
      return;
    }

    this.activeElapsed += dt;

    // A beat's opportunity closes once the ball has swung all the way
    // back to the top (half a cycle after its peak) — if it wasn't
    // tapped by then, that's a Miss by timeout.
    const closeTime = (this.beatIndex + 1) * BEAT_INTERVAL;
    if (!this.scoredThisBeat && this.activeElapsed >= closeTime) {
      this.recordBeat("miss");
    }
  }

  /**
   * Grades instantly against the ball's current position vs. the line —
   * tapping before the ball has reached the line is a Miss, same as not
   * tapping at all. No time-based decay: Perfect holds for the ball's
   * entire fully-clear window, not just the instant it crosses.
   */
  handleTap(height: number) {
    if (this.phase !== "active" || this.scoredThisBeat) return;
    const { diff } = this.geometry(height);
    const result: JumpRopeResult = diff >= BALL_RADIUS ? "perfect" : diff > 0 ? "good" : "miss";
    this.recordBeat(result);
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

  // Single source of truth for the ball/line positions, shared by
  // handleTap() and render() so grading always matches what's drawn.
  private geometry(height: number) {
    const centerY = height * 0.42;
    const amplitude = height * 0.16;
    const lineY = centerY + amplitude * 0.5;

    // swingPhase = 0.5 is the top of the swing. During "countdown" the
    // ball sits still there; once "active", it starts at the top
    // (activeElapsed = 0) and falls toward its first peak (bottom) at
    // swingPhase = 1, i.e. half a beat interval later.
    const swingPhase = this.phase === "countdown" ? 0.5 : 0.5 + this.activeElapsed / BEAT_INTERVAL;
    const ballY = centerY + amplitude * Math.cos(swingPhase * Math.PI * 2);
    const diff = ballY - lineY; // positive = ball's center has passed the line
    return { centerY, amplitude, lineY, ballY, diff };
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

    const { centerY, amplitude, lineY, ballY } = this.geometry(height);

    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width / 2, centerY - amplitude - BALL_RADIUS - 10);
    ctx.lineTo(width / 2, centerY + amplitude + BALL_RADIUS + 10);
    ctx.stroke();

    // The line grading is measured against
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(width / 2 - 70, lineY);
    ctx.lineTo(width / 2 + 70, lineY);
    ctx.stroke();
    ctx.setLineDash([]);

    let color = "rgba(255,255,255,0.7)";
    if (this.flash) color = flashColor(this.flash.result);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(width / 2, ballY, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = "14px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("Tap as it crosses the line", width / 2, centerY + amplitude + BALL_RADIUS + 40);

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
