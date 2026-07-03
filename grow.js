/** @param {NS} ns
 *  Minimal HWGW worker. Launched by batcher.js.
 *  args: [target, additionalMsec]
 */
export async function main(ns) {
  await ns.grow(ns.args[0], { additionalMsec: ns.args[1] ?? 0 });
}
