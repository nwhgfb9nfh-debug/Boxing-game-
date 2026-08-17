import "./style.css";
import { createDriveControls } from "./ui/controls";
import { createBuildingUI } from "./ui/buildingUI";
import { createJoystick } from "./ui/joystick";
import { createActionButtons } from "./ui/actionButtons";
import { createTapZone } from "./ui/tapZone";
import { createPhoneUI, type PhoneApi, type HouseListing } from "./ui/phoneUI";
import { createActionMenu, type MenuData } from "./ui/actionMenu";
import { StreetScene } from "./game/street";
import { InteriorScene, type Station } from "./game/interior";
import { HeavyBagScene } from "./game/heavyBag";
import { ReflexDotsScene } from "./game/reflexDots";
import { JumpRopeScene } from "./game/jumpRope";
import { createPlayerState, type TrainingStats, type GymLevels } from "./game/playerState";
import { EnergyStar } from "./game/energyStar";
import { nearbyLots, rowForFacing, getHousingBuildings, type LotInstance } from "./game/world";

const app = document.querySelector<HTMLDivElement>("#app")!;

const canvas = document.createElement("canvas");
app.appendChild(canvas);
const ctx = canvas.getContext("2d")!;

const hud = document.createElement("div");
hud.className = "hud";
const hudLabel = document.createElement("div");
hudLabel.className = "hud__label";
hud.appendChild(hudLabel);
app.appendChild(hud);

const controls = createDriveControls(app);
const buildingUI = createBuildingUI(app);
const joystick = createJoystick(app);
const actionButtons = createActionButtons(app);
const tapZone = createTapZone(app);
const street = new StreetScene(controls);

const playerState = createPlayerState();
const energy = new EnergyStar();

// Energy Star + HP (Section 3 & 7) — top-right, always visible outside minigames.
const statusHud = document.createElement("div");
statusHud.className = "status-hud";
const energyPill = document.createElement("div");
energyPill.className = "status-hud__pill status-hud__pill--energy";
const hpPill = document.createElement("div");
hpPill.className = "status-hud__pill status-hud__pill--hp";
statusHud.appendChild(energyPill);
statusHud.appendChild(hpPill);
app.appendChild(statusHud);

// Money (Section 5) — its own HUD, top-left.
const moneyHud = document.createElement("div");
moneyHud.className = "money-hud";
const moneyPill = document.createElement("div");
moneyPill.className = "money-hud__pill";
moneyHud.appendChild(moneyPill);
app.appendChild(moneyHud);

// The Phone (Section 5) — only usable inside a building, not while
// driving. Home screen of apps: Contacts, Stats, Real Estate, Buzzer
// (Twitter), Imagestar (Instagram, not v1 yet).
function getHouseListings(): HouseListing[] {
  return getHousingBuildings().map((b) => ({ name: b.name, locked: !!b.locked, price: b.price }));
}

const phoneApi: PhoneApi = {
  getEnergy: () => energy.remaining,
  getFame: () => playerState.fame,
  getImage: () => playerState.image,
  getMoney: () => playerState.money,
  getHp: () => playerState.hp,
  getTraining: () => playerState.training,
  getHouses: getHouseListings,
  buyHouse: (name) => {
    const house = getHousingBuildings().find((h) => h.name === name);
    if (!house) return "Not found.";
    if (!house.locked) return `${name} is already owned.`;
    const price = house.price ?? 0;
    if (playerState.money < price) return `Not enough money — need $${price}.`;
    playerState.money -= price;
    house.locked = false;
    return `Purchased ${name}!`;
  },
  post: () => {
    if (!energy.spend(10)) return "Not enough energy to post.";
    playerState.fame += 2;
    return "Posted! Fame +2.";
  },
};

const phoneUI = createPhoneUI(app, phoneApi);

const phoneBtn = document.createElement("button");
phoneBtn.type = "button";
phoneBtn.className = "btn btn--phone";
phoneBtn.textContent = "📱";
app.appendChild(phoneBtn);
phoneBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  phoneUI.open();
});

// Shared overlay for every other Private Life location's action menu
// (Gym's Workout Clip first; Diner/Beach/Office/Lounge/Press reuse this
// same instance as they come online — only one can be open at a time).
const locationMenu = createActionMenu(app);

