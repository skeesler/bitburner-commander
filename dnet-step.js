/**
 * dnet-step.js — push scripts onto a directly-connected darknet node and run one there.
 *
 * The darknet has no terminal `connect`, so this is how you get compute *onto* a node:
 * scp the files over a session, then exec. `home` is directly connected to `darkweb` and
 * already holds a session, so `run dnet-step.js` walks a recon script through the front door.
 *
 *   run dnet-step.js [target] [script] [...args]
 *   defaults: target=darkweb, script=dnet-recon.js
 *
 * The exec'd script's ns.tprint output shows up in your normal terminal.
 */
// Tab-complete the target (a server) and the script arg. data.servers / data.scripts are
// provided by the terminal; returning both lets every positional arg autocomplete.
export function autocomplete(data, args) {
	return [...data.servers, ...data.scripts];
}

// Ship every dnet-*.js on home (except this launcher) + the password book — nothing hardcoded.
function payload(ns) {
	return ns.ls("home", "dnet-").filter((f) => (f.endsWith(".js") || f === "dnet-db.json") && f !== ns.getScriptName());
}

export async function main(ns) {
	const target = ns.args[0] || "darkweb";
	const script = ns.args[1] || "dnet-recon.js";
	const rest = ns.args.slice(2);
	const d = ns.dnet;

	let det = null;
	try {
		det = await d.getServerDetails(target);
	} catch (e) {
		ns.tprint(`getServerDetails(${target}) err: ${e}`);
	}
	if (det) {
		ns.tprint(
			`target ${target}: model=${det.modelId} online=${det.isOnline} ` +
				`connected=${det.isConnectedToCurrentServer} session=${det.hasSession}`,
		);
	}

	// ZeroLogon entry needs no password, but authenticate if we somehow lack a session.
	if (det && det.hasSession === false) {
		try {
			const r = await d.authenticate(target, "");
			ns.tprint(`authenticate(${target}, "") -> ${r && r.code} ${r && r.message}`);
		} catch (e) {
			ns.tprint(`authenticate err: ${e}`);
		}
	}

	const files = payload(ns);
	let scpOk = false;
	try {
		scpOk = await ns.scp(files, target);
	} catch (e) {
		ns.tprint(`scp err: ${e}`);
	}
	ns.tprint(`scp ${files.length} files -> ${target} (${files.join(", ")}): ${scpOk}`);

	let pid = 0;
	try {
		pid = ns.exec(script, target, 1, ...rest);
	} catch (e) {
		ns.tprint(`exec err: ${e}`);
	}
	ns.tprint(
		pid
			? `exec ${script} on ${target} (pid ${pid}) — its output prints to your terminal`
			: `exec FAILED — check: files scp'd? RAM on ${target}? session? directly connected?`,
	);
}
