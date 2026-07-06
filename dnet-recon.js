/**
 * dnet-recon.js — throwaway recon dumper to learn the real shapes of the
 * DarkNet API responses (which the docs don't pin down). Run it on a darknet
 * server you can reach, then paste the printed JSON back to Claudia.
 *
 *   run dnet-recon.js            probe neighbors + getServerDetails on each
 *   run dnet-recon.js <host>     ...and heartbleed <host>, dumping its raw return
 *
 * Every dnet call is wrapped so an unexpected signature/async shape logs an
 * error instead of killing the run. Nothing here is load-bearing — delete it
 * once we know the shapes.
 */

/** Call fn(), tolerate anything (incl. promises/throws); return {ok,val}|{err}. */
async function probe1(label, fn) {
	try {
		return { [label]: await fn() };
	} catch (e) {
		return { [label]: `ERR: ${e}` };
	}
}

export async function main(ns) {
	const here = ns.getHostname();
	const target = ns.args[0];
	const d = ns.dnet;
	const out = { here, isDarknet: undefined, neighbors: [], details: {}, heartbleed: undefined };

	Object.assign(out, await probe1("isDarknet", () => d.isDarknetServer(here)));

	const nb = await probe1("neighbors", () => d.probe());
	out.neighbors = nb.neighbors;
	const hosts = Array.isArray(nb.neighbors) ? nb.neighbors : [];

	for (const h of hosts) {
		out.details[h] = {
			...(await probe1("getServerDetails", () => d.getServerDetails(h))),
			...(await probe1("getDepth", () => d.getDepth(h))),
			...(await probe1("charismaReq", () => d.getServerRequiredCharismaLevel(h))),
		};
	}

	if (target) {
		out.heartbleed = await probe1("raw", () => d.heartbleed(target));
	}

	ns.tprint("\n===== DNET RECON (paste this back) =====\n" + JSON.stringify(out, null, 2) + "\n===== END =====");
}