function openWorkoutClipMenu() {
  locationMenu.open(() => ({
    title: "🎥 Workout Clip",
    energyText: `Energy: ${energy.remaining}/100  ·  Fame: ${playerState.fame}  ·  Image: ${playerState.image}`,
    actions: [
      {
        id: "post-workout",
        label: "Post a Workout Clip",
        cost: 10,
        run: () => {
          if (!energy.spend(10)) return "Not enough energy to post a clip.";
          playerState.fame += 2;
          playerState.image += 2;
          return "Posted! Fame +2, Image +2.";
        },
      },
    ],
  }));
}

function openDinerMenu() {
  locationMenu.open(() => ({
    title: "🍔 Diner",
    energyText: `Energy: ${energy.remaining}/100  ·  HP: ${playerState.hp}`,
    actions: [
      {
        id: "order",
        label: "Order Menu",
        cost: 10,
        run: () => {
          if (!energy.spend(10)) return "Not enough energy to order.";
          playerState.hp += 5;
          return `Order's up! HP +5 (now ${playerState.hp}).`;
        },
      },
    ],
  }));
}

// Press Building (Section 6, Promotion): the room's other 4 stations
// (Press Conference, Photo Studio, Face-Off, Fan Event) are the real
// pre-fight Promotion-camp events from the spec — held off until that
// system exists, so for now they just show "coming soon". Press Reception
// is a normal always-available Private Life action, live now.
function comingSoon(label: string, anchor: { x: number; y: number }) {
  buildingUI.showToast(`${label} — coming soon!`, anchor, "bottom");
}

interface PressFormat {
  name: string;
  icon: string;
  energyCost: number;
  hpCost: number;
  professional: { fame: number; image: number };
  confrontational: { fame: number; image: number };
}
const PRESS_FORMATS: Record<"podcast" | "tv", PressFormat> = {
  podcast: {
    name: "Podcast",
    icon: "🎙️",
    energyCost: 15,
    hpCost: 5,
    professional: { fame: 2, image: 2 },
    confrontational: { fame: 5, image: -3 },
  },
  tv: {
    name: "TV Interview",
    icon: "📺",
    energyCost: 20,
    hpCost: 7,
    professional: { fame: 3, image: 3 },
    confrontational: { fame: 7, image: -4 },
  },
};

type PressReceptionView = "main" | "podcast" | "tv";
let pressReceptionView: PressReceptionView = "main";

