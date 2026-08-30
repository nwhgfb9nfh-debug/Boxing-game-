// Fight System (Stage 1) — the real interactive memory-combo fight,
// replacing the old placeholder "Simulate Fight" button. Ego/first-person
// view of the opponent (Punch-Out!!-style), driven by the 5 camp
// variables fed in from the completed camp cycle (HP/Power/Speed/
// Endurance/Chin — see FightCampVariables). Same class shape as the
// training minigames (HeavyBagScene/ReflexDotsScene/JumpRopeScene):
// event-driven input (handleSwipe), update(dt)/render(ctx,w,h) each
// frame, isDone() gates the exit prompt.
//
// Per-exchange flow (spec): a combo is revealed once at a fixed rhythm,
// then re-input from memory. The first swipe is untimed; every swipe
// after that has a timer window. One wrong direction (or a timeout)
// counts everything from that point on as a Miss — no partial credit for
// an abandoned combo, so a miss immediately pads the rest and moves on
// rather than making the player sit through dead timers.
//
// Rounds are 2 Offense + 2 Defense turns, alternating. Offense turns use
// a procedurally generated combo (length scales with the round) — Power
// scales damage dealt. Defense turns use one of the opponent's own fixed
// signature combos (so each opponent is genuinely learnable) — blocking
// it well reduces incoming damage, Chin reduces it further. No KO by the
// last round goes to Decision, scored by net damage across the fight.

import type { Opponent, Direction } from "./opponents";

export type FightTurnType = "offense" | "defense";
export type FightPhase = "roundIntro" | "telegraph" | "input" | "resolve" | "roundEnd" | "over";
export type StepGrade = "perfect" | "good" | "miss";
export type FightOutcome = "ko-win" | "ko-loss" | "decision-win" | "decision-loss" | "draw";

export interface FightCampVariables {
  hp: number; // starting HP for this fight — caller clamps to <=100 (see main.ts's sleepAtBed)
  powerBonus: number;
  speedBonus: number;
  enduranceBonus: number;
  chinBonus: number;
  cutmanLevel: number; // between-round player recovery scales with this (everyone's at least Lvl 1)
}

const ROUND_INTRO_MS = 1200;
const RESOLVE_PAUSE_MS = 900;
const ROUND_END_MS = 1400;

// Base timer 1300ms +-400ms per swipe, more forgiving with Speed.
const TIMER_BASE_MS = 1300;
const TIMER_JITTER_MS = 400;
const TIMER_SPEED_SCALE_MS = 15; // extra ms of window per Speed training bonus point
const TIMER_MIN_MS = 500;
const TIMER_MAX_MS = 2600;

// Slower combo reveal pace (more time to memorize) with Endurance.
const TELEGRAPH_STEP_BASE_MS = 550;
const TELEGRAPH_ENDURANCE_SCALE_MS = 10;

// More damage dealt on successful hits, with Power.
const OFFENSE_DMG_PER_POINT_BASE = 2;
const OFFENSE_DMG_POWER_SCALE = 0.1;

// Less damage taken from opponent hits, with Chin.
const CHIN_REDUCTION_SCALE = 0.02;
const CHIN_REDUCTION_CAP = 0.5;

const CUTMAN_RECOVERY_PER_LEVEL = 3;

// A swipe landing in the first 45% of its timer window grades Perfect,
// anything later (but still in time) grades Good.
const PERFECT_WINDOW_FRACTION = 0.45;

