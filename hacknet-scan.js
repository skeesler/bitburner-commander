/**
 * hacknet-scan.js — read-only dashboard for the hacknet and the hash economy in BN9.
 *
 * The keeper companion to the throwaway hacknet-api.js probe. Four questions, in the order they
 * cost you money in "Hacktocracy":
 *
 *   1. Is the bank OVERFLOWING, and does it matter? Hashes above capacity are NOT destroyed —
 *      `processAllHacknetServerEarnings` takes the remainder `storeHashes` couldn't fit and calls
 *      `Player.gainMoney(upgrade.value * wasted / upgrade.cost, "hacknet")` [SRC: HacknetHelpers.tsx],
 *      i.e. auto-sells it at exactly the Sell-for-Money rate. So a full bank costs you nothing if
 *      selling was the plan anyway — it only costs you the DIFFERENCE against a better use of those
 *      hashes. This script reconstructs the overflow and prices that gap honestly.
 *   2. What is the fleet worth, in hashes and in dollars?
 *   3. What is script RAM costing you? Hash gain carries a `ramRatio = 1 - ramUsed/maxRam` term, so
 *      RAM in use is production switched off — and BN9 sets CloudServerLimit to 0, making hacknet
 *      servers the only compute you can buy.
 *   4. What's the best next dollar of hardware, and when does it pay for itself?
 *
 * It reads. It never buys a node, never upgrades anything, never spends a hash.
 *
 *   run hacknet-scan.js                     # everything
 *   run hacknet-scan.js --brief             # skip the per-node hardware table
 *   run hacknet-scan.js --top 5             # only the 5 best hardware upgrades (default 8)
 *   run hacknet-scan.js --hash-usd 250000   # override the dollars-per-hash conversion
 *
 * NO FORMULAS.EXE REQUIRED — deliberately. The gain formula is confirmed from the v3.0.1 release
 * tag [SRC: src/Hacknet/formulas/HacknetServers.ts]:
 *
 *     rate = 0.001*level * 1.07^log2(maxRam) * (1 + (cores-1)/5) * (1 - ramUsed/maxRam) * mult * BNmult
 *
 * so the script implements it locally and SOLVES the trailing `mult * BNmult` by dividing live
 * production by the un-multiplied rate. That is strictly better than calling ns.formulas: it costs
 * no RAM, needs no program, and folds in every multiplier — player, Source-File and BitNode — with
 * no chance of the table drifting out of sync with the game.
 *
 * It also self-checks. On a level-100/1GB/10-core starter server the solved multiplier came out at
 * 1.28128, which is exactly SF1.3's +28% to all multipliers and nothing else — independent proof
 * that BN9 does NOT set HacknetNodeMoney (it isn't in BN9's multiplier object; nodes 4/5/6/10/11
 * set it, 9 does not). If your solved figure drifts far from your SF bonus, something in this model
 * is wrong and the script says so rather than quietly reporting nonsense.
 *
 * THE NUMERAIRE. "Sell for Money" is a flat 4 hashes for $1,000,000 that never escalates — confirmed
 * live (hashCost n=5 returns exactly 20). $250,000 per hash, unlimited, forever. Everything else is
 * priced against it. The rate is derived live rather than hardcoded, so if it ever stops being flat
 * every number re-bases itself instead of lying.
 *
 * NODES vs SERVERS is detected from getNodeStats() field names, not assumed — the same field,
 * `production`, means dollars/sec on a node and hashes/sec on a server.
 */

const MIN = 60;
const HOUR = 3600;

// [SRC] HacknetServerConstants + HashUpgradesMetadata at v3.0.1.
const HASHES_PER_LEVEL = 0.001;
const RAM_MULT_BASE = 1.07;
const CORE_DIVISOR = 5;
const SELL_PAYOUT_USD = 1e6;