function buildPressChoiceMenu(kind: "podcast" | "tv"): MenuData {
  const fmt = PRESS_FORMATS[kind];
  const runTone = (tone: "professional" | "confrontational") => () => {
    if (!energy.spend(fmt.energyCost)) return `Not enough energy for a ${fmt.name.toLowerCase()}.`;
    if (playerState.hp < fmt.hpCost) return "Not enough HP.";
    playerState.hp -= fmt.hpCost;
    const { fame, image } = fmt[tone];
    playerState.fame += fame;
    playerState.image += image;
    return `Fame +${fame}, Image ${image >= 0 ? "+" : ""}${image}, HP -${fmt.hpCost}.`;
  };
  return {
    title: `${fmt.icon} ${fmt.name}`,
    energyText: `Energy: ${energy.remaining}/100  ·  HP: ${playerState.hp}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          pressReceptionView = "main";
          return "";
        },
      },
      { id: "professional", label: "Professional", cost: fmt.energyCost, run: runTone("professional") },
      { id: "confrontational", label: "Confrontational", cost: fmt.energyCost, run: runTone("confrontational") },
    ],
  };
}

function buildPressReceptionMenu(): MenuData {
  if (pressReceptionView === "podcast") return buildPressChoiceMenu("podcast");
  if (pressReceptionView === "tv") return buildPressChoiceMenu("tv");
  return {
    title: "🗞️ Press Reception",
    energyText: `Energy: ${energy.remaining}/100  ·  HP: ${playerState.hp}`,
    actions: [
      {
        id: "podcast",
        label: `${PRESS_FORMATS.podcast.icon} Podcast`,
        cost: 0,
        costLabel: "›",
        run: () => {
          pressReceptionView = "podcast";
          return "";
        },
      },
      {
        id: "tv",
        label: `${PRESS_FORMATS.tv.icon} TV Interview`,
        cost: 0,
        costLabel: "›",
        run: () => {
          pressReceptionView = "tv";
          return "";
        },
      },
    ],
  };
}

function openPressReceptionMenu() {
  pressReceptionView = "main";
  locationMenu.open(buildPressReceptionMenu);
}

function openSunbatheMenu() {
  locationMenu.open(() => ({
    title: "☀️ Sunbathe",
    energyText: `Energy: ${energy.remaining}/100  ·  Image: ${playerState.image}`,
    actions: [
      {
        id: "sunbathe",
        label: "Sunbathe",
        cost: 10,
        run: () => {
          if (!energy.spend(10)) return "Not enough energy to sunbathe.";
          playerState.image += 3;
          return `Image +3 (now ${playerState.image}).`;
        },
      },
    ],
  }));
}

function openSwimMenu() {
  locationMenu.open(() => ({
    title: "🌊 Swim",
    energyText: `Energy: ${energy.remaining}/100  ·  HP: ${playerState.hp}`,
    actions: [
      {
        id: "swim",
        label: "Swim",
        cost: 10,
        run: () => {
          if (!energy.spend(10)) return "Not enough energy to swim.";
          playerState.hp += 3;
          return `A little stamina boost. HP +3 (now ${playerState.hp}).`;
        },
      },
    ],
  }));
}

// Office reception (Section 5): each staff role (and each gym section) is
// already at Lvl 1 for free; Lvl 2/3 cost money. Manager level additionally
// gates which Office elevator floors are reachable.
interface StaffRole {
  id: "manager" | "coach" | "cutman";
  name: string;
  icon: string;
  prices: [number, number]; // price to reach Lvl 2, Lvl 3
}
const STAFF_ROLES: StaffRole[] = [
  { id: "manager", name: "Manager", icon: "💼", prices: [2000, 5000] },
  { id: "coach", name: "Coach", icon: "🥊", prices: [2000, 5000] },
  { id: "cutman", name: "Cutman", icon: "🩹", prices: [1500, 4000] },
];

function getStaffLevel(role: StaffRole["id"]): number {
  if (role === "manager") return playerState.managerLevel;
  if (role === "coach") return playerState.coachLevel;
  return playerState.cutmanLevel;
}

function setStaffLevel(role: StaffRole["id"], level: number) {
  if (role === "manager") playerState.managerLevel = level;
  else if (role === "coach") playerState.coachLevel = level;
  else playerState.cutmanLevel = level;
}

interface GymCategory {
  id: keyof GymLevels;
  name: string;
  icon: string;
  prices: [number, number]; // price to reach Lvl 2, Lvl 3
}
const GYM_CATEGORIES: GymCategory[] = [
  { id: "weightArea", name: "Weight Area", icon: "🏋️", prices: [3000, 7000] },
  { id: "power", name: "Power", icon: "👊", prices: [3000, 7000] },
  { id: "speed", name: "Speed", icon: "⚡", prices: [3000, 7000] },
  { id: "endurance", name: "Endurance", icon: "🫁", prices: [3000, 7000] },
];

// Office is a multi-room building: Lobby (Reception + Elevator) -> Floor
// 1-3 (each floor's manager's office). Floor rooms reuse InteriorScene like
// any other room, but walking out their door returns to the Lobby instead
// of the street — see the "interior" scene branch below.
const OFFICE_FLOOR_STATIONS: Record<number, Station[]> = {
  1: [{ id: "managerdesk", label: "Manager Desk", nx: 0.5, ny: 0.4 }],
  2: [{ id: "managerdesk", label: "Manager Desk", nx: 0.5, ny: 0.4 }],
  3: [{ id: "managerdesk", label: "Manager Desk", nx: 0.5, ny: 0.4 }],
};

const CASH_ADVANCE_AMOUNT = 20000; // placeholder — deducted from the purse once the Fight/Promotion economy exists
const PORTFOLIO_INVEST_AMOUNT = 5000; // placeholder — returns arrive once a real investment system exists

interface SponsorshipDeal {
  id: string;
  name: string;
  perFightPayout: number; // paid out per completed fight while the contract is active
  contractFights: number; // deal length, in fights
}
const SPONSORSHIP_DEALS: SponsorshipDeal[] = [
  { id: "local-gym", name: "Local Gym Co-Sponsor", perFightPayout: 500, contractFights: 3 },
  { id: "sportswear", name: "Sportswear Brand", perFightPayout: 1500, contractFights: 5 },
  { id: "energy-drink", name: "Energy Drink Co.", perFightPayout: 3000, contractFights: 8 },
];

type ManagerDeskView = "main" | "sponsorships";
let managerDeskView: ManagerDeskView = "main";

function buildManagerDeskMenu(floor: number): MenuData {
  if (managerDeskView === "sponsorships") return buildSponsorshipsMenu();
  const actions: MenuData["actions"] = [
    {
      id: "set-next-fight",
      label: "Set Next Fight",
      cost: 0,
      costLabel: playerState.fightScheduled ? "SCHEDULED" : "SET",
      disabled: playerState.fightScheduled,
      run: () => {
        if (playerState.fightScheduled) return "You already have a fight scheduled.";
        playerState.fightScheduled = true;
        return "Fight scheduled! (Full matchmaking arrives with the Promotion system.)";
      },
    },
    {
      id: "sponsorships",
      label: "Sponsorships",
      cost: 0,
      costLabel: "›",
      run: () => {
        managerDeskView = "sponsorships";
        return "";
      },
    },
    {
      id: "cash-advance",
      label: "Request Cash Advance",
      cost: 0,
      costLabel: !playerState.fightScheduled
        ? "NEED FIGHT"
        : playerState.cashAdvanceTaken
          ? "TAKEN"
          : `+$${CASH_ADVANCE_AMOUNT}`,
      disabled: !playerState.fightScheduled || playerState.cashAdvanceTaken,
      run: () => {
        if (!playerState.fightScheduled) return "Schedule a fight first.";
        if (playerState.cashAdvanceTaken) return "You've already taken an advance against this fight's purse.";
        playerState.money += CASH_ADVANCE_AMOUNT;
        playerState.cashAdvanceTaken = true;
        return `Advance granted: +$${CASH_ADVANCE_AMOUNT} (comes out of your purse after the fight).`;
      },
    },
    {
      id: "media-training",
      label: "Media Training",
      cost: 10,
      run: () => {
        if (!energy.spend(10)) return "Not enough energy for media training.";
        playerState.image += 2;
        return `Image +2 (now ${playerState.image}).`;
      },
    },
    {
      id: "charity-event",
      label: "Charity Event",
      cost: 15,
      run: () => {
        if (!energy.spend(15)) return "Not enough energy for a charity event.";
        if (playerState.hp < 5) return "Not enough HP for a charity event.";
        playerState.hp -= 5;
        playerState.image += 5;
        return `Image +5 (now ${playerState.image}), HP -5 (now ${playerState.hp}).`;
      },
    },
  ];

  // Manager Lvl 2+ desk options.
  if (floor >= 2) {
    actions.push({
      id: "invest-portfolio",
      label: "Invest in Portfolio",
      cost: 0,
      costLabel: `-$${PORTFOLIO_INVEST_AMOUNT}`,
      disabled: playerState.money < PORTFOLIO_INVEST_AMOUNT,
      run: () => {
        if (playerState.money < PORTFOLIO_INVEST_AMOUNT) {
          return `Not enough money — need $${PORTFOLIO_INVEST_AMOUNT}, have $${playerState.money}.`;
        }
        playerState.money -= PORTFOLIO_INVEST_AMOUNT;
        playerState.portfolioInvested += PORTFOLIO_INVEST_AMOUNT;
        return `Invested $${PORTFOLIO_INVEST_AMOUNT} (total $${playerState.portfolioInvested}). Returns arrive once a real investment system exists.`;
      },
    });
  }

  // Manager Lvl 3 desk option.
  if (floor >= 3) {
    actions.push({
      id: "networking-event",
      label: "Networking Event",
      cost: 20,
      run: () => {
        if (!energy.spend(20)) return "Not enough energy for a networking event.";
        if (playerState.hp < 8) return "Not enough HP for a networking event.";
        playerState.hp -= 8;
        playerState.fame += 5;
        return `Fame +5 (now ${playerState.fame}), HP -8 (now ${playerState.hp}).`;
      },
    });
  }

  return {
    title: `🗄️ Manager Desk — Lvl ${floor}`,
    energyText: `Energy: ${energy.remaining}/100  ·  Money: $${playerState.money}`,
    actions,
  };
}

function buildSponsorshipsMenu(): MenuData {
  return {
    title: "🤝 Sponsorships",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          managerDeskView = "main";
          return "";
        },
      },
      ...SPONSORSHIP_DEALS.map((deal) => {
        const running = playerState.sponsorships.find((s) => s.dealId === deal.id);
        return {
          id: `sponsor-${deal.id}`,
          label: `${deal.name} — $${deal.perFightPayout}/fight × ${deal.contractFights}`,
          cost: 0,
          costLabel: running ? `${running.fightsRemaining} LEFT` : "SIGN",
          disabled: !!running,
          run: () => {
            if (running) return `${deal.name} is already running.`;
            playerState.sponsorships.push({ dealId: deal.id, fightsRemaining: deal.contractFights });
            return `Signed with ${deal.name}! $${deal.perFightPayout}/fight for the next ${deal.contractFights} fights.`;
          },
        };
      }),
    ],
  };
}

function openManagerDeskMenu(floor: number) {
  managerDeskView = "main";
  locationMenu.open(() => buildManagerDeskMenu(floor));
}

type ReceptionView = "main" | "staff" | "staff-role" | "gym" | "gym-category";
let receptionView: ReceptionView = "main";
let activeStaffRole: StaffRole["id"] | null = null;
let activeGymCategory: GymCategory["id"] | null = null;

function buildReceptionMenu(): MenuData {
  if (receptionView === "staff") return buildStaffMenu();
  if (receptionView === "staff-role" && activeStaffRole) return buildStaffRoleMenu(activeStaffRole);
  if (receptionView === "gym") return buildGymMenu();
  if (receptionView === "gym-category" && activeGymCategory) return buildGymCategoryMenu(activeGymCategory);
  return {
    title: "🛎️ Reception",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "hire-staff",
        label: "Hire Staff",
        cost: 0,
        costLabel: "›",
        run: () => {
          receptionView = "staff";
          return "";
        },
      },
      {
        id: "upgrade-gym",
        label: "Upgrade Gym",
        cost: 0,
        costLabel: "›",
        run: () => {
          receptionView = "gym";
          return "";
        },
      },
    ],
  };
}

function buildStaffMenu(): MenuData {
  return {
    title: "👥 Hire Staff",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          receptionView = "main";
          return "";
        },
      },
      ...STAFF_ROLES.map((role) => ({
        id: `role-${role.id}`,
        label: `${role.icon} ${role.name} (Lvl ${getStaffLevel(role.id)}/3)`,
        cost: 0,
        costLabel: "›",
        run: () => {
          activeStaffRole = role.id;
          receptionView = "staff-role";
          return "";
        },
      })),
    ],
  };
}

function buildStaffRoleMenu(roleId: StaffRole["id"]): MenuData {
  const role = STAFF_ROLES.find((r) => r.id === roleId)!;
  // The Manager is exclusive — only one tier is on staff at a time, and
  // hiring a different one replaces him, locking the Office elevator floor
  // that matched his old tier until he's hired again (see openElevatorMenu).
  // Coach/Cutman are cumulative — once hired, a tier stays unlocked.
  const exclusive = role.id === "manager";
  return {
    title: `${role.icon} ${role.name}`,
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          receptionView = "staff";
          return "";
        },
      },
      ...[1, 2, 3].map((level) => {
        const current = getStaffLevel(role.id);
        const owned = exclusive ? current === level : current >= level;
        const price = level === 1 ? 0 : role.prices[level - 2];
        return {
          id: `${role.id}-lvl${level}`,
          label: `${role.name} Lvl ${level}`,
          cost: 0,
          costLabel: owned ? (exclusive ? "ACTIVE" : "HIRED") : `$${price}`,
          disabled: owned,
          run: () => {
            if (owned) return `${role.name} Lvl ${level} already ${exclusive ? "active" : "hired"}.`;
            if (playerState.money < price) {
              return `Not enough money — need $${price}, have $${playerState.money}.`;
            }
            playerState.money -= price;
            setStaffLevel(role.id, level);
            return exclusive
              ? `${role.name} Lvl ${level} is now on staff.`
              : `${role.name} promoted to Lvl ${level}!`;
          },
        };
      }),
    ],
  };
}

function buildGymMenu(): MenuData {
  return {
    title: "🏋️ Upgrade Gym",
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          receptionView = "main";
          return "";
        },
      },
      ...GYM_CATEGORIES.map((cat) => ({
        id: `cat-${cat.id}`,
        label: `${cat.icon} ${cat.name} (Lvl ${playerState.gymLevels[cat.id]}/3)`,
        cost: 0,
        costLabel: "›",
        run: () => {
          activeGymCategory = cat.id;
          receptionView = "gym-category";
          return "";
        },
      })),
    ],
  };
}

function buildGymCategoryMenu(catId: GymCategory["id"]): MenuData {
  const cat = GYM_CATEGORIES.find((c) => c.id === catId)!;
  return {
    title: `${cat.icon} ${cat.name}`,
    energyText: `Money: $${playerState.money}`,
    actions: [
      {
        id: "back",
        label: "‹ Back",
        cost: 0,
        costLabel: "",
        run: () => {
          receptionView = "gym";
          return "";
        },
      },
      ...[1, 2, 3].map((level) => {
        const current = playerState.gymLevels[cat.id];
        const owned = current >= level;
        const price = level === 1 ? 0 : cat.prices[level - 2];
        return {
          id: `${cat.id}-lvl${level}`,
          label: `${cat.name} Lvl ${level}`,
          cost: 0,
          costLabel: owned ? "OWNED" : `$${price}`,
          disabled: owned,
          run: () => {
            if (owned) return `${cat.name} Lvl ${level} already owned.`;
            if (playerState.money < price) {
              return `Not enough money — need $${price}, have $${playerState.money}.`;
            }
            playerState.money -= price;
            playerState.gymLevels[cat.id] = level;
            return `${cat.name} upgraded to Lvl ${level}!`;
          },
        };
      }),
    ],
  };
}

function openReceptionMenu() {
  receptionView = "main";
  locationMenu.open(buildReceptionMenu);
}

function openElevatorMenu(lot: LotInstance) {
  locationMenu.open(() => ({
    title: "🛗 Elevator",
    energyText: `Manager Level: ${playerState.managerLevel}/3`,
    actions: [1, 2, 3].map((floor) => {
      // Exclusive manager tier — the elevator only reaches whichever floor
      // matches the manager currently on staff (see buildStaffRoleMenu).
      const unlocked = playerState.managerLevel === floor;
      return {
        id: `floor-${floor}`,
        label: `Floor ${floor} — Manager's Office`,
        cost: 0,
        costLabel: unlocked ? "GO" : "LOCKED",
        disabled: !unlocked,
        run: () => {
          if (!unlocked) return `Hire the Lvl ${floor} manager at Reception first.`;
          locationMenu.close();
          scene = {
            type: "interior",
            lot,
            interior: new InteriorScene(lot, OFFICE_FLOOR_STATIONS[floor] ?? []),
            officeFloor: floor,
          };
          return "";
        },
      };
    }),
  }));
}

