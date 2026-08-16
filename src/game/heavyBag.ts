// Heavy Bag training minigame (Section 4, Power stat): hold to charge a
// meter, release inside the sweet-spot zone. 5 reps. Too early = weak hit,
// too late = overswing. Intensity/Energy Star/stat persistence aren't
// wired up yet — this piece just proves the core mechanic feels right.

export type HeavyBagResult = "weak" | "perfect" | "overswing";

const REPS = 5;
const FILL_DURATION = 1.1; // seconds for the meter to go 0 -> 1
const SWEET_START = 0.62;
const SWEET_END = 0.78;
const RESULT_PAUSE = 0.9; // seconds to show the per-rep result before continuing

type Phase = "ready" | "charging" | "result" | "summary";

export class HeavyBagScene {
  private phase: Phase = "ready";
  private meter = 0;
  private rep = 0;
  private results: HeavyBagResult[] = [];
  private resultTimer = 0;
  private lastHeld = false;

  update(dt: number, held: boolean) {
    if (this.phase === "ready") {
      if (held && !this.lastHeld) {
        this.phase = "charging";
        this.meter = 0;
      }
    } else if (this.phase === "charging") {
      this.meter += dt / FILL_DURATION;
      if (!held) {
        this.finishRep(this.grade(this.meter));
      } else if (this.meter >= 1) {
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
    this.lastHeld = held;
  }

  private grade(m: number): HeavyBagResult {
    if (m < SWEET_START) return "weak";
    if (m <= SWEET_END) return "perfect";
    return "overswing";
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
    ctx.fillText("Heavy Bag", width / 2, 70);

    if (this.phase === "summary") {
      this.renderSummary(ctx, width, height);
      ctx.restore();
      return;
    }

    ctx.font = "16px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(`Rep ${Math.min(this.rep + 1, REPS)}/${REPS}`, width / 2, 104);

    // Placeholder bag, swaying gently
    const bagX = width / 2;
    const bagY = height * 0.32;
    const sway = Math.sin(performance.now() / 500) * 6;
    ctx.save();
    ctx.translate(bagX + sway, bagY);
    ctx.fillStyle = "#5a4a3a";
    ctx.beginPath();
    ctx.ellipse(0, 0, 46, 70, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Power meter
    const meterW = 60;
    const meterH = height * 0.32;
    const meterX = width / 2 - meterW / 2;
    const meterY = height * 0.56;

    ctx.fillStyle = "#2a2f3a";
    ctx.fillRect(meterX, meterY, meterW, meterH);

    // Sweet-spot band
    const sweetTop = meterY + meterH * (1 - SWEET_END);
    const sweetH = meterH * (SWEET_END - SWEET_START);
    ctx.fillStyle = "rgba(63, 191, 107, 0.35)";
    ctx.fillRect(meterX, sweetTop, meterW, sweetH);

    // Fill
    const fillH = meterH * Math.min(1, this.meter);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(meterX, meterY + meterH - fillH, meterW, fillH);

    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(meterX, meterY, meterW, meterH);

    if (this.phase === "ready") {
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("Hold to charge", width / 2, meterY + meterH + 40);
    } else if (this.phase === "result") {
      const last = this.results[this.results.length - 1];
      ctx.font = "bold 24px sans-serif";
      ctx.fillStyle = resultColor(last);
      ctx.fillText(resultLabel(last), width / 2, meterY + meterH + 44);
    }

    ctx.restore();
  }

  private renderSummary(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const counts = { perfect: 0, weak: 0, overswing: 0 };
    for (const r of this.results) counts[r]++;

    ctx.font = "18px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("Session complete", width / 2, height * 0.32);

    const lines = [
      { label: "Perfect", value: counts.perfect, color: resultColor("perfect") },
      { label: "Weak hit", value: counts.weak, color: resultColor("weak") },
      { label: "Overswing", value: counts.overswing, color: resultColor("overswing") },
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
  if (r === "weak") return "WEAK HIT";
  return "OVERSWING";
}

function resultColor(r: HeavyBagResult): string {
  if (r === "perfect") return "#3fbf6b";
  if (r === "weak") return "#ffd23f";
  return "#ff5a5a";
}