const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export class FightScene {
  private opponent: Opponent;
  private vars: FightCampVariables;

  private phase: FightPhase = "roundIntro";
  private phaseTimer = ROUND_INTRO_MS;

  private round = 1;
  private turnIndex = 0; // 0-3 within the round; even = offense, odd = defense
  private playerHp: number;
  private opponentHp: number;
  private totalDamageDealt = 0;
  private totalDamageTaken = 0;

  private combo: Direction[] = [];
  private revealIndex = 0;
  private revealStepTimer = 0;
  private inputIndex = 0;
  private stepTimerMs = 0;
  private swipeDeadline = 0;
  private stepGrades: StepGrade[] = [];

  private lastExchangeDamage = 0;
  private lastExchangeType: FightTurnType = "offense";

  private outcome: FightOutcome | null = null;
  private purseAwarded = 0;

  constructor(opponent: Opponent, vars: FightCampVariables) {
    this.opponent = opponent;
    this.vars = vars;
    this.playerHp = clamp(vars.hp, 1, 100);
    this.opponentHp = opponent.hp;
  }

  update(dt: number) {
    const dtMs = dt * 1000;
    if (this.phase === "roundIntro" || this.phase === "resolve" || this.phase === "roundEnd") {
      this.phaseTimer -= dtMs;
      if (this.phaseTimer > 0) return;
      if (this.phase === "roundIntro") this.startTurn();
      else if (this.phase === "resolve") this.afterExchange();
      else this.startNextRoundOrDecision();
    } else if (this.phase === "telegraph") {
      this.revealStepTimer -= dtMs;
      if (this.revealStepTimer <= 0) {
        this.revealIndex++;
        if (this.revealIndex >= this.combo.length) {
          this.phase = "input";
          this.inputIndex = 0;
          this.stepGrades = [];
          this.startInputStep();
        } else {
          this.revealStepTimer = this.stepRevealMs();
        }
      }
    } else if (this.phase === "input") {
      if (this.inputIndex > 0 && Number.isFinite(this.swipeDeadline)) {
        this.swipeDeadline -= dtMs;
        if (this.swipeDeadline <= 0) this.padMissesAndFinish();
      }
    }
    // "over": nothing to tick — waiting on the caller's exit prompt.
  }

  handleSwipe(direction: Direction) {
    if (this.phase !== "input") return;
    const expected = this.combo[this.inputIndex];
    if (direction !== expected) {
      this.padMissesAndFinish();
      return;
    }
    const grade: StepGrade = this.inputIndex === 0 ? "perfect" : this.gradeTiming();
    this.stepGrades.push(grade);
    this.inputIndex++;
    if (this.inputIndex >= this.combo.length) this.finishExchange();
    else this.startInputStep();
  }

  private gradeTiming(): StepGrade {
    if (!Number.isFinite(this.stepTimerMs) || this.stepTimerMs <= 0) return "perfect";
    const elapsed = this.stepTimerMs - this.swipeDeadline;
    return elapsed / this.stepTimerMs <= PERFECT_WINDOW_FRACTION ? "perfect" : "good";
  }

  private padMissesAndFinish() {
    while (this.stepGrades.length < this.combo.length) this.stepGrades.push("miss");
    this.finishExchange();
  }

  private startInputStep() {
    if (this.inputIndex === 0) {
      this.stepTimerMs = Infinity;
      this.swipeDeadline = Infinity;
      return;
    }
    const jitter = (Math.random() * 2 - 1) * TIMER_JITTER_MS;
    const timer = clamp(TIMER_BASE_MS + jitter + this.vars.speedBonus * TIMER_SPEED_SCALE_MS, TIMER_MIN_MS, TIMER_MAX_MS);
    this.stepTimerMs = timer;
    this.swipeDeadline = timer;
  }

  private finishExchange() {
    const maxScore = this.combo.length * 2;
    const score = this.stepGrades.reduce((sum, g) => sum + (g === "perfect" ? 2 : g === "good" ? 1 : 0), 0);
    this.lastExchangeType = this.turnType();
    let damage = 0;
    if (this.lastExchangeType === "offense") {
      const dmgPerPoint = OFFENSE_DMG_PER_POINT_BASE + this.vars.powerBonus * OFFENSE_DMG_POWER_SCALE;
      damage = Math.round(score * dmgPerPoint);
      this.opponentHp = Math.max(0, this.opponentHp - damage);
      this.totalDamageDealt += damage;
    } else {
      const blockFraction = maxScore > 0 ? score / maxScore : 0;
      const chinReduction = Math.min(CHIN_REDUCTION_CAP, this.vars.chinBonus * CHIN_REDUCTION_SCALE);
      damage = Math.round(this.opponent.power * (1 - blockFraction) * (1 - chinReduction));
      this.playerHp = Math.max(0, this.playerHp - damage);
      this.totalDamageTaken += damage;
    }
    this.lastExchangeDamage = damage;
    this.phase = "resolve";
    this.phaseTimer = RESOLVE_PAUSE_MS;
  }

  private afterExchange() {
    if (this.opponentHp <= 0) {
      this.finishFight("ko-win");
      return;
    }
    if (this.playerHp <= 0) {
      this.finishFight("ko-loss");
      return;
    }
    this.turnIndex++;
    if (this.turnIndex >= 4) {
      this.opponentHp = Math.min(this.opponent.hp, this.opponentHp + this.opponent.recovery);
      this.playerHp = Math.min(100, this.playerHp + this.vars.cutmanLevel * CUTMAN_RECOVERY_PER_LEVEL);
      this.phase = "roundEnd";
      this.phaseTimer = ROUND_END_MS;
    } else {
      this.startTurn();
    }
  }

  private startNextRoundOrDecision() {
    if (this.round >= this.opponent.rounds) {
      if (this.totalDamageDealt > this.totalDamageTaken) this.finishFight("decision-win");
      else if (this.totalDamageDealt < this.totalDamageTaken) this.finishFight("decision-loss");
      else this.finishFight("draw");
      return;
    }
    this.round++;
    this.turnIndex = 0;
    this.phase = "roundIntro";
    this.phaseTimer = ROUND_INTRO_MS;
  }

  private startTurn() {
    this.combo = this.turnType() === "offense" ? this.generateOffenseCombo() : this.pickSignatureCombo();
    this.revealIndex = 0;
    this.revealStepTimer = this.stepRevealMs();
    this.phase = "telegraph";
  }

  private turnType(): FightTurnType {
    return this.turnIndex % 2 === 0 ? "offense" : "defense";
  }

  private stepRevealMs(): number {
    return TELEGRAPH_STEP_BASE_MS + this.vars.enduranceBonus * TELEGRAPH_ENDURANCE_SCALE_MS;
  }

  private generateOffenseCombo(): Direction[] {
    const length = Math.min(5, 3 + Math.floor((this.round - 1) / 3));
    const combo: Direction[] = [];
    for (let i = 0; i < length; i++) {
      let dir: Direction;
      do {
        dir = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
      } while (combo.length > 0 && dir === combo[combo.length - 1]);
      combo.push(dir);
    }
    return combo;
  }

  private pickSignatureCombo(): Direction[] {
    const combos = this.opponent.signatureCombos;
    return combos[Math.floor(Math.random() * combos.length)];
  }

  private finishFight(outcome: FightOutcome) {
    this.outcome = outcome;
    const won = outcome === "ko-win" || outcome === "decision-win";
    const multiplier = won ? 1.5 : outcome === "draw" ? 1.1 : 1;
    this.purseAwarded = Math.round(this.opponent.purse * multiplier);
    this.phase = "over";
  }

  isDone(): boolean {
    return this.phase === "over";
  }

  getOutcome(): FightOutcome | null {
    return this.outcome;
  }

  getPurseAwarded(): number {
    return this.purseAwarded;
  }

  getFinalPlayerHp(): number {
    return this.playerHp;
  }

  getOpponent(): Opponent {
    return this.opponent;
  }

  private opponentPose(): "guard" | "windup" | "stagger" | "ko" {
    if (this.phase === "over" && this.outcome === "ko-win") return "ko";
    if (this.phase === "resolve" && this.lastExchangeType === "offense" && this.lastExchangeDamage > 0) return "stagger";
    if ((this.phase === "telegraph" || this.phase === "input") && this.turnType() === "defense") return "windup";
    return "guard";
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.save();
    ctx.fillStyle = "#1a0e0e";
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Top bar: opponent name/tier, round counter.
    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(this.opponent.name, width / 2, 40);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(`${this.opponent.tier.toUpperCase()} · Round ${Math.min(this.round, this.opponent.rounds)}/${this.opponent.rounds}`, width / 2, 62);

    // Opponent HP bar.
    const barW = Math.min(320, width * 0.8);
    const barX = width / 2 - barW / 2;
    this.renderBar(ctx, barX, 78, barW, 14, this.opponentHp / this.opponent.hp, "#ff5a5a");

    if (this.phase === "over") {
      this.renderOver(ctx, width, height);
      ctx.restore();
      return;
    }

    // Opponent portrait, tinted/labeled by pose.
    const pose = this.opponentPose();
    const poseMeta: Record<string, { color: string; label: string }> = {
      guard: { color: "#5a5a6a", label: "GUARD" },
      windup: { color: "#e0a030", label: "WINDING UP" },
      stagger: { color: "#ff5a5a", label: "STAGGERED!" },
      ko: { color: "#333", label: "KO!" },
    };
    const meta = poseMeta[pose];
    const cy = height * 0.3;
    ctx.beginPath();
    ctx.arc(width / 2, cy, 78, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = meta.color;
    ctx.stroke();
    ctx.font = "64px sans-serif";
    ctx.fillText(this.opponent.icon, width / 2, cy);
    ctx.font = "bold 15px sans-serif";
    ctx.fillStyle = meta.color;
    ctx.fillText(meta.label, width / 2, cy + 108);

    // Screen-edge red flash the instant the player takes damage.
    if (this.phase === "resolve" && this.lastExchangeType === "defense" && this.lastExchangeDamage > 0) {
      ctx.strokeStyle = "rgba(255,60,60,0.55)";
      ctx.lineWidth = 18;
      ctx.strokeRect(9, 9, width - 18, height - 18);
    }

    // Turn banner.
    ctx.font = "bold 16px sans-serif";
    ctx.fillStyle = this.turnType() === "offense" ? "#3fbf6b" : "#ffd23f";
    const banner =
      this.phase === "telegraph"
        ? this.turnType() === "offense"
          ? "YOUR ATTACK — memorize it"
          : "INCOMING — memorize it to block"
        : this.phase === "input"
          ? this.turnType() === "offense"
            ? "THROW IT!"
            : "BLOCK IT!"
          : this.phase === "roundIntro"
            ? `ROUND ${this.round}`
            : "";
    ctx.fillText(banner, width / 2, height * 0.48);

    if (this.phase === "telegraph" || this.phase === "input") {
      this.renderCombo(ctx, width, height * 0.6);
    }
    if (this.phase === "resolve") {
      this.renderResolveBanner(ctx, width, height * 0.6);
    }
    if (this.phase === "roundEnd") {
      ctx.font = "14px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("Corner recovery...", width / 2, height * 0.6);
    }

    // Player HP bar (first-person — no body to show, just the status).
    const pBarY = height - 60;
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(`YOUR HP — ${Math.round(this.playerHp)}`, width / 2, pBarY - 12);
    this.renderBar(ctx, barX, pBarY, barW, 14, this.playerHp / 100, "#3fbf6b");

    ctx.restore();
  }

  private renderBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fraction: number, color: string) {
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(fraction, 0, 1), h);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  private renderCombo(ctx: CanvasRenderingContext2D, width: number, y: number) {
    const arrow: Record<Direction, string> = { up: "↑", down: "↓", left: "←", right: "→" };
    const n = this.combo.length;
    const slotW = 46;
    const startX = width / 2 - (slotW * (n - 1)) / 2;

    for (let i = 0; i < n; i++) {
      const x = startX + i * slotW;
      let color = "rgba(255,255,255,0.25)"; // upcoming
      let scale = 1;
      if (this.phase === "telegraph") {
        if (i === this.revealIndex) {
          color = "#fff";
          scale = 1.3;
        } else if (i < this.revealIndex) {
          color = "rgba(255,255,255,0.4)";
        }
      } else if (this.phase === "input") {
        const grade = this.stepGrades[i];
        if (grade === "perfect") color = "#3fbf6b";
        else if (grade === "good") color = "#ffd23f";
        else if (grade === "miss") color = "#ff5a5a";
        else if (i === this.inputIndex) {
          color = "#fff";
          scale = 1.3;
        }
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.font = "bold 30px sans-serif";
      ctx.fillStyle = color;
      ctx.fillText(arrow[this.combo[i]], 0, 0);
      ctx.restore();
    }

    // Current step's timer bar (skipped for the free first swipe).
    if (this.phase === "input" && this.inputIndex > 0 && Number.isFinite(this.stepTimerMs) && this.stepTimerMs > 0) {
      const barW = 140;
      const barX = width / 2 - barW / 2;
      const barY = y + 40;
      this.renderBar(ctx, barX, barY, barW, 8, this.swipeDeadline / this.stepTimerMs, "#fff");
    } else if (this.phase === "input" && this.inputIndex === 0) {
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText("(no timer on the first swipe)", width / 2, y + 44);
    }
  }

  private renderResolveBanner(ctx: CanvasRenderingContext2D, width: number, y: number) {
    const dealt = this.lastExchangeType === "offense";
    const missed = this.lastExchangeDamage === 0 && dealt;
    const blocked = this.lastExchangeType === "defense" && this.lastExchangeDamage === 0;
    ctx.font = "bold 22px sans-serif";
    if (dealt) {
      ctx.fillStyle = missed ? "#ff5a5a" : "#3fbf6b";
      ctx.fillText(missed ? "MISSED!" : `HIT! -${this.lastExchangeDamage} HP`, width / 2, y);
    } else {
      ctx.fillStyle = blocked ? "#3fbf6b" : "#ff5a5a";
      ctx.fillText(blocked ? "BLOCKED!" : `TAGGED! -${this.lastExchangeDamage} HP`, width / 2, y);
    }
  }

  private renderOver(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const won = this.outcome === "ko-win" || this.outcome === "decision-win";
    const draw = this.outcome === "draw";
    const title = draw ? "DRAW" : won ? "YOU WIN" : "YOU LOSE";
    const sub =
      this.outcome === "ko-win"
        ? "by Knockout"
        : this.outcome === "ko-loss"
          ? "by Knockout"
          : this.outcome === "draw"
            ? "— going the distance, even on the cards"
            : "by Decision";

    ctx.font = "bold 40px sans-serif";
    ctx.fillStyle = draw ? "#ffd23f" : won ? "#3fbf6b" : "#ff5a5a";
    ctx.fillText(title, width / 2, height * 0.36);
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(sub, width / 2, height * 0.36 + 34);

    ctx.font = "18px sans-serif";
    ctx.fillStyle = "#ffd23f";
    ctx.fillText(`Purse: $${this.purseAwarded.toLocaleString()}`, width / 2, height * 0.5);

    ctx.font = "13px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(
      `Damage dealt ${this.totalDamageDealt} · Damage taken ${this.totalDamageTaken}`,
      width / 2,
      height * 0.5 + 30,
    );
  }
}
