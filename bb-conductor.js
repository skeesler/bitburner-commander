/**
 * bb-conductor.js v2 — the Bladeburner division on autopilot: stamina, contracts, ops, skills,
 * faction, city choice, and the black-op ladder. One self-managing entry point.
 *
 *   run bb-conductor.js                    # grind toward rank 400k; HOLDS before Daedalus
 *   run bb-conductor.js --daedalus         # allowed to run Operation Daedalus (DESTROYS BN6!)
 *   run bb-conductor.js --min-blackop 0.9  # attempt black ops at >=90% est-LOW (default 0.95)
 *
 * v2 (2026-09-20, from the first field harvest — bn6-design.md §5d):
 *   - FIXED: v1 sat at rank 44k without ever attempting a black op. The est interval is NOT
 *     tight for black ops — getSuccessRange applies the popEst error ratio to every action
 *     type [SRC v3.0.1: Action.ts:144-167] even though the ROLL ignores pop/chaos, so the
 *     REAL chance is one endpoint of [lo, hi]. When the interval spans --min-blackop, v2 runs
 *     Field Analysis: popEst converges on pop (~2.6%/completion at current stats), the
 *     interval collapses onto the truth, and the gate resolves itself either way.
 *   - NEW: city rotation. Kill-ops graze the city you stand in (Sector-12 popEst 1.72b ->
 *     675m in three v1 days); success scales with (popEst/1e9)^0.7. Every 5 min, move to a
 *     >=10%-better city (score = pop factor / chaos penalty), on a fresh cycle only.
 *   - SKILLS: Short-Circuit added and Cloak uncapped — the rank engines (Stealth Retirement,
 *     Assassination, Raid) are all stealth and/or kill ops.
 *
 * POLICY (the numbers behind each rule are in bn6-design.md):
 *   - STAMINA is a cliff, not a slope: penalty = min(1, stamina/(0.5·max)) [SRC], so nothing
 *     is gained above half and everything collapses below. Hysteresis: rest (Hyperbolic
 *     Regeneration Chamber) under 55%, back to work above 90%. HP rides the same guard —
 *     day-one HP is 28 and a failed Raid deals ~50 [LIVE snapshot]: rest under 50% HP, and
 *     skip any action whose [SRC] failure hpLoss x3 exceeds current HP.
 *   - WORK = best expected rank/min: mid-estimate x rankGain − (1−mid) x rankLoss, over time.
 *     Ops need mid >= 40% before they're candidates (day one they're all single digits — the
 *     conductor naturally graduates from contracts to ops as stats and skills grow).
 *   - FIELD ANALYSIS when the best candidate's estimate interval is wider than 20 points,
 *     back to work under 10 (popEst noise is what makes the displayed chance a lie).
 *   - SWITCHING waits for a fresh action cycle (<2s elapsed) so no partial progress is thrown
 *     away — except rest, and black ops, which preempt immediately.
 *   - SKILLS auto-buy every 30s, cheapest-first from a capped plan (Overclock to its max 90;
 *     Intuition/Observer uncapped; utility skills shallow). BladeburnerSkillCost is 1.0 here.
 *   - FACTION auto-join at rank 25 [SRC] — rep then accrues at 2x rank gain while working.
 *   - BLACK OPS: attempt the next rung when rank qualifies AND est-LOW >= --min-blackop.
 *     When [lo, hi] spans the bar instead, Field Analysis until it collapses (the truth is an
 *     endpoint — see v2 note above); a tight interval below the bar falls through to the
 *     grind. Failure is reported and retried when the estimate clears again. **Operation
 *     Daedalus is held behind --daedalus** — it ends the BitNode; that trigger is Sara's.
 *   - CITY: score = (popEst/1e9)^0.7 / sqrt(1+chaos-50 when chaos>50) [SRC]. Move on a >=10%
 *     edge, checked every 5 min, only on a fresh cycle (black ops don't care about city;
 *     contracts and ops very much do).
 *
 * STILL NOT DOING (v2 — by the numbers this time, bn6-design.md §5d): Training (staminaBonus
 * +0.04/completion [SRC] but regen alone has held 100% stamina for days [LIVE]), Recruitment/
 * teams (bonus is (team+1)^0.05 [SRC] — +11% for 8 recruits, and black ops kill >=1 per
 * SUCCESS; teamless stays right while chances sit >=92%), Diplomacy (chaos <=13 everywhere
 * after three days of kill ops; the difficulty penalty starts at 50), Incite Violence
 * (action counts sit at 800-1600).
 *
 * FIGHTS FOR THE PLAYER ACTION [SETTLED 2026-09-20 — bn6-design.md §7.5]: bladeburner work
 * owns "you", like a class. Run ascend with --no-work alongside. The Blade's Simulacrum aug
 * ($150b) dissolves this permanently; startup still warns if int-farm.js / ascend.js are up.
 *
 * RAM (~81.3 GB expected — measure with ram-costs.js; home is 512 GB): base 1.6 + ps 0.2 +
 * getPlayer 0.5 + getCurrentAction 1 + getNextBlackOp 2 + 19 four-GB functions (getStamina,
 * getActionCurrentTime, startAction, getActionEstimatedSuccessChance, getActionTime,
 * getActionRankGain, getActionRankLoss, getActionCountRemaining, getRank, getSkillPoints,
 * getSkillLevel, getSkillUpgradeCost, upgradeSkill, setActionAutolevel, joinBladeburnerFaction,
 * getCity, switchCity, getCityEstimatedPopulation, getCityChaos) = 76. nextUpdate + all name
 * lists are free [LIVE].
 */