function sleepAtBed(anchor: { x: number; y: number }) {
  const leftover = energy.sleep();
  const hpGain = Math.floor(leftover / 2);
  playerState.hp += hpGain;
  buildingUI.showToast(
    `😴 Slept. +${hpGain} HP (now ${playerState.hp}). Energy refilled to 100/100.`,
    anchor,
    "bottom",
  );
}

/**
 * Perfect = +2, Good = +1, everything else = +0 — banked into the matching
 * training stat. Marks the stat as trained regardless of the bonus earned,
 * so a session that scored all misses still reads "+0", not "Not trained
 * yet" — that label is reserved for a stat with no completed session at all.
 */
function applyTraining(stat: keyof TrainingStats, results: string[]) {
  let bonus = 0;
  for (const r of results) {
    if (r === "perfect") bonus += 2;
    else if (r === "good") bonus += 1;
  }
  playerState.training[stat].bonus += bonus;
  playerState.training[stat].trained = true;
}

tapZone.onTap((x, y) => {
  if (scene.type === "reflexdots") scene.game.handleTap(x, y);
  else if (scene.type === "jumprope") scene.game.handleTap(window.innerHeight);
});

// Stations placed inside specific buildings' interiors — walk up to one
// and its prompt surfaces the same way the street's ENTER prompt does.
const STATIONS_BY_BUILDING: Record<string, Station[]> = {
  Trailer: [{ id: "bed", label: "Sleep", nx: 0.5, ny: 0.3 }],
  Gym: [
    { id: "heavybag", label: "Heavy Bag", nx: 0.25, ny: 0.3 },
    { id: "reflexdots", label: "Reflex Dots", nx: 0.5, ny: 0.3 },
    { id: "jumprope", label: "Jump Rope", nx: 0.75, ny: 0.3 },
    { id: "workoutclip", label: "Workout Clip", nx: 0.5, ny: 0.6 },
  ],
  Diner: [{ id: "order", label: "Order Menu", nx: 0.5, ny: 0.4 }],
  Office: [
    { id: "reception", label: "Reception", nx: 0.3, ny: 0.4 },
    { id: "elevator", label: "Elevator", nx: 0.7, ny: 0.4 },
  ],
  Beach: [
    { id: "sunbathe", label: "Sunbathe", nx: 0.35, ny: 0.4 },
    { id: "swim", label: "Swim", nx: 0.65, ny: 0.4 },
  ],
  "Press Building": [
    { id: "faceoff", label: "Face-Off Area", nx: 0.25, ny: 0.25 },
    { id: "fanevent", label: "Marketing Expert", nx: 0.75, ny: 0.25 },
    { id: "pressreception", label: "Press Reception", nx: 0.5, ny: 0.5 },
    { id: "photostudio", label: "Photo Studio", nx: 0.25, ny: 0.75 },
    { id: "pressconf", label: "Press Conference Room", nx: 0.75, ny: 0.75 },
  ],
};

