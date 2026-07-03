/** @param {NS} ns
 *  Minimal HWGW worker. Launched by batcher.js.
 *  args: [target, additionalMsec]
 *  additionalMsec delays the operation internally so all four ops in a
 *  batch land in the right order — more precise than sleeping first.
 */
export async function main(ns) {
  await ns.hack(ns.args[0], { additionalMsec: ns.args[1] ?? 0 });
}
