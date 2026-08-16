// Heavy Bag training minigame (Section 4, Power stat): the meter charges
// on its own once started, release inside the sweet-spot zone. 5 reps.
// Driven by two discrete taps (start / release) rather than a
// press-and-hold — see ui/actionButtons.ts. Intensity/Energy Star/stat
// persistence aren't wired up yet — this piece just proves the core
// mechanic feels right.
//
// The meter is graded in 5 zones, bottom (early) to top (late):
//   Red (too early, Weak) -> Yellow (slightly early, Good) -> Green
//   (Perfect) -> Yellow (slightly late, Good) -> Red (too late,
//   Overswing). Yellow/Green/Yellow are all the same width (4% each);
//   the two reds — the real "miss" zones — take up the rest of the track.
// Weak and Overswing are graded separately (early miss vs late miss) but
// the session summary piles them into one combined "Weak/Overswing" stat.

export type HeavyBagResult = "weak" | "good" | "perfect" | "overswing";
export type HeavyBagPhase = "ready" | "charging" | "result" | "summary";

const REPS = 5;
const FILL_DURATION = 1.1; // seconds for the meter to go 0 -> 1
const RESULT_PAUSE = 0.9; // seconds to show the per-rep result before continuing

// Zone boundaries, as fractions of the meter (0 = start, 1 = fully charged).
const YELLOW_EARLY_START = 0.46;
const SWEET_START = 0.5;
const SWEET_END = 0.54; // green: same 4% width as each yellow band
const YELLOW_LATE_END = 0.58;

export class HeavyBagScene {
  private phase: HeavyBagPhase = "ready";
  private meter = 0;
  private rep = 0;
  private results: HeavyBagResult[] = [];
  private resultTimer = 0;

  /** Advances timers/animation only — input is event-driven via startCharge()/release(). */
  update(dt: number) {
    if (this.phase === "charging") {
      this.meter += dt / FILL_DURATION;
      if (this.meter >= 1) {
        this.meter = 1;
        this.finishRep("overswing");
      }
    } else if (this.phase === "result") {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        this.rep++;
        this.meter = 0;
        this.phase = this.rep >= REPS ? "summary" : "ready";
      }
    }
  }

  startCharge() {
    if (this.phase !== "ready") return;
    this.phase = "charging";
    this.meter = 0;
  }

  release() {
    if (this.phase !== "charging") return;
    this.finishRep(this.grade(this.meter));
  }

  getPhase(): HeavyBagPhase {
    return this.phase;
  }

  private grade(m: number): HeavyBagResult {
    if (m < YELLOW_EARLY_START) return "weak"; // red, too early
    if (m < SWEET_START) return "good"; // yellow, slightly early
    if (m <= SWEET_END) return "perfect"; // green
    if (m <= YELLOW_LATE_END) return "good"; // yellow, slightly late
    return "overswing"; // red, too late
  }

  private finishRep(result: HeavyBagResult) {
    this.results.push(result);
    this.phase = "result";
    this.resultTimer = RESULT_PAUSE;
  }

  isDone(): boolean {
    return this.phase === "summary";
  }

  getResults(): HeavyBagResult[] {
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
    ctx.fillText("Heavy Bag", width / 2, 60);

    if (this.phase === "summary") {
      this.renderSummary(ctx, width, height);
      ctx.restore();
      return;
    }

    ctx.font = "16px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(`Rep ${Math.min(this.rep + 1, REPS)}/${REPS}`, width / 2, 92);

    // Placeholder bag, swaying gently
    const bagX = width / 2;
    const bagY = height * 0.28;
    const sway = Math.sin(performance.now() / 500) * 6;
    ctx.save();
    ctx.translate(bagX + sway, bagY);
    ctx.fillStyle = "#5a4a3a";
    ctx.beginPath();
    ctx.ellipse(0, 0, 42, 62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Power meter — a static 5-zone gradient track with a moving marker,
    // centered and well clear of the left/right action buttons.
    const meterW = 64;
    const meterH = height * 0.4;
    const meterX = width / 2 - meterW / 2;
    const meterY = height * 0.46;

    const zones: Array<[number, number, string]> = [
      [0, YELLOW_EARLY_START, "#8a3030"], // red, too early
      [YELLOW_EARLY_START, SWEET_START, "#8a7a30"], // yellow, slightly early
      [SWEET_START, SWEET_END, "#3fbf6b"], // green, perfect
      [SWEET_END, YELLOW_LATE_END, "#8a7a30"], // yellow, slightly late
      [YELLOW_LATE_END, 1, "#8a3030"], // red, too late
    ];
    for (const [from, to, color] of zones) {
      const zTop = meterY + meterH * (1 - to);
      const zH = meterH * (to - from);
      ctx.fillStyle = color;
      ctx.fillRect(meterX, zTop, meterW, zH);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(meterX, meterY, meterW, meterH);

    // Moving marker showing the current charge level
    if (this.phase === "charging" || this.phase === "result") {
      const markerY = meterY + meterH * (1 - Math.min(1, this.meter));
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(meterX - 12, markerY);
      ctx.lineTo(meterX - 2, markerY - 8);
      ctx.lineTo(meterX - 2, markerY + 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(meterX - 2, markerY - 2, meterW + 4, 4);
    }

    if (this.phase === "ready") {
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("Tap PUNCH to start", width / 2, meterY + meterH + 36);
    } else if (this.phase === "charging") {
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("Tap RELEASE in the green zone", width / 2, meterY + meterH + 36);
    } else if (this.phase === "result") {
      const last = this.results[this.results.length - 1];
      ctx.font = "bold 24px sans-serif";
      ctx.fillStyle = resultColor(last);
      ctx.fillText(resultLabel(last), width / 2, meterY + meterH + 40);
    }

    ctx.restore();
  }

  private renderSummary(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const counts = { perfect: 0, good: 0, weak: 0, overswing: 0 };
    for (const r of this.results) counts[r]++;

    ctx.font = "18px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("Session complete", width / 2, height * 0.32);

    const lines = [
      { label: "Perfect", value: counts.perfect, color: resultColor("perfect") },
      { label: "Good", value: counts.good, color: resultColor("good") },
      { label: "Weak/Overswing", value: counts.weak + counts.overswing, color: resultColor("overswing") },
    ];
    lines.forEach((l, i) => {
      ctx.font = "bold 22px sans-serif";
      ctx.fillStyle = l.color;
      ctx.fillText(`${l.label}: ${l.value}`, width / 2, height * 0.44 + i * 38);
    });

    ctx.font = "13px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(
      "(Power gain / Energy Star cost land here once camp state is wired up)",
      width / 2,
      height * 0.44 + lines.length * 38 + 30,
    );
  }
}

function resultLabel(r: HeavyBagResult): string {
  if (r === "perfect") return "PERFECT!";
  if (r === "good") return "GOOD";
  if (r === "weak") return "WEAK";
  return "OVERSWING";
}

function resultColor(r: HeavyBagResult): string {
  if (r === "perfect") return "#3fbf6b";
  if (r === "good") return "#ffd23f";
  if (r === "weak") return "#ff8c42";
  return "#ff5a5a";
}