type Scene =
  | { type: "street" }
  // officeFloor is set only while inside an Office elevator floor room —
  // its door returns to the Lobby instead of the street (see below).
  | { type: "interior"; lot: LotInstance; interior: InteriorScene; officeFloor?: number }
  | { type: "heavybag"; lot: LotInstance; interior: InteriorScene; game: HeavyBagScene }
  | { type: "reflexdots"; lot: LotInstance; interior: InteriorScene; game: ReflexDotsScene }
  | { type: "jumprope"; lot: LotInstance; interior: InteriorScene; game: JumpRopeScene };
let scene: Scene = { type: "street" };

function enterBuilding(lot: LotInstance, anchor: { x: number; y: number }) {
  if (lot.building.locked) {
    buildingUI.showToast(
      "LOCKED — you need to purchase this building first via the Real Estate App.",
      anchor,
      lot.row,
    );
    return; // stay on the street; no room, so no exit mechanic is needed
  }
  const stations = STATIONS_BY_BUILDING[lot.building.name] ?? [];
  scene = { type: "interior", lot, interior: new InteriorScene(lot, stations) };
  controls.root.style.display = "none";
  buildingUI.setEnterPrompt(null, () => {});
  joystick.setActive(true);
}

function exitBuilding() {
  scene = { type: "street" };
  controls.root.style.display = "flex";
  joystick.setActive(false);
}

