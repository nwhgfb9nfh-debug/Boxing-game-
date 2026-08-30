// Sparring training minigame (Section 4, Chin stat): the Fight System's
// memory-combo mechanic (game/fight.ts) reused directly — a combo is
// revealed once at a fixed rhythm, then re-input from memory, the first
// swipe untimed and every one after it timed, one wrong direction
// grading just that step a Miss without ending the combo. Per the spec,
// Sparring is swiping only — neither of the Fight's bonus minigames
// (Power Punch's charge meter, Danger Reflex's dot session) are part of
// it. No opponent HP/player HP/purse either — it's training, not a
// scored bout — just REPS combo exchanges against a sparring partner's
// combo pool, each graded down to a single perfect/good/miss result and
// fed into applyTraining("chin", ...) exactly like Heavy Bag/Reflex
// Dots/Jump Rope.

import type { Direction } from "./opponents";

export type SparringResult = "perfect" | "good" | "miss";
export type SparringPhase = "telegraph" | "input" | "resolve" | "summary";
type StepGrade = "perfect" | "good" | "miss";

const REPS = 12;
const RESOLVE_PAUSE_MS = 700;

// Same base timer/telegraph pacing as a real fight's exchanges — no camp
// variable scaling here (Speed/Endurance haven't necessarily been
// trained yet this same camp, and it'd be circular for Chin's own
// session to scale off Chin).
const TIMER_BASE_MS = 1300;
const TIMER_JITTER_MS = 400;
const TIMER_MIN_MS = 500;
const TIMER_MAX_MS = 1700;
const TELEGRAPH_STEP_MS = 550;
const PERFECT_WINDOW_FRACTION = 0.45;

