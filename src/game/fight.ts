// Fight System (Stage 1) — the real interactive memory-combo fight,
// replacing the old placeholder "Simulate Fight" button. Ego/first-person
// view of the opponent (Punch-Out!!-style), driven by the 5 camp
// variables fed in from the completed camp cycle (HP/Power/Speed/
// Endurance/Chin — see FightCampVariables). Same class shape as the
// training minigames (HeavyBagScene/ReflexDotsScene/JumpRopeScene):
// event-driven input, update(dt,w,h)/render(ctx,w,h) each frame,
// isDone() gates the exit prompt.
//
// Per-exchange flow (spec): a combo is revealed once at a fixed rhythm,
// then re-input from memory — the revealed sequence isn't shown again
// during input, so it's genuinely a memory test (see renderCombo, which
// only reveals a slot's direction once it's been graded). The first
// swipe is untimed; every swipe after has a timer window. A wrong
// direction (or a timeout) grades that single step a Miss and moves on
// to the next one — it no longer aborts the whole combo, so a rough
// start can still be partly salvaged.
//
// Rounds are 2 Offense + 2 Defense turns, alternating. Offense throws a
// procedurally generated combo (length scales with the round) — Power
// scales damage dealt. Defense has to reproduce one of the opponent's
// own fixed signature combos (so each opponent is genuinely learnable)
// — blocking it well reduces incoming damage, Chin reduces it further.
// No KO by the last round goes to Decision, scored by net damage.
//
// Two round-level bonus/danger beats, both reusing an existing training
// minigame's mechanic wholesale rather than inventing a new one:
//   - Both Offense turns landed all-Perfect -> a Power Punch bonus using
//     HeavyBagScene's charge-and-release meter (only the green zone
//     lands it; everything else whiffs).
//   - Both Defense turns took damage -> the opponent presses the
//     advantage with a dangerous flurry, represented by ReflexDotsScene
//     — land the dot (Perfect or Good) to dodge it, miss it and eat a
//     big hit.

import type { Opponent, Direction } from "./opponents";
import { HeavyBagScene, type HeavyBagPhase } from "./heavyBag";
import { ReflexDotsScene } from "./reflexDots";

export type FightTurnType = "offense" | "defense";
export type FightPhase =
  | "roundIntro"
  | "telegraph"
  | "input"
  | "resolve"
  | "powerPunch"
  | "powerPunchResolve"
  | "dangerReflex"
  | "dangerReflexResolve"
  | "roundEnd"
  | "over";
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
// The Power Punch bonus lands as if it were a 3-step all-Perfect combo.
const POWER_PUNCH_BONUS_SCORE = 6;

