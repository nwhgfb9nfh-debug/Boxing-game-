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
const BEAT_INTERVAL = 0.75; // seconds per bounce cycle — the fixed rhythm (a longer drop, slower rhythm)
const COUNTDOWN_DURATION = 1.2; // seconds the ball sits still at the top before the first drop
const FLASH_DURATION = 0.2; // seconds the marker holds its result color
const FREEZE_DURATION = 0.2; // seconds the ball holds motionless at its tapped position, so what graded it is what you see
const BALL_RADIUS = 22;
// Extra room, past the "fully clear" threshold, the ball has before it
// hits the bottom of its swing — kept tiny so Perfect has almost no
// spare room, without adding any time-based decay to the grading itself.
const LINE_CLEARANCE = 4;

export class JumpRopeScene {
  private phase: JumpRopePhase = "countdown";
  private countdownElapsed = 0;
  private activeElapsed = 0; // resets to 0 when "active" begins — the ball starts at the top here
  private beatIndex = 0;
  private results: JumpRopeResult[] = [];
  // True once the current drop has been resolved (tapped or timed out) —
  // stays locked until the ball swings all the way back to the top and a
  // new drop begins, even though the ball itself keeps moving the whole time.
  private scoredThisBeat = false;
  private flash: { result: JumpRopeResult; timer: number } | null = null;
  // Set only on a tap (not a timeout) — while active, activeElapsed
  // doesn't advance, so geometry() keeps returning the exact position the
  // ball was at when it was graded. That's the whole point: no ambiguity
  // between what you saw, what got graded, and what a lagging tap might
  // have caught the ball doing next.
  private freeze: { timer: number } | null = null;

  update(dt: number) {
    if (this.phase === "summary") return;

    if (this.flash) {
      this.flash.timer -= dt;
      if (this.flash.timer <= 0) this.flash = null;
    }

    if (this.freeze) {
      this.freeze.timer -= dt;
      if (this.freeze.timer <= 0) this.freeze = null; // unpauses — the ball just continues from here, no reset
      return;
    }

    if (this.phase === "countdown") {
      this.countdownElapsed += dt;
      if (this.countdownElapsed >= COUNTDOWN_DURATION) {
        this.phase = "active";
        this.activeElapsed = 0;
      }
      return;
    }

    // The ball's motion is one continuous, uninterrupted bounce (aside
    // from freeze pauses) — it's never reset mid-game. Once tapped (or
    // missed by timeout), it stays locked out until it swings all the
    // way back to the top and starts a fresh drop; only then can the
    // next beat be tapped. "Top" = every whole-BEAT_INTERVAL crossing.
    const prevElapsed = this.activeElapsed;
    this.activeElapsed += dt;
    const crossedTop = Math.floor(this.activeElapsed / BEAT_INTERVAL) > Math.floor(prevElapsed / BEAT_INTERVAL);
    if (crossedTop) {
      if (!this.scoredThisBeat) this.recordBeat("miss"); // this beat's whole drop went by untapped
      this.scoredThisBeat = false; // unlocked — the new drop that just started is tappable
    }
  }

  /**
   * Grades instantly against the ball's current position vs. the line —
   * tapping before the ball has reached the line is a Miss, same as not
   * tapping at all. No time-based decay: Perfect holds for the ball's
   * entire fully-clear window, not just the instant it crosses. Freezes
   * the ball in place for FREEZE_DURATION so the feedback shown always
   * matches exactly what got graded, then locks out further taps until
   * the ball has gone all the way back to the top and is falling again.
   */
  handleTap(height: number) {
    if (this.phase !== "active" || this.scoredThisBeat || this.freeze) return;
    const { diff } = this.geometry(height);
    const result: JumpRopeResult = diff >= BALL_RADIUS ? "perfect" : diff > 0 ? "good" : "miss";
    this.scoredThisBeat = true;
    this.recordBeat(result);
    this.freeze = { timer: FREEZE_DURATION };
  }

  private recordBeat(result: JumpRopeResult) {
    this.results.push(result);
    this.flash = { result, timer: FLASH_DURATION };
    this.beatIndex++;
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
    const centerY = height * 0.46;
    const amplitude = height * 0.2; // taller drop from the top down to the line
    // The line sits just past the ball's lowest point (by radius + a tiny
    // clearance) — the ball barely fits fully below it at the very bottom
    // of the swing, leaving almost no room to spare once it's underneath.
    const lineY = centerY + amplitude - BALL_RADIUS - LINE_CLEARANCE;

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
    ctx.fillText("Tap when the ball is below the line", width / 2, centerY + amplitude + BALL_RADIUS + 40);

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