const REST_BELOW = 0.55, WORK_ABOVE = 0.90, HP_REST_BELOW = 0.50, HP_WORK_ABOVE = 0.80;
const FA_ENTER = 0.20, FA_EXIT = 0.10;   // est-interval width, absolute
const OP_MIN_MID = 0.40;                 // ops join the candidate pool at this mid-estimate
const SWITCH_FRESH_MS = 2e3;             // don't discard a cycle in progress
const SKILL_EVERY_MS = 30e3, REPORT_EVERY_MS = 60e3;
const BLACKOP_TIGHT = 0.01;              // interval narrower than this = converged, trust est-low
const CITY_EVERY_MS = 300e3, CITY_EDGE = 1.10; // re-score cities every 5 min, move on a 10% edge
const REGEN = "Hyperbolic Regeneration Chamber", FIELD_ANALYSIS = "Field Analysis";
const DAEDALUS = "Operation Daedalus";

// [SRC: data/Contracts.ts, Operations.ts] failure HP loss (scaled up by difficulty in-game).
// Used only for the HP guard; absent name = 0.
const HP_LOSS = {
	"Tracking": 0.5, "Bounty Hunter": 1, "Retirement": 1,
	"Investigation": 0, "Undercover Operation": 2, "Sting Operation": 2.5,
	"Raid": 50, "Stealth Retirement Operation": 10, "Assassination": 5,
};

// Auto-buy plan: [skill, level cap]. Cheapest eligible first, so early SP spreads sensibly.
// Overclock's cap is the game's own max [SRC]; the shallow caps are "useful, not a sink".
// v2: Short-Circuit in, Cloak uncapped — the rank engines (Stealth Retirement 228 rank/min,
// Raid 186, Assassination 85 [LIVE 2026-09-20]) are all stealth and/or kill ops.
const SKILL_PLAN = [
	["Overclock", 90], ["Blade's Intuition", Infinity], ["Digital Observer", Infinity],
	["Short-Circuit", Infinity], ["Cloak", Infinity],
	["Tracer", 40], ["Reaper", Infinity], ["Evasive System", Infinity],
	["Hyperdrive", 30], ["Cyber's Edge", 15], ["Datamancer", 8], ["Hands of Midas", 10],
];