export async function main(ns) {
	const opts = ns.flags([["brief", false], ["top", 8], ["hash-usd", 0], ["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun hacknet-scan.js [--brief] [--top N] [--hash-usd X]\n" +
			"  --brief      skip the per-node hardware table\n" +
			"  --top N      how many hardware upgrades to rank (default 8)\n" +
			"  --hash-usd X override the dollars-per-hash conversion (default: derived live)\n" +
			"\nRead-only. Never buys, never spends a hash. Does NOT need Formulas.exe.\n");
		return;
	}

	const hn = ns.hacknet;
	const out = [];
	const p = (s) => out.push(s);

	const count = safeCall(() => hn.numNodes(), 0);
	if (!count) {
		ns.tprint("\n=== hacknet ===\nNo hacknet hardware owned.\n" +
			`Next one costs ${money(ns, safeCall(() => hn.getPurchaseNodeCost(), NaN))}.\n` +
			"In BN9 this is the only compute you can buy — CloudServerLimit is 0. Buy one and re-run.\n");
		return;
	}

	// ---- Nodes or servers? Read the field names; don't assume. ----
	const first = safeCall(() => hn.getNodeStats(0), null);
	const fields = first ? Object.keys(first) : [];
	const isServer = fields.includes("hashCapacity") || fields.includes("cache");
	const unit = isServer ? "hash" : "$";

	// ---- Fleet roll-up ----
	const fleet = [];
	let rate = 0, ramTotal = 0, ramBusy = 0, lifetime = 0;
	for (let i = 0; i < count; i++) {
		const s = safeCall(() => hn.getNodeStats(i), null);
		if (!s) continue;
		rate += s.production || 0;
		ramTotal += s.ram || 0;
		ramBusy += s.ramUsed || 0;
		lifetime += s.totalProduction || 0;
		fleet.push({ i, s, host: s.hostname ?? s.name ?? `#${i}` });
	}

	// ---- The exchange rate, derived live ----
	const upgNames = isServer ? (safeCall(() => hn.getHashUpgrades(), []) || []) : [];
	const shop = upgNames.map((name) => {
		const c1 = safeCall(() => hn.hashCost(name, 1), NaN);
		const c5 = safeCall(() => hn.hashCost(name, 5), NaN);
		return {
			name,
			cost: c1,
			lvl: safeCall(() => hn.getHashUpgradeLevel(name), 0),
			flat: Number.isFinite(c1) && Number.isFinite(c5) && c5 === c1 * 5,
		};
	});
	const sell = shop.find((u) => /sell/i.test(u.name) && /money/i.test(u.name) && !/corp/i.test(u.name));
	const usdPerHash = Number(opts["hash-usd"]) > 0
		? Number(opts["hash-usd"])
		: (sell && sell.cost > 0 ? SELL_PAYOUT_USD / sell.cost : 0);
	const cash = (hashes) => (usdPerHash > 0 ? money(ns, hashes * usdPerHash) : "?");

	p(`=== hacknet — ${isServer ? "SERVERS (hash economy live)" : "NODES (no hashes)"} ===`);
	p(`  hardware      ${count} of ${safeCall(() => hn.maxNumNodes(), "?")} owned` +
		`   |  next costs ${money(ns, safeCall(() => hn.getPurchaseNodeCost(), NaN))}`);
	p(`  production    ${num(ns, rate)} ${unit}/sec` +
		(isServer && usdPerHash > 0 ? `  =  ${cash(rate)}/sec  =  ${cash(rate * HOUR)}/hour` : ""));
	if (isServer) {
		p(`  exchange      ${sell ? `"${sell.name}" — ${num(ns, sell.cost)} hashes for ${money(ns, SELL_PAYOUT_USD)}` +
			`${sell.flat ? " (FLAT, never escalates)" : " (ESCALATING — see below)"}` : "no sell-for-money upgrade found"}` +
			(usdPerHash > 0 ? `  →  ${money(ns, usdPerHash)}/hash` : ""));
		if (sell && !sell.flat) {
			p(`  !  "Sell for Money" is escalating in this build, which contradicts the release tag.`);
			p(`     Every dollar figure below re-based itself off the live cost, but tell the assistant.`);
		}
	}

	// ---- The bank, and the leak. This section is why the script exists. ----
	if (isServer) {
		const held = safeCall(() => hn.numHashes(), 0);
		const cap = safeCall(() => hn.hashCapacity(), 0);
		const pct = cap > 0 ? (held / cap) * 100 : 0;
		const fillIn = rate > 0 && cap > held ? (cap - held) / rate : Infinity;

		// Reconstruct lifetime spend from each upgrade's level and its live cost curve, so that
		// "wasted" is produced - held - spent rather than a guess. [SRC] HashUpgrade.getCost: a flat
		// upgrade costs `cost` every time; an escalating one's n-th purchase costs costPerLevel * n,
		// so at level L the live single-step price is costPerLevel * (L+1) and the total paid to get
		// there is costPerLevel * L*(L+1)/2.
		let spent = 0;
		for (const u of shop) {
			if (!Number.isFinite(u.cost) || !u.lvl) continue;
			if (u.flat) spent += u.cost * u.lvl;
			else spent += (u.cost / (u.lvl + 1)) * (u.lvl * (u.lvl + 1)) / 2;
		}
		const overflow = Math.max(0, lifetime - held - spent);

		p(`  bank          ${num(ns, held)} / ${num(ns, cap)} hashes (${pct.toFixed(0)}% full)` +
			(Number.isFinite(fillIn) ? `  |  overflows in ${duration(fillIn)}` : ""));
		p(`  lifetime      produced ${num(ns, lifetime)}, spent ${num(ns, spent)}, holding ${num(ns, held)}`);
		if (overflow > 1) {
			p(`  auto-sold     ${num(ns, overflow)} hashes overflowed and were auto-sold for ${cash(overflow)}.`);
			p(`                (Overflow is NOT lost — the game converts it at the Sell-for-Money rate.`);
			p(`                 It shows up in money-sources.js under "hacknet".)`);
		}
		if (pct >= 99) {
			p(`  !  FULL. Everything you produce is being auto-sold at ${money(ns, usdPerHash)}/hash`);
			p(`     (${cash(rate * HOUR)}/hour). That is fine IF selling is what you wanted. It is a`);
			p(`     real cost only against a better sink — see the shop table for what beats the floor.`);
		} else if (Number.isFinite(fillIn) && fillIn < 10 * MIN) {
			p(`  !  fills in ${duration(fillIn)}, after which production auto-sells at the floor rate.`);
			p(`     Raise CACHE only if you're saving for something worth more than ${money(ns, usdPerHash)}/hash.`);
		}
	}

	// ---- Hardware table ----
	if (!opts.brief) {
		p(`\n--- hardware ---`);
		p(pad("#", 4) + pad("host", 20) + pad("lvl", 6) + pad("ram", 11) + pad("cores", 7) +
			(isServer ? pad("cache", 7) : "") + `${unit}/sec`);
		for (const { i, s, host } of fleet) {
			p(pad(String(i), 4) + pad(host, 20) + pad(String(s.level ?? "-"), 6) +
				pad(`${s.ramUsed ?? 0}/${s.ram ?? "-"}`, 11) + pad(String(s.cores ?? "-"), 7) +
				(isServer ? pad(String(s.cache ?? "-"), 7) : "") + num(ns, s.production || 0));
		}
		if (ramBusy > 0) p(`  (check who with: ps ${fleet[0].host})`);
	}

	// ---- Calibrate the model against live production ----
	const k = solveMult(fleet);

	// ---- The BN9 tradeoff, priced ----
	if (isServer) {
		p(`\n--- what your script RAM costs in hashes ---`);
		if (ramBusy <= 0) {
			p(`  Nothing is running on the hacknet. All ${ramTotal}GB is generating at full rate.`);
			p(`  Re-check after any commander.js restart — it roots and deploys to every host it can`);
			p(`  see, hacknet servers qualify, and nothing in its log would ever mention it.`);
		} else if (k === null) {
			p(`  ${ramBusy}GB of ${ramTotal}GB is in use, suppressing gain (rate scales with FREE ram).`);
			p(`  Couldn't calibrate the model to price it exactly.`);
		} else {
			let lost = 0;
			const rows = [];
			for (const { s, host } of fleet) {
				if (!(s.ramUsed > 0)) continue;
				const full = k * unmultipliedRate(s.level, 0, s.ram, s.cores);
				const delta = full - (s.production || 0);
				if (delta > 0) { rows.push({ host, s, delta }); lost += delta; }
			}
			p(`  ${ramBusy}GB of ${ramTotal}GB in use, costing ${num(ns, lost)} ${unit}/sec — ${cash(lost * HOUR)}/hour.`);
			p("");
			p(pad("host", 20) + pad("ram used", 12) + pad(`${unit}/sec lost`, 14) + "$/hour lost");
			for (const r of rows) {
				p(pad(r.host, 20) + pad(`${r.s.ramUsed}/${r.s.ram}`, 12) + pad(num(ns, r.delta), 14) + cash(r.delta * HOUR));
			}
			p(`\n  BN9 sets ScriptHackMoney 0.1 and ServerMaxMoney 0.01 — hacking earns ~0.1% of normal.`);
			p(`  Compare that against the figure above before assuming the RAM is well spent.`);
		}
	}

	// ---- The shop ----
	if (isServer) {
		const held = safeCall(() => hn.numHashes(), 0);
		const cap = safeCall(() => hn.hashCapacity(), 0);
		p(`\n--- what hashes can buy (${shop.length} upgrades) ---`);
		p(pad("upgrade", 34) + pad("lvl", 5) + pad("cost", 10) + pad("worth", 12) + pad("afford?", 9) + "wait");
		const sorted = [...shop].sort((a, b) => (a.cost || Infinity) - (b.cost || Infinity));
		for (const u of sorted) {
			const wait = rate > 0 && u.cost > held ? (u.cost - held) / rate : 0;
			p(pad(u.name, 34) + pad(String(u.lvl), 5) + pad(num(ns, u.cost), 10) +
				pad(worthOf(ns, u, usdPerHash), 12) +
				pad(u.cost <= held ? "YES" : "-", 9) + (wait > 0 ? duration(wait) : "now"));
		}
		p(`  ("worth" is the direct cash value where one exists. The rest buy things money can't.)`);

		// The corporation-funds crossover. [SRC] 100n hashes for $1e9, so $1e7/n per hash — it beats
		// the flat money rate until n = 40, then never again.
		const corpSell = shop.find((u) => /sell/i.test(u.name) && /corp/i.test(u.name));
		if (corpSell && usdPerHash > 0 && corpSell.cost > 0) {
			const perHash = 1e9 / corpSell.cost;
			p(`\n  "${corpSell.name}" is worth ${money(ns, perHash)}/hash right now — ` +
				`${(perHash / usdPerHash).toFixed(1)}x the money floor.`);
			p(`  It escalates; it stops winning once its price passes ${num(ns, 1e9 / usdPerHash)} hashes.`);
			p(`  Needs a corporation to exist first — outside BN3 that's $150b of your own money.`);
		}

		const unreachable = sorted.filter((u) => Number.isFinite(u.cost) && u.cost > cap);
		if (unreachable.length) {
			p(`\n  !! ${unreachable.length} upgrade(s) cost more than your ${num(ns, cap)}-hash capacity, so they`);
			p(`     are unreachable at any rate — the bank stops filling before you get there:`);
			p(`     ${unreachable.map((u) => u.name).join(", ")}`);
			p(`     Raise CACHE to fix it — it raises the ceiling, never the rate. This is the ONLY`);
			p(`     reason cache is worth buying: without it those sinks are unreachable and every`);
			p(`     hash you make gets auto-sold at the floor instead.`);
		}
	}

	// ---- What to buy next, ranked ----
	p(`\n--- best next hardware purchase ---`);
	if (k === null) {
		p(`  Couldn't calibrate the gain model (no node reported both a level and a production rate).`);
	} else {
		p(`  Solved multiplier (yours x Source-Files x BitNode): ${k.toFixed(5)}`);
		p(`  ${k > 0.5
			? "Consistent with no BitNode hacknet penalty — BN9 does not set HacknetNodeMoney."
			: "!! Well below 1. Something IS penalising hacknet gain here; tell the assistant."}`);
		const ranked = rankUpgrades(ns, hn, fleet, count, k, isServer);
		if (!ranked.length) {
			p(`  Nothing rankable — possibly all maxed ([SRC] caps: level 300, ram 8192, cores 128).`);
		} else {
			p("");
			p(pad("what", 28) + pad("cost", 13) + pad(`+${unit}/sec`, 12) + pad(`$ per ${unit}/sec`, 16) + "pays back in");
			for (const c of ranked.slice(0, Number(opts.top) || 8)) {
				const payback = usdPerHash > 0 && c.gain > 0 ? c.cost / (c.gain * usdPerHash) : Infinity;
				p(pad(c.what, 28) + pad(money(ns, c.cost), 13) + pad(num(ns, c.gain), 12) +
					pad(money(ns, c.costPerGain), 16) + duration(payback));
			}
			p(`\n  "Pays back in" assumes every hash is sold for money at ${money(ns, usdPerHash)}. That's the`);
			p(`  conservative floor — anything you'd rather buy with those hashes beats it.`);
		}
	}

	ns.tprint("\n" + out.join("\n") + "\n");
}

/**
 * The v3.0.1 gain formula with the trailing multipliers left off [SRC: formulas/HacknetServers.ts]:
 *
 *   baseGain      = HashesPerLevel * level
 *   ramMultiplier = 1.07 ^ log2(maxRam)
 *   coreMultiplier= 1 + (cores - 1) / 5
 *   ramRatio      = 1 - ramUsed / maxRam
 *
 * Everything the game applies afterwards (player mults, Source-Files, BitNode) is the single scalar
 * that solveMult() recovers from live data.
 */
function unmultipliedRate(level, ramUsed, maxRam, cores) {
	if (!(maxRam > 0)) return 0;
	return HASHES_PER_LEVEL * level
		* Math.pow(RAM_MULT_BASE, Math.log2(maxRam))
		* (1 + (cores - 1) / CORE_DIVISOR)
		* (1 - ramUsed / maxRam);
}

/**
 * Recover `mult * BNmult` by dividing live production by the un-multiplied rate.
 *
 * Beats ns.getPlayer().mults on every axis: no RAM, no Formulas.exe, no guess at a field name, and
 * it captures BitNode effects the player object never mentions. Averaged across the fleet so one
 * odd machine can't skew it.
 */
function solveMult(fleet) {
	const ks = [];
	for (const { s } of fleet) {
		const base = unmultipliedRate(s.level, s.ramUsed || 0, s.ram, s.cores);
		if (base > 0 && s.production > 0) ks.push(s.production / base);
	}
	if (!ks.length) return null;
	return ks.reduce((a, b) => a + b, 0) / ks.length;
}

/** Rank every single-step hardware purchase by cost per extra unit of production. */
function rankUpgrades(ns, hn, fleet, count, k, isServer) {
	const cand = [];
	const add = (what, cost, gain) => {
		if (!(cost > 0) || !(gain > 0)) return;
		cand.push({ what, cost, gain, costPerGain: cost / gain });
	};

	for (const { i, s } of fleet) {
		const used = s.ramUsed || 0;
		const now = k * unmultipliedRate(s.level, used, s.ram, s.cores);
		add(`#${i} level ${s.level}→${s.level + 1}`,
			safeCall(() => hn.getLevelUpgradeCost(i, 1), NaN),
			k * unmultipliedRate(s.level + 1, used, s.ram, s.cores) - now);
		add(`#${i} ram ${s.ram}→${s.ram * 2}GB`,
			safeCall(() => hn.getRamUpgradeCost(i, 1), NaN),
			k * unmultipliedRate(s.level, used, s.ram * 2, s.cores) - now);
		add(`#${i} cores ${s.cores}→${s.cores + 1}`,
			safeCall(() => hn.getCoreUpgradeCost(i, 1), NaN),
			k * unmultipliedRate(s.level, used, s.ram, s.cores + 1) - now);
	}
	// A brand-new machine competes on the same axis, at the starting stats a fresh one gets.
	// [SRC] PurchaseMult 3.2 — each server costs 3.2x the last, so this loses quickly.
	add(`new ${isServer ? "server" : "node"} (#${count})`,
		safeCall(() => hn.getPurchaseNodeCost(), NaN),
		k * unmultipliedRate(1, 0, 1, 1));

	cand.sort((a, b) => a.costPerGain - b.costPerGain);
	return cand;
}

/** Direct cash value of one purchase, where the upgrade has one. */
function worthOf(ns, u, usdPerHash) {
	if (/sell/i.test(u.name) && /corp/i.test(u.name)) return money(ns, 1e9);
	if (/sell/i.test(u.name) && /money/i.test(u.name)) return money(ns, 1e6);
	return usdPerHash > 0 ? `(${money(ns, u.cost * usdPerHash)})` : "-";
}

/** Call something that may throw or may not exist; hand back a fallback instead of dying. */
function safeCall(fn, fallback) {
	try {
		const v = fn();
		return v === undefined ? fallback : v;
	} catch (e) { return fallback; }
}

/** ns.format.number is the v3 name; ns.formatNumber is a 3.0.0 TOMBSTONE that throws when called. */
function num(ns, v) {
	if (!Number.isFinite(v)) return String(v);
	try { return ns.format.number(v, 2); } catch (e) { return v.toFixed(2); }
}

function money(ns, v) {
	if (!Number.isFinite(v)) return String(v);
	return "$" + num(ns, v);
}

function duration(s) {
	if (!Number.isFinite(s)) return "never";
	if (s < MIN) return `${Math.ceil(s)}s`;
	if (s < HOUR) return `${(s / MIN).toFixed(1)}m`;
	if (s < 24 * HOUR) return `${(s / HOUR).toFixed(1)}h`;
	return `${(s / (24 * HOUR)).toFixed(1)}d`;
}

function pad(s, n) {
	s = String(s);
	return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length);
}
