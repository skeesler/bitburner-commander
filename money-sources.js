/**
 * money-sources.js — where is the money actually coming from?
 *
 * `ns.getMoneySources()` returns the game's own ledger, split into `sinceInstall` and `sinceStart`,
 * with one field per income stream. It is the only honest answer to "my cash is climbing and I don't
 * know why", and it costs almost nothing to ask.
 *
 * Worth running in BN9 specifically, because the node's multipliers make the answer counter-intuitive:
 * hacking is at 0.1% of normal (ServerMaxMoney 0.01 x ScriptHackMoney 0.1), the darknet is at 5%,
 * crime is halved — but `CodingContractMoney` is NOT in BN9's multiplier list at all [SRC:
 * BitNode.tsx case 9], so contracts pay full price if something is solving them.
 *
 * The awkward case this was written for: money climbing with NO scripts running. That rules out
 * hacking, contract-solving and every other script-driven stream at once, and leaves the mechanisms
 * that tick on their own — a gang (which earns with zero scripts and needs only SF2), stock holdings,
 * or work/crime started in the UI. Guessing between those is exactly what this ledger is for.
 *
 *   run money-sources.js              # both ledgers, biggest first
 *   run money-sources.js --install    # only sinceInstall
 *
 * Read-only.
 */

export async function main(ns) {
	const opts = ns.flags([["install", false], ["help", false]]);
	if (opts.help) {
		ns.tprint("\nrun money-sources.js [--install]\n  --install  only the sinceInstall ledger\n\nRead-only.\n");
		return;
	}

	let src;
	try {
		src = ns.getMoneySources();
	} catch (e) {
		ns.tprint(`\nns.getMoneySources() failed: ${e}\n`);
		return;
	}

	const out = [`=== where the money came from ===`];
	const ledgers = opts.install ? ["sinceInstall"] : ["sinceInstall", "sinceStart"];
	for (const which of ledgers) {
		const ledger = src?.[which];
		if (!ledger || typeof ledger !== "object") {
			out.push(`\n--- ${which} --- (not present in this build)`);
			continue;
		}
		// Earnings and losses both live here; separating them is the whole point, because a big
		// negative (augmentations, servers, hospitalisation) otherwise hides what's actually earning.
		// `total` is a REAL field on MoneySourceTracker, not a derived one: record() increments the
		// named source AND total by the same (possibly negative) amount, so total is the NET of
		// everything. Summing it alongside the sources double-counts — which this script did on its
		// first run, reporting $369m earned when the true net was $102m.
		const rows = Object.entries(ledger)
			.filter(([k, v]) => k !== "total" && typeof v === "number" && v !== 0)
			.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
		const earned = rows.filter(([, v]) => v > 0).reduce((a, [, v]) => a + v, 0);
		const spent = rows.filter(([, v]) => v < 0).reduce((a, [, v]) => a + v, 0);
		const net = typeof ledger.total === "number" ? ledger.total : earned + spent;

		out.push(`\n--- ${which} ---   earned ${money(ns, earned)}, spent ${money(ns, spent)}, ` +
			`net ${money(ns, net)}`);
		if (!rows.length) { out.push("  (nothing recorded)"); continue; }
		for (const [name, v] of rows) {
			const share = v > 0 && earned > 0 ? `${((v / earned) * 100).toFixed(1)}%` : "";
			out.push(`  ${pad(name, 22)}${pad(money(ns, v), 14)}${share}`);
		}
	}

	out.push(`\n  Negative rows are spending; shares are of earnings only. "hacknet" includes hashes that`);
	out.push(`  overflowed the bank — the game auto-sells those at the Sell-for-Money rate.`);
	ns.tprint("\n" + out.join("\n") + "\n");
}

/** ns.format.number is the v3 name; ns.formatNumber is a 3.0.0 TOMBSTONE that throws when called. */
function money(ns, v) {
	if (!Number.isFinite(v)) return String(v);
	const sign = v < 0 ? "-$" : "$";
	try { return sign + ns.format.number(Math.abs(v), 2); } catch (e) { return sign + Math.abs(v).toFixed(2); }
}

function pad(s, n) {
	s = String(s);
	return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length);
}