// A small fixed pool standing in for "the sparring partner's combos" —
// same idea as an opponent's signatureCombos, just not tied to any one
// roster fighter since this is a practice session, not a real bout.
const PARTNER_COMBOS: Direction[][] = [
  ["left", "right"],
  ["up", "down", "left"],
  ["right", "right", "up"],
  ["down", "left", "right"],
  ["up", "left", "down", "right"],
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export class SparringScene {
  private phase: SparringPhase = "telegraph";
  private rep = 0;
  private results: SparringResult[] = [];

  private combo: Direction[] = [];
  private revealIndex = 0;
  private revealStepTimer = TELEGRAPH_STEP_MS;
  private inputIndex = 0;
  private stepTimerMs = 0;
  private swipeDeadline = 0;
  private stepGrades: StepGrade[] = [];

  private resolveTimer = 0;

  constructor() {
    this.combo = this.pickPartnerCombo();
  }

  update(dt: number) {
    const dtMs = dt * 1000;
    if (this.phase === "telegraph") {
      this.revealStepTimer -= dtMs;
      if (this.revealStepTimer <= 0) {
        this.revealIndex++;
        if (this.revealIndex >= this.combo.length) {
          this.phase = "input";
          this.inputIndex = 0;
          this.stepGrades = [];
          this.startInputStep();
        } else {
          this.revealStepTimer = TELEGRAPH_STEP_MS;
        }
      }
    } else if (this.phase === "input") {
      if (this.inputIndex > 0 && Number.isFinite(this.swipeDeadline)) {
        this.swipeDeadline -= dtMs;
        if (this.swipeDeadline <= 0) this.gradeStep("miss");
      }
    } else if (this.phase === "resolve") {
      this.resolveTimer -= dtMs;
      if (this.resolveTimer <= 0) {
        this.rep++;
        if (this.rep >= REPS) {
          this.phase = "summary";
        } else {
          this.combo = this.pickPartnerCombo();
          this.revealIndex = 0;
          this.revealStepTimer = TELEGRAPH_STEP_MS;
          this.phase = "telegraph";
        }
      }
    }
  }

  handleSwipe(direction: Direction) {
    if (this.phase !== "input") return;
    const expected = this.combo[this.inputIndex];
    if (direction !== expected) {
      this.gradeStep("miss");
      return;
    }
    this.gradeStep(this.inputIndex === 0 ? "perfect" : this.gradeTiming());
  }

  private gradeStep(grade: StepGrade) {
    this.stepGrades.push(grade);
    this.inputIndex++;
    if (this.inputIndex >= this.combo.length) this.finishRep();
    else this.startInputStep();
  }

  private gradeTiming(): StepGrade {
    if (!Number.isFinite(this.stepTimerMs) || this.stepTimerMs <= 0) return "perfect";
    const elapsed = this.stepTimerMs - this.swipeDeadline;
    return elapsed / this.stepTimerMs <= PERFECT_WINDOW_FRACTION ? "perfect" : "good";
  }

  private startInputStep() {
    if (this.inputIndex === 0) {
      this.stepTimerMs = Infinity;
      this.swipeDeadline = Infinity;
      return;
    }
    const jitter = (Math.random() * 2 - 1) * TIMER_JITTER_MS;
    const timer = clamp(TIMER_BASE_MS + jitter, TIMER_MIN_MS, TIMER_MAX_MS);
    this.stepTimerMs = timer;
    this.swipeDeadline = timer;
  }

  // Reduces the combo's per-step grades to one overall rep result: every
  // step landing Perfect grades the rep Perfect; any miss grades it Miss
  // (Chin is about taking a real hit, so a broken block doesn't get to
  // read as "mostly fine"); anything else (all landed, some just Good)
  // grades Good.
  private finishRep() {
    const result: SparringResult = this.stepGrades.every((g) => g === "perfect")
      ? "perfect"
      : this.stepGrades.some((g) => g === "miss")
        ? "miss"
        : "good";
    this.results.push(result);
    this.phase = "resolve";
    this.resolveTimer = RESOLVE_PAUSE_MS;
  }

  private pickPartnerCombo(): Direction[] {
    return PARTNER_COMBOS[Math.floor(Math.random() * PARTNER_COMBOS.length)];
  }

  isDone(): boolean {
    return this.phase === "summary";
  }

  getResults(): SparringResult[] {
    return this.results;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.save();
    ctx.fillStyle = "#171a21";
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "bold 26px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText("Sparring", width / 2, 60);

    if (this.phase === "summary") {
      this.renderSummary(ctx, width, height);
      ctx.restore();
      return;
    }

    ctx.font = "16px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(`Rep ${Math.min(this.rep + 1, REPS)}/${REPS}`, width / 2, 92);

    ctx.font = "bold 16px sans-serif";
    ctx.fillStyle = this.phase === "telegraph" ? "#ffd23f" : "#3fbf6b";
    ctx.fillText(this.phase === "telegraph" ? "MEMORIZE" : this.phase === "input" ? "SWIPE IT BACK" : "", width / 2, height * 0.3);

    if (this.phase === "telegraph" || this.phase === "input") {
      this.renderCombo(ctx, width, height * 0.44);
    }
    if (this.phase === "resolve") {
      const last = this.results[this.results.length - 1];
      ctx.font = "bold 24px sans-serif";
      ctx.fillStyle = resultColor(last);
      ctx.fillText(resultLabel(last), width / 2, height * 0.44);
    }

    ctx.restore();
  }

  private renderCombo(ctx: CanvasRenderingContext2D, width: number, y: number) {
    const arrow: Record<Direction, string> = { up: "↑", down: "↓", left: "←", right: "→" };
    const n = this.combo.length;
    const slotW = 46;
    const startX = width / 2 - (slotW * (n - 1)) / 2;

    for (let i = 0; i < n; i++) {
      const x = startX + i * slotW;
      let label = "•";
      let color = "rgba(255,255,255,0.25)";
      let scale = 1;
      if (this.phase === "telegraph") {
        if (i === this.revealIndex) {
          label = arrow[this.combo[i]];
          color = "#fff";
          scale = 1.3;
        } else if (i < this.revealIndex) {
          label = arrow[this.combo[i]];
          color = "rgba(255,255,255,0.4)";
        }
      } else if (this.phase === "input") {
        if (i < this.inputIndex) {
          const grade = this.stepGrades[i];
          label = arrow[this.combo[i]];
          color = grade === "perfect" ? "#3fbf6b" : grade === "good" ? "#ffd23f" : "#ff5a5a";
        } else if (i === this.inputIndex) {
          label = "?";
          color = "#fff";
          scale = 1.3;
        }
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.font = "bold 30px sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    if (this.phase === "input" && this.inputIndex > 0 && Number.isFinite(this.stepTimerMs) && this.stepTimerMs > 0) {
      const barW = 140;
      const barX = width / 2 - barW / 2;
      const barY = y + 40;
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(barX, barY, barW, 8);
      ctx.fillStyle = "#fff";
      ctx.fillRect(barX, barY, barW * clamp(this.swipeDeadline / this.stepTimerMs, 0, 1), 8);
    } else if (this.phase === "input" && this.inputIndex === 0) {
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText("(no timer on the first swipe)", width / 2, y + 44);
    }
  }

  private renderSummary(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const counts = { perfect: 0, good: 0, miss: 0 };
    for (const r of this.results) counts[r]++;

    ctx.font = "18px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("Session complete", width / 2, height * 0.32);

    const lines = [
      { label: "Perfect", value: counts.perfect, color: resultColor("perfect") },
      { label: "Good", value: counts.good, color: resultColor("good") },
      { label: "Miss", value: counts.miss, color: resultColor("miss") },
    ];
    lines.forEach((l, i) => {
      ctx.font = "bold 22px sans-serif";
      ctx.fillStyle = l.color;
      ctx.fillText(`${l.label}: ${l.value}`, width / 2, height * 0.44 + i * 38);
    });
  }
}

function resultLabel(r: SparringResult): string {
  if (r === "perfect") return "PERFECT BLOCK!";
  if (r === "good") return "BLOCKED";
  return "TAGGED!";
}

function resultColor(r: SparringResult): string {
  if (r === "perfect") return "#3fbf6b";
  if (r === "good") return "#ffd23f";
  return "#ff5a5a";
}
