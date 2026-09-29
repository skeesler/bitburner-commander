/**
 * world-tour.js — visit every other city, wait for its faction invitation, come home to Sector-12.
 *
 *   run world-tour.js         # narrate the itinerary + total cost, do nothing
 *   run world-tour.js --go    # fly, lingering in each city until its faction invites you
 *   run world-tour.js --go --fast   # original behavior: just fly, no waiting (pure tourism)
 *
 * WHY THE LINGERING [LIVE 2026-09-16]: city-faction invitations are granted by a periodic
 * engine check (~every 20s [OPEN: counter believed 100 cycles x 200ms — the 45s timeout
 * covers two windows either way]), and only if you're IN the city when it fires. The first
 * version of this script hopped every 200ms and collected exactly one invite — whichever
 * city the check happened to land on. So now each stop polls checkFactionInvitations()
 * until the invite shows up (or 45s passes), then flies on. Cities whose faction already
 * invited you — or that you've already joined — are skipped entirely, $200k saved.
 *
 * Each hop is a flat $200k [SRC: CONSTANTS.TravelCost] and pays +0.00003 int XP
 * [LIVE 2026-09-08, int-delta.js]. City factions are named exactly after their cities,
 * so the faction check is just a string match on the city name.
 *
 * IF A CITY TIMES OUT, the usual reasons: not enough money ON HAND at check time (see the
 * hint table below), or you've already JOINED an enemy city faction — Sector-12/Aevum and
 * the four eastern cities block each other's invites once you join a side. Merely holding
 * an un-accepted invitation blocks nothing.
 *
 * Traveling doesn't own your player action, so this runs safely alongside int-farm.js.
 *
 * RAM (~4.6 GB expected): base 1.6 + singularity.travelToCity 2 + getPlayer 0.5 +
 * singularity.checkFactionInvitations ~0.5. Measure with ram-costs.js anyway (bare-name trap).
 */

const HOME_CITY = "Sector-12";
const COST_PER_HOP = 200e3; // [SRC: CONSTANTS.TravelCost]
const INVITE_WAIT_MS = 45e3; // two engine check windows, padded
const POLL_MS = 1000;

// Money-on-hand each city faction wants before it will invite you. Used for HINTS only,
// never logic. [OPEN — v2.x FactionInfo values, not yet verified against 3.0.1 source]
const WANTS = { "Sector-12": 15e6, "Aevum": 40e6, "Chongqing": 20e6,
	"New Tokyo": 20e6, "Ishima": 30e6, "Volhaven": 50e6 };

export async function main(ns) {
	ns.disableLog("ALL");
	const opts = ns.flags([["go", false], ["fast", false], ["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun world-tour.js [--go] [--fast]\n\n  Travels to every other city, waits in each " +
			"until its faction invitation arrives (up to 45s),\n  then returns to " + HOME_CITY +
			". $200k per hop. --fast skips the waiting (pure tourism).\n  Without --go it only " +
			"prints the itinerary. Doesn't own your player action.\n");
		return;
	}

	const start = ns.getPlayer().city;
	// Factions already joined + invitations already pending: nothing to collect there.
	const settled = new Set([...ns.getPlayer().factions, ...ns.singularity.checkFactionInvitations()]);

	// Every city you're not standing in, minus ones already settled (unless --fast tourism,
	// where the point is the trip itself). Home is always the final stop.
	const others = Object.values(ns.enums.CityName)
		.filter((c) => c !== HOME_CITY && c !== start)
		.filter((c) => opts.fast || !settled.has(c));
	const stops = [...others, HOME_CITY];

	const cost = stops.length * COST_PER_HOP;
	const money = ns.getPlayer().money;
	const skipped = Object.values(ns.enums.CityName).filter((c) => settled.has(c));
	if (skipped.length && !opts.fast) ns.tprint(`world-tour: already invited/joined: ${skipped.join(", ")} — skipping.`);
	ns.tprint(`world-tour: ${start} -> ${stops.join(" -> ")} (${stops.length} hops, ` +
		`$${ns.format.number(cost)}${opts.fast ? ", --fast: no lingering" : ", lingering for invites"})`);
	if (!opts.go) {
		ns.tprint("world-tour: dry run — add --go to fly.");
		return;
	}
	if (money < cost) {
		ns.tprint(`world-tour: need $${ns.format.number(cost)}, have $${ns.format.number(money)} — staying home.`);
		return;
	}

	const collected = [], missed = [];
	for (const city of stops) {
		if (!ns.singularity.travelToCity(city)) {
			// The only documented failure is money, and we checked — so if this fires, something
			// else drained the wallet mid-tour (a corp buy? ascend.js?). Say where we stranded.
			ns.tprint(`world-tour: travelToCity("${city}") returned false — out of money mid-tour? ` +
				`You're in ${ns.getPlayer().city}. Re-run when the wallet recovers.`);
			return;
		}
		if (opts.fast || settled.has(city)) {
			ns.tprint(`world-tour: touched down in ${city}.`);
			await ns.sleep(200);
			continue;
		}

		ns.tprint(`world-tour: in ${city}, waiting for the invitation (engine checks every ~20s)...`);
		const arrived = Date.now();
		let invited = false;
		while (Date.now() - arrived < INVITE_WAIT_MS) {
			if (ns.singularity.checkFactionInvitations().includes(city)) { invited = true; break; }
			await ns.sleep(POLL_MS);
		}
		if (invited) {
			collected.push(city);
			ns.tprint(`world-tour: ${city} invitation received (${((Date.now() - arrived) / 1000).toFixed(0)}s).`);
		} else {
			missed.push(city);
			const hint = WANTS[city] && ns.getPlayer().money < WANTS[city]
				? `you have $${ns.format.number(ns.getPlayer().money)} and ${city} historically wants ` +
					`$${ns.format.number(WANTS[city])} on hand [OPEN]`
				: `money looks sufficient — already joined an enemy city faction?`;
			ns.tprint(`world-tour: no ${city} invite after ${INVITE_WAIT_MS / 1000}s — moving on. Hint: ${hint}`);
		}
	}

	const verdict = opts.fast ? "" : collected.length || missed.length
		? ` Invitations collected: ${collected.length ? collected.join(", ") : "none"}.` +
			(missed.length ? ` Missed: ${missed.join(", ")} (see hints above).` : "")
		: " Nothing left to collect.";
	ns.tprint(`world-tour: home in ${HOME_CITY}. ${stops.length} hops, $${ns.format.number(cost)} spent.${verdict}`);
}