export async function main(ns) {
	ns.disableLog("ALL");
	const opts = ns.flags([["daedalus", false], ["min-blackop", 0.95], ["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun bb-conductor.js [--daedalus] [--min-blackop 0.95]\n\n  Runs the Bladeburner division: " +
			"rests the stamina cliff, grinds best rank/min, buys skills,\n  joins the faction at rank 25, climbs " +
			"the black-op ladder. HOLDS before Operation Daedalus\n  unless --daedalus (it DESTROYS the BitNode). " +
			"Watch with: tail bb-conductor.js\n");
		return;
	}
	const bb = ns.bladeburner;
	const types = ns.enums.BladeburnerActionType;
	if (!bb.inBladeburner()) {
		ns.tprint("bb-conductor: not in the division — join at the NSA (combat 100s) and re-run.");
		return;
	}
	const busy = ns.ps("home").map((pr) => pr.filename).filter((f) => /int-farm|ascend/.test(f));
	if (busy.length) {
		ns.tprint(`bb-conductor: heads up — ${busy.join(", ")} running. Bladeburner work likely owns the ` +
			`player action like a class does [OPEN]; expect a fight for the slot.`);
	}

	for (const cn of bb.getContractNames()) bb.setActionAutolevel(types.Contract, cn, true);
	for (const on of bb.getOperationNames()) bb.setActionAutolevel(types.Operation, on, true);

	const t0 = Date.now(), rank0 = bb.getRank();
	// General actions have no cycle worth protecting — and the Regen Chamber's elapsed timer
	// never re-enters a <2s "fresh" window at all [LIVE 2026-09-17: conductor sat at 100%
	// stamina in the chamber for 5+ min waiting for one]. Freshness only guards contracts/ops.
	const generalNames = new Set(bb.getGeneralActionNames());
	let resting = false, analyzing = false, joined = false, heldDaedalus = false;
	let lastSkill = 0, lastReport = 0, startedBlackOp = null, deferredTicks = 0;
	let lastCity = 0, pendingCity = null;
	ns.tprint(`bb-conductor: up. rank ${ns.format.number(rank0)}, next black op ` +
		`${bb.getNextBlackOp()?.name ?? "(none)"}. Daedalus ${opts.daedalus ? "ARMED" : "held"}. ` +
		`Watch with: tail bb-conductor.js`);

	for (;;) {
		await bb.nextUpdate();
		const now = Date.now();

		if (now - lastSkill >= SKILL_EVERY_MS) { lastSkill = now; spendSkills(ns, bb); }

		// -- guards: the stamina cliff and the HP floor, with hysteresis --
		const [stam, stamMax] = bb.getStamina();
		const hp = ns.getPlayer().hp;
		if (resting) {
			if (stam / stamMax >= WORK_ABOVE && hp.current / hp.max >= HP_WORK_ABOVE) resting = false;
		} else if (stam / stamMax < REST_BELOW || hp.current / hp.max < HP_REST_BELOW) {
			resting = true;
		}

		const rank = bb.getRank();
		if (!joined && rank >= 25) {
			joined = bb.joinBladeburnerFaction();
			if (joined) ns.tprint("bb-conductor: rank 25 — joined the Bladeburners faction. Rep accrues at 2x rank gain from here.");
		}

		// -- resolve a black op we started that is no longer running --
		const current = bb.getCurrentAction();
		if (startedBlackOp && current?.name !== startedBlackOp) {
			const after = bb.getNextBlackOp();
			if (!after) ns.tprint(`bb-conductor: ${startedBlackOp} SUCCEEDED — THE LADDER IS COMPLETE.`);
			else if (after.name !== startedBlackOp) ns.tprint(`bb-conductor: ${startedBlackOp} SUCCEEDED. ` +
				`Next rung: ${after.name} at rank ${ns.format.number(after.rank)}.`);
			else ns.tprint(`bb-conductor: ${startedBlackOp} FAILED — rank now ${ns.format.number(rank)}. ` +
				`Retrying when est-low clears ${opts["min-blackop"]}.`);
			startedBlackOp = null;
		}

		// -- city: stand where the people are (kill-ops graze the current city down [LIVE]) --
		if (now - lastCity >= CITY_EVERY_MS) {
			lastCity = now;
			const here = bb.getCity();
			let moveCity = null, edge = CITY_EDGE;
			for (const c of Object.values(ns.enums.CityName)) {
				if (c === here) continue;
				const gain = cityScore(bb, c) / cityScore(bb, here);
				if (gain > edge) { moveCity = c; edge = gain; }
			}
			pendingCity = moveCity; // null also clears a stale wish the world has moved past
		}
		if (pendingCity) {
			// wait for a fresh cycle, same as an action switch — [OPEN §7.6] whether switchCity
			// cancels work in progress; this guard makes it moot
			let ok = !current || generalNames.has(current.name);
			if (!ok) { try { ok = bb.getActionCurrentTime() < SWITCH_FRESH_MS; } catch (e) { ok = true; } }
			if (ok && bb.switchCity(pendingCity)) {
				ns.tprint(`bb-conductor: moved to ${pendingCity} — popEst ` +
					`${ns.format.number(bb.getCityEstimatedPopulation(pendingCity))}.`);
				pendingCity = null;
			}
		}

		// -- choose what we WANT to be doing --
		let want = null, wantForce = false, best = null;
		if (resting) {
			want = { type: types.General, name: REGEN };
			wantForce = true;
		} else {
			// Black op first: qualified and confident? The REAL chance is one endpoint of
			// [lo, hi] (getSuccessRange applies popEst error to black ops too, though the roll
			// ignores pop [SRC v3.0.1] — the v1 bug). So: attempt on est-low; when the interval
			// merely SPANS the bar, Field Analysis collapses it onto the truth in a few cycles,
			// and a tight interval still under the bar falls through to the grind.
			const nxt = bb.getNextBlackOp();
			if (nxt && rank >= nxt.rank) {
				const [bLo, bHi] = bb.getActionEstimatedSuccessChance(types.BlackOp, nxt.name);
				if (bHi >= opts["min-blackop"] && nxt.name === DAEDALUS && !opts.daedalus) {
					if (!heldDaedalus) {
						heldDaedalus = true;
						ns.tprint(`bb-conductor: ${DAEDALUS} is READY (est ${(bLo * 100).toFixed(1)}-` +
							`${(bHi * 100).toFixed(1)}%) — HOLDING. Re-run with --daedalus to end BN6 on your say-so.`);
					}
				} else if (bLo >= opts["min-blackop"]) {
					want = { type: types.BlackOp, name: nxt.name };
					wantForce = true;
				} else if (bHi >= opts["min-blackop"] && bHi - bLo > BLACKOP_TIGHT) {
					want = { type: types.General, name: FIELD_ANALYSIS };
				}
			}
			// Otherwise: best expected rank/min among contracts and (viable) operations.
			if (!want) {
				const cands = [];
				for (const [tp, list, isOp] of [[types.Contract, bb.getContractNames(), false],
					[types.Operation, bb.getOperationNames(), true]]) {
					for (const an of list) {
						if (bb.getActionCountRemaining(tp, an) < 1) continue;
						if ((HP_LOSS[an] ?? 0) * 3 > hp.current) continue;
						const [lo, hi] = bb.getActionEstimatedSuccessChance(tp, an);
						const mid = (lo + hi) / 2;
						if (isOp && mid < OP_MIN_MID) continue;
						const minutes = bb.getActionTime(tp, an) / 60e3;
						const ev = (mid * bb.getActionRankGain(tp, an) - (1 - mid) * bb.getActionRankLoss(tp, an)) / minutes;
						cands.push({ type: tp, name: an, ev, lo, hi });
					}
				}
				cands.sort((a, b) => b.ev - a.ev);
				best = cands[0];
				const width = best ? best.hi - best.lo : 1;
				if (!analyzing && width > FA_ENTER) analyzing = true;
				else if (analyzing && width < FA_EXIT) analyzing = false;
				want = analyzing || !best
					? { type: types.General, name: FIELD_ANALYSIS }
					: { type: best.type, name: best.name };
			}
		}

		// -- act, without discarding a contract/op cycle in progress --
		if (current?.name !== want.name) {
			let fresh = true;
			if (current && !generalNames.has(current.name)) {
				try { fresh = bb.getActionCurrentTime() < SWITCH_FRESH_MS; } catch (e) { fresh = true; }
			}
			// Stuck-breaker: bonus time can process 5 game-seconds per tick and hop clean over
			// the fresh window — never wait politely for more than 30 ticks.
			if (!wantForce && !fresh && ++deferredTicks >= 30) fresh = true;
			if (wantForce || fresh) {
				deferredTicks = 0;
				if (bb.startAction(want.type, want.name)) {
					if (want.type === types.BlackOp) {
						startedBlackOp = want.name;
						ns.tprint(`bb-conductor: attempting ${want.name} (rank ${ns.format.number(rank)}).`);
					}
				} else {
					ns.print(`startAction(${want.type}, ${want.name}) returned false — will re-evaluate next tick`);
				}
			}
		} else {
			deferredTicks = 0;
		}

		if (now - lastReport >= REPORT_EVERY_MS) {
			lastReport = now;
			const hours = (now - t0) / 3600e3;
			ns.print(`rank ${ns.format.number(rank)} (+${ns.format.number((rank - rank0) / hours)}/hr) | ` +
				`SP ${bb.getSkillPoints()} | stamina ${((stam / stamMax) * 100).toFixed(0)}%${resting ? " RESTING" : ""} | ` +
				`hp ${hp.current}/${hp.max} | ${bb.getCity()} | doing: ${bb.getCurrentAction()?.name ?? "idle"}` +
				(best ? ` | best ${best.name} ${(best.lo * 100).toFixed(0)}-${(best.hi * 100).toFixed(0)}%` : "") +
				(analyzing ? " | ANALYZING" : ""));
		}
	}
}

/** How good is it to WORK in this city: pop factor over the chaos difficulty penalty [SRC]. */
function cityScore(bb, city) {
	const chaos = bb.getCityChaos(city);
	const pen = chaos > 50 ? Math.sqrt(1 + chaos - 50) : 1;
	return Math.pow(bb.getCityEstimatedPopulation(city) / 1e9, 0.7) / pen;
}

/** Buy the cheapest eligible skill from the plan, repeatedly, until SP runs dry. */
function spendSkills(ns, bb) {
	for (;;) {
		const points = bb.getSkillPoints();
		let pick = null;
		for (const [sk, cap] of SKILL_PLAN) {
			if (bb.getSkillLevel(sk) >= cap) continue;
			const cost = bb.getSkillUpgradeCost(sk, 1);
			if (cost <= points && (!pick || cost < pick.cost)) pick = { sk, cost };
		}
		if (!pick) return;
		if (!bb.upgradeSkill(pick.sk, 1)) return;
		ns.print(`skill: ${pick.sk} -> ${bb.getSkillLevel(pick.sk)} (${pick.cost} SP)`);
	}
}