const TRAINING_STATION_IDS = new Set(["heavybag", "reflexdots", "jumprope"]);

function startStation(lot: LotInstance, interior: InteriorScene, stationId: string, anchor: { x: number; y: number }) {
  // Each Training minigame costs the full 100 Energy Star (Section 4) —
  // only one per session, and it leaves nothing for Private Life actions
  // until you sleep, which is the mechanism that actually keeps training
  // and private-life days separated.
  if (TRAINING_STATION_IDS.has(stationId) && !energy.spend(100)) {
    buildingUI.showToast("Not enough energy left to train today — sleep to refill first.", anchor, "bottom");
    return;
  }

  joystick.setActive(false);
  buildingUI.setEnterPrompt(null, () => {});
  if (stationId === "heavybag") {
    scene = { type: "heavybag", lot, interior, game: new HeavyBagScene() };
  } else if (stationId === "reflexdots") {
    scene = { type: "reflexdots", lot, interior, game: new ReflexDotsScene() };
    tapZone.setActive(true);
  } else if (stationId === "jumprope") {
    scene = { type: "jumprope", lot, interior, game: new JumpRopeScene() };
    tapZone.setActive(true);
  }
}

function finishMinigame(lot: LotInstance, interior: InteriorScene) {
  scene = { type: "interior", lot, interior };
  actionButtons.hideAll();
  tapZone.setActive(false);
  buildingUI.setEnterPrompt(null, () => {});
  joystick.setActive(true);
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const outOfMinigame = scene.type === "street" || scene.type === "interior";
  statusHud.style.display = outOfMinigame ? "flex" : "none";
  moneyHud.style.display = outOfMinigame ? "block" : "none";
  if (outOfMinigame) {
    energyPill.textContent = `⚡ ${energy.remaining}/100`;
    hpPill.textContent = `❤ ${playerState.hp} HP`;
    moneyPill.textContent = `$${playerState.money}`;
  }

  // The Phone only works inside a building, not while driving, and stays
  // hidden while another location's action menu is already open.
  phoneBtn.style.display =
    scene.type === "interior" && !phoneUI.isOpen() && !locationMenu.isOpen() ? "flex" : "none";

  if (scene.type === "street") {
    street.update(dt);
    street.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = street.getCurrentFrameLabel();

    // Only the building on the player's current right-hand side is
    // enterable — reaching the other side means U-turning first.
    const [lot] = street.isStopped()
      ? nearbyLots(street.getWorldX()).filter((l) => l.row === rowForFacing(street.getFacing()))
      : [];

    if (lot) {
      const pos = street.getEntranceScreenPos(lot, window.innerWidth, window.innerHeight);
      buildingUI.setEnterPrompt(pos, () => enterBuilding(lot, pos));
    } else {
      buildingUI.setEnterPrompt(null, () => {});
    }
  } else if (scene.type === "interior") {
    const { lot, interior, officeFloor } = scene;
    const { atDoor, nearStation } = interior.update(dt, joystick.getVector(), window.innerWidth, window.innerHeight);
    interior.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = officeFloor ? `${lot.building.name} — Floor ${officeFloor}` : lot.building.name;

    if (atDoor) {
      if (officeFloor) {
        // Elevator floors exit back to the Lobby, not the street.
        scene = { type: "interior", lot, interior: new InteriorScene(lot, STATIONS_BY_BUILDING.Office) };
      } else {
        exitBuilding();
      }
    } else if (nearStation) {
      const pos = interior.getStationScreenPos(nearStation, window.innerWidth, window.innerHeight);
      let onTrigger: () => void;
      if (nearStation.id === "bed") onTrigger = () => sleepAtBed(pos);
      else if (nearStation.id === "workoutclip") onTrigger = openWorkoutClipMenu;
      else if (nearStation.id === "order") onTrigger = openDinerMenu;
      else if (nearStation.id === "pressreception") onTrigger = openPressReceptionMenu;
      else if (nearStation.id === "pressconf") onTrigger = () => comingSoon("Press Conference", pos);
      else if (nearStation.id === "photostudio") onTrigger = () => comingSoon("Photo Studio", pos);
      else if (nearStation.id === "faceoff") onTrigger = () => comingSoon("Face-Off", pos);
      else if (nearStation.id === "fanevent") onTrigger = () => comingSoon("Fan Event", pos);
      else if (nearStation.id === "managerdesk") onTrigger = () => openManagerDeskMenu(officeFloor ?? 1);
      else if (nearStation.id === "reception") onTrigger = openReceptionMenu;
      else if (nearStation.id === "elevator") onTrigger = () => openElevatorMenu(lot);
      else if (nearStation.id === "sunbathe") onTrigger = openSunbatheMenu;
      else if (nearStation.id === "swim") onTrigger = openSwimMenu;
      else onTrigger = () => startStation(lot, interior, nearStation.id, pos);
      buildingUI.setEnterPrompt(pos, onTrigger, nearStation.label.toUpperCase());
    } else {
      buildingUI.setEnterPrompt(null, () => {});
    }
  } else if (scene.type === "heavybag") {
    const { lot, interior, game } = scene;
    game.update(dt);
    game.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = "Heavy Bag";

    const phase = game.getPhase();
    if (phase === "ready") {
      actionButtons.showLeft("PUNCH", () => game.startCharge());
    } else if (phase === "charging") {
      actionButtons.showRight("RELEASE", () => game.release());
    } else {
      actionButtons.hideAll();
    }

    if (game.isDone()) {
      buildingUI.setEnterPrompt(
        { x: window.innerWidth / 2, y: window.innerHeight * 0.82 },
        () => {
          applyTraining("power", game.getResults());
          finishMinigame(lot, interior);
        },
        "DONE",
      );
    }
  } else if (scene.type === "reflexdots") {
    const { lot, interior, game } = scene;
    game.update(dt, window.innerWidth, window.innerHeight);
    game.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = "Reflex Dots";

    if (game.isDone()) {
      tapZone.setActive(false);
      buildingUI.setEnterPrompt(
        { x: window.innerWidth / 2, y: window.innerHeight * 0.82 },
        () => {
          applyTraining("speed", game.getResults());
          finishMinigame(lot, interior);
        },
        "DONE",
      );
    }
  } else {
    const { lot, interior, game } = scene;
    game.update(dt);
    game.render(ctx, window.innerWidth, window.innerHeight);
    hudLabel.textContent = "Jump Rope";

    if (game.isDone()) {
      tapZone.setActive(false);
      buildingUI.setEnterPrompt(
        { x: window.innerWidth / 2, y: window.innerHeight * 0.82 },
        () => {
          applyTraining("endurance", game.getResults());
          finishMinigame(lot, interior);
        },
        "DONE",
      );
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