// Less damage taken from opponent hits, with Chin.
const CHIN_REDUCTION_SCALE = 0.02;
const CHIN_REDUCTION_CAP = 0.5;
// The danger flurry hits harder than a normal defense turn's worst case.
const DANGER_DAMAGE_MULTIPLIER = 1.5;

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

  // Round-level bonus tracking (see class comment) — reset every round.
  private roundOffensePerfect: boolean[] = [];
  private roundDefenseHit: boolean[] = [];

  private combo: Direction[] = [];
  private revealIndex = 0;
  private revealStepTimer = 0;
  private inputIndex = 0;
  private stepTimerMs = 0;
  private swipeDeadline = 0;
  private stepGrades: StepGrade[] = [];

  private lastExchangeDamage = 0;
  private lastExchangeType: FightTurnType = "offense";
  private lastBonusLabel = "";

  private powerPunchGame: HeavyBagScene | null = null;
  private dangerGame: ReflexDotsScene | null = null;

  private outcome: FightOutcome | null = null;
  private purseAwarded = 0;

  constructor(opponent: Opponent, vars: FightCampVariables) {
    this.opponent = opponent;
    this.vars = vars;
    this.playerHp = clamp(vars.hp, 1, 100);
    this.opponentHp = opponent.hp;
  }

  update(dt: number, width: number, height: number) {
    const dtMs = dt * 1000;
    if (this.isTimedPause()) {
      this.phaseTimer -= dtMs;
      if (this.phaseTimer <= 0) this.onPauseComplete();
      return;
    }
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
          this.revealStepTimer = this.stepRevealMs();
        }
      }
    } else if (this.phase === "input") {
      if (this.inputIndex > 0 && Number.isFinite(this.swipeDeadline)) {
        this.swipeDeadline -= dtMs;
        if (this.swipeDeadline <= 0) this.gradeStep("miss");
      }
    } else if (this.phase === "powerPunch") {
      this.powerPunchGame!.update(dt);
      if (this.powerPunchGame!.getPhase() === "result") {
        const last = this.powerPunchGame!.getResults().slice(-1)[0];
        this.resolvePowerPunch(last === "perfect");
      }
    } else if (this.phase === "dangerReflex") {
      this.dangerGame!.update(dt, width, height);
      // ReflexDotsScene doesn't expose its phase publicly (only
      // isDone()/getResults(), which only flips isDone() true after a
      // full 12-dot session) — a result landing at all means this single
      // dot just resolved, which is all this bonus needs.
      const results = this.dangerGame!.getResults();
      if (results.length >= 1) {
        const last = results[0];
        this.resolveDangerReflex(last === "perfect" || last === "good");
      }
    }
    // "over": nothing to tick — waiting on the caller's exit prompt.
  }

  private isTimedPause(): boolean {
    return (
      this.phase === "roundIntro" ||
      this.phase === "resolve" ||
      this.phase === "powerPunchResolve" ||
      this.phase === "dangerReflexResolve" ||
      this.phase === "roundEnd"
    );
  }

  private onPauseComplete() {
    if (this.phase === "roundIntro") {
      this.startTurn();
      return;
    }
    if (this.phase === "roundEnd") {
      this.startNextRoundOrDecision();
      return;
    }
    if (this.checkKO()) return;
    if (this.phase === "resolve") this.continueAfterExchange();
    else if (this.phase === "powerPunchResolve") this.continueAfterPowerPunch();
    else this.startRoundEnd(); // dangerReflexResolve
  }

  private checkKO(): boolean {
    if (this.opponentHp <= 0) {
      this.finishFight("ko-win");
      return true;
    }
    if (this.playerHp <= 0) {
      this.finishFight("ko-loss");
      return true;
    }
    return false;
  }

  // --- Swipe combos (normal Offense/Defense turns) ---

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
    if (this.inputIndex >= this.combo.length) this.finishExchange();
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
    const timer = clamp(TIMER_BASE_MS + jitter + this.vars.speedBonus * TIMER_SPEED_SCALE_MS, TIMER_MIN_MS, TIMER_MAX_MS);
    this.stepTimerMs = timer;
    this.swipeDeadline = timer;
  }

  private finishExchange() {
    const maxScore = this.combo.length * 2;
    const score = this.stepGrades.reduce((sum, g) => sum + (g === "perfect" ? 2 : g === "good" ? 1 : 0), 0);
    const type = this.turnType();
    let damage = 0;
    if (type === "offense") {
      const dmgPerPoint = OFFENSE_DMG_PER_POINT_BASE + this.vars.powerBonus * OFFENSE_DMG_POWER_SCALE;
      damage = Math.round(score * dmgPerPoint);
      this.opponentHp = Math.max(0, this.opponentHp - damage);
      this.totalDamageDealt += damage;
      this.roundOffensePerfect.push(this.stepGrades.every((g) => g === "perfect"));
    } else {
      const blockFraction = maxScore > 0 ? score / maxScore : 0;
      const chinReduction = Math.min(CHIN_REDUCTION_CAP, this.vars.chinBonus * CHIN_REDUCTION_SCALE);
      damage = Math.round(this.opponent.power * (1 - blockFraction) * (1 - chinReduction));
      this.playerHp = Math.max(0, this.playerHp - damage);
      this.totalDamageTaken += damage;
      this.roundDefenseHit.push(damage > 0);
    }
    this.lastExchangeDamage = damage;
    this.lastExchangeType = type;
    this.phase = "resolve";
    this.phaseTimer = RESOLVE_PAUSE_MS;
  }

  private continueAfterExchange() {
    const finishedTurnIndex = this.turnIndex;
    // Both Offense turns of the round landed all-Perfect -> bonus Power Punch.
    if (finishedTurnIndex === 2 && this.roundOffensePerfect.length === 2 && this.roundOffensePerfect.every(Boolean)) {
      this.startPowerPunch();
      return;
    }
    if (finishedTurnIndex === 3) {
      // Took damage in both Defense turns -> the opponent goes all-in.
      if (this.roundDefenseHit.length === 2 && this.roundDefenseHit.every(Boolean)) {
        this.startDangerReflex();
      } else {
        this.startRoundEnd();
      }
      return;
    }
    this.turnIndex++;
    this.startTurn();
  }

  // --- Power Punch bonus (HeavyBagScene's meter, reused wholesale) ---

  private startPowerPunch() {
    this.powerPunchGame = new HeavyBagScene();
    this.phase = "powerPunch";
  }

  handlePowerPunchStart() {
    this.powerPunchGame?.startCharge();
  }

  handlePowerPunchRelease() {
    this.powerPunchGame?.release();
  }

  getPowerPunchPhase(): HeavyBagPhase | null {
    return this.powerPunchGame?.getPhase() ?? null;
  }

  private resolvePowerPunch(hit: boolean) {
    let damage = 0;
    if (hit) {
      const dmgPerPoint = OFFENSE_DMG_PER_POINT_BASE + this.vars.powerBonus * OFFENSE_DMG_POWER_SCALE;
      damage = Math.round(dmgPerPoint * POWER_PUNCH_BONUS_SCORE);
      this.opponentHp = Math.max(0, this.opponentHp - damage);
      this.totalDamageDealt += damage;
    }
    this.lastBonusLabel = hit ? `POWER PUNCH! -${damage} HP` : "POWER PUNCH — MISSED!";
    this.powerPunchGame = null;
    this.phase = "powerPunchResolve";
    this.phaseTimer = RESOLVE_PAUSE_MS;
  }

  private continueAfterPowerPunch() {
    this.turnIndex++; // 2 -> 3, the round's closing Defense turn
    this.startTurn();
  }

  // --- Danger Reflex bonus (ReflexDotsScene's single dot, reused wholesale) ---

  private startDangerReflex() {
    this.dangerGame = new ReflexDotsScene();
    this.phase = "dangerReflex";
  }

  handleDangerTap(x: number, y: number) {
    this.dangerGame?.handleTap(x, y);
  }

  private resolveDangerReflex(saved: boolean) {
    let damage = 0;
    if (!saved) {
      const chinReduction = Math.min(CHIN_REDUCTION_CAP, this.vars.chinBonus * CHIN_REDUCTION_SCALE);
      damage = Math.round(this.opponent.power * DANGER_DAMAGE_MULTIPLIER * (1 - chinReduction));
      this.playerHp = Math.max(0, this.playerHp - damage);
      this.totalDamageTaken += damage;
    }
    this.lastBonusLabel = saved ? "DODGED THE FLURRY!" : `CAUGHT! -${damage} HP`;
    this.dangerGame = null;
    this.phase = "dangerReflexResolve";
    this.phaseTimer = RESOLVE_PAUSE_MS;
  }

  // --- Round/turn bookkeeping ---

  private startRoundEnd() {
    this.opponentHp = Math.min(this.opponent.hp, this.opponentHp + this.opponent.recovery);
    this.playerHp = Math.min(100, this.playerHp + this.vars.cutmanLevel * CUTMAN_RECOVERY_PER_LEVEL);
    this.phase = "roundEnd";
    this.phaseTimer = ROUND_END_MS;
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
    this.roundOffensePerfect = [];
    this.roundDefenseHit = [];
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

  getPhase(): FightPhase {
    return this.phase;
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
    if (this.phase === "powerPunchResolve" && this.lastBonusLabel.startsWith("POWER PUNCH!")) return "stagger";
    if (this.phase === "dangerReflexResolve") return "windup";
    if ((this.phase === "telegraph" || this.phase === "input") && this.turnType() === "defense") return "windup";
    return "guard";
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (this.phase === "over") {
      ctx.fillStyle = "#1a0e0e";
      ctx.fillRect(0, 0, width, height);
      this.renderOver(ctx, width, height);
      ctx.restore();
      return;
    }

    if (this.phase === "powerPunch" && this.powerPunchGame) {
      this.powerPunchGame.render(ctx, width, height);
      this.renderBonusLabel(ctx, width, "🎁 BONUS — Land the Power Punch!");
    } else if (this.phase === "dangerReflex" && this.dangerGame) {
      this.dangerGame.render(ctx, width, height);
      this.renderBonusLabel(ctx, width, "⚠️ HE'S SWINGING FOR THE FENCES!");
    } else {
      ctx.fillStyle = "#1a0e0e";
      ctx.fillRect(0, 0, width, height);
      this.renderMainScene(ctx, width, height);
    }

    // Top bar and player HP bar are drawn on top of everything, including
    // the delegated bonus minigames — also covers over their own titles.
    this.renderTopBar(ctx, width);
    this.renderPlayerHpBar(ctx, width, height);

    ctx.restore();
  }

  private renderTopBar(ctx: CanvasRenderingContext2D, width: number) {
    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(this.opponent.name, width / 2, 40);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(`${this.opponent.tier.toUpperCase()} · Round ${Math.min(this.round, this.opponent.rounds)}/${this.opponent.rounds}`, width / 2, 62);

    const barW = Math.min(320, width * 0.8);
    const barX = width / 2 - barW / 2;
    this.renderBar(ctx, barX, 78, barW, 14, this.opponentHp / this.opponent.hp, "#ff5a5a");
  }

  private renderPlayerHpBar(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const barW = Math.min(320, width * 0.8);
    const barX = width / 2 - barW / 2;
    const pBarY = height - 60;
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(`YOUR HP — ${Math.round(this.playerHp)}`, width / 2, pBarY - 12);
    this.renderBar(ctx, barX, pBarY, barW, 14, this.playerHp / 100, "#3fbf6b");
  }

  private renderBonusLabel(ctx: CanvasRenderingContext2D, width: number, text: string) {
    ctx.font = "bold 14px sans-serif";
    ctx.fillStyle = "#ffd23f";
    ctx.fillText(text, width / 2, 100);
  }

  private renderMainScene(ctx: CanvasRenderingContext2D, width: number, height: number) {
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
    ctx.fillStyle = "#fff";
    ctx.fillText(this.opponent.icon, width / 2, cy);
    ctx.font = "bold 15px sans-serif";
    ctx.fillStyle = meta.color;
    ctx.fillText(meta.label, width / 2, cy + 108);

    // Screen-edge red flash the instant the player takes damage.
    const tookHit =
      (this.phase === "resolve" && this.lastExchangeType === "defense" && this.lastExchangeDamage > 0) ||
      (this.phase === "dangerReflexResolve" && this.lastBonusLabel.startsWith("CAUGHT!"));
    if (tookHit) {
      ctx.strokeStyle = "rgba(255,60,60,0.55)";
      ctx.lineWidth = 18;
      ctx.strokeRect(9, 9, width - 18, height - 18);
    }

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
    if (this.phase === "powerPunchResolve" || this.phase === "dangerReflexResolve") {
      ctx.font = "bold 22px sans-serif";
      ctx.fillStyle = this.lastBonusLabel.includes("MISS") || this.lastBonusLabel.startsWith("CAUGHT!") ? "#ff5a5a" : "#3fbf6b";
      ctx.fillText(this.lastBonusLabel, width / 2, height * 0.6);
    }
    if (this.phase === "roundEnd") {
      ctx.font = "14px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("Corner recovery...", width / 2, height * 0.6);
    }
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

  // Only ever reveals a slot's actual direction once it's been graded
  // (i < inputIndex) or while it's being telegraphed — the current and
  // upcoming input slots stay blank ("?"/"•") so the player has to
  // recall them from memory instead of reading them off screen.
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
