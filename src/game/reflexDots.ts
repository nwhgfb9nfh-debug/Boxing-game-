// Reflex Dots training minigame (Section 4, Speed stat): 5 dots flash
// briefly at random positions; tap before they vanish. Graded by
// reaction speed — faster taps grade better, same 4-tier language as
// Heavy Bag (Perfect/Good/Weak) plus Miss for not tapping in time at all.

export type ReflexResult = "perfect" | "good" | "weak" | "miss";
export type ReflexPhase = "waiting" | "active" | "result" | "summary";

const ROUNDS = 5;
const DOT_LIFETIME = 0.85; // seconds a dot stays tappable
const HIT_RADIUS = 44;
const RESULT_PAUSE = 0.7;
const MIN_WAIT = 0.4; // pause before a dot appears, randomized so it can't be anticipated
const MAX_WAIT = 1.0;

// Speed thresholds, as a fraction of DOT_LIFETIME elapsed at tap time.
const PERFECT_BY = 0.35;
const GOOD_BY = 0.65;

// Keep dots clear of the HUD pill and the bottom UI band.
const MARGIN_TOP = 110;
const MARGIN_BOTTOM = 140;
const MARGIN_SIDE = 50;

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class ReflexDotsScene {
  private phase: ReflexPhase = "waiting";
  private round = 0;
  private results: ReflexResult[] = [];
  private timer: number;
  private dotX = 0;
  private dotY = 0;
  private activeElapsed = 0;

  constructor() {
    this.timer = randRange(MIN_WAIT, MAX_WAIT);
  }

  update(dt: number, width: number, height: number) {
    if (this.phase === "waiting") {
      this.timer -= dt;
      if (this.timer <= 0) this.spawnDot(width, height);
    } else if (this.phase === "active") {
      this.activeElapsed += dt;
      if (this.activeElapsed >= DOT_LIFETIME) {
        this.finishRound("miss");
      }
    } else if (this.phase === "result") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.round++;
        if (this.round >= ROUNDS) {
          this.phase = "summary";
        } else {
          this.phase = "waiting";
          this.timer = randRange(MIN_WAIT, MAX_WAIT);
        }
      }
    }
  }

  private spawnDot(width: number, height: number) {
    this.dotX = MARGIN_SIDE + Math.random() * Math.max(1, width - MARGIN_SIDE * 2);
    this.dotY = MARGIN_TOP + Math.random() * Math.max(1, height - MARGIN_TOP - MARGIN_BOTTOM);
    this.activeElapsed = 0;
    this.phase = "active";
  }

  /** Call with the raw tap position (screen coords) — ignored unless it lands on the active dot. */
  handleTap(x: number, y: number) {
    if (this.phase !== "active") return;
    if (Math.hypot(x - this.dotX, y - this.dotY) > HIT_RADIUS) return;

    const frac = this.activeElapsed / DOT_LIFETIME;
    const result: ReflexResult = frac < PERFECT_BY ? "perfect" : frac < GOOD_BY ? "good" : "weak";
    this.finishRound(result);
  }

  private finishRound(result: ReflexResult) {
    this.results.push(result);
    this.phase = "result";
    this.timer = RESULT_PAUSE;
  }

  isDone(): boolean {
    return this.phase === "summary";
  }

  getResults(): ReflexResult[] {
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
    ctx.fillText("Reflex Dots", width / 2, 60);

    if (this.phase === "summary") {
      this.renderSummary(ctx, width, height);
      ctx.restore();
      return;
    }

    ctx.font = "16px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(`Dot ${Math.min(this.round + 1, ROUNDS)}/${ROUNDS}`, width / 2, 92);

    if (this.phase === "active") {
      const frac = this.activeElapsed / DOT_LIFETIME;
      const color = frac < PERFECT_BY ? "#3fbf6b" : frac < GOOD_BY ? "#ffd23f" : "#ff8c42";

      // Shrinking ring shows the vanish countdown
      const ringR = 30 * (1 - frac) + 6;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.dotX, this.dotY, ringR + 20, 0, Math.PI * 2 * (1 - frac));
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(this.dotX, this.dotY, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (this.phase === "result") {
      const last = this.results[this.results.length - 1];
      ctx.font = "bold 28px sans-serif";
      ctx.fillStyle = resultColor(last);
      ctx.fillText(resultLabel(last), width / 2, height / 2);
    } else {
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillText("Get ready...", width / 2, height / 2);
    }

    ctx.restore();
  }

  private renderSummary(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const counts = { perfect: 0, good: 0, weak: 0, miss: 0 };
    for (const r of this.results) counts[r]++;

    ctx.font = "18px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("Session complete", width / 2, height * 0.32);

    const lines = [
      { label: "Perfect", value: counts.perfect, color: resultColor("perfect") },
      { label: "Good", value: counts.good, color: resultColor("good") },
      { label: "Weak", value: counts.weak, color: resultColor("weak") },
      { label: "Miss", value: counts.miss, color: resultColor("miss") },
    ];
    lines.forEach((l, i) => {
      ctx.font = "bold 22px sans-serif";
      ctx.fillStyle = l.color;
      ctx.fillText(`${l.label}: ${l.value}`, width / 2, height * 0.44 + i * 38);
    });

    ctx.font = "13px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(
      "(Speed gain / Energy Star cost land here once camp state is wired up)",
      width / 2,
      height * 0.44 + lines.length * 38 + 30,
    );
  }
}

function resultLabel(r: ReflexResult): string {
  if (r === "perfect") return "PERFECT!";
  if (r === "good") return "GOOD";
  if (r === "weak") return "WEAK";
  return "MISS";
}

function resultColor(r: ReflexResult): string {
  if (r === "perfect") return "#3fbf6b";
  if (r === "good") return "#ffd23f";
  if (r === "weak") return "#ff8c42";
  return "#ff5a5a";
}
