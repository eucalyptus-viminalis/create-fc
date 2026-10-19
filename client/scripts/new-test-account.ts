#!/usr/bin/env node
// Make a brand-new Farcaster account to test with.
//
//   FC_NODE=http://<your node>:3381 node scripts/new-test-account.ts [--dry-run]
//
// 1. Generates a fresh 12-word seed phrase on this machine and shows it once.
// 2. Waits for you to send a little ETH on Optimism (OP Mainnet) to the
//    address it prints. Registration costs about $0.20, gas a fraction of a cent.
// 3. Calls IdGateway.register on Optimism. That one transaction gives the
//    address a new FID and one storage unit, enough to post.
// 4. Waits for your node to see the registration, then optionally registers
//    this client's app key (gasless) so you can post right away.
//
// The only network services involved are your node and an Optimism RPC
// (OP_RPC, default https://mainnet.optimism.io, no key needed).
// --dry-run stops before waiting for funds and sends nothing.

import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { createPublicClient, createWalletClient, decodeEventLog, formatEther, http, zeroAddress } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { optimism } from "viem/chains";
import { ID_GATEWAY_ADDRESS, ID_REGISTRY_ADDRESS, idGatewayABI, idRegistryABI } from "@farcaster/core";
import { NODE, NodeError, get } from "../src/node.ts";
import { registerAppKey } from "../src/keys.ts";

const OP_RPC = process.env.OP_RPC ?? "https://mainnet.optimism.io";
const { values } = parseArgs({ options: { "dry-run": { type: "boolean" } } });
const dryRun = Boolean(values["dry-run"]);

const log = (s = "") => console.error(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rl = createInterface({ input: process.stdin, output: process.stderr });

async function main() {
  const chain = createPublicClient({ chain: optimism, transport: http(OP_RPC) });

  // ---- 1. a fresh phrase, shown once
  const phrase = generateMnemonic(wordlist, 128);
  const account = mnemonicToAccount(phrase); // m/44'/60'/0'/0/0, as clearcast login expects
  log(`
\x1b[1mThis creates a NEW Farcaster account for testing.\x1b[0m

Below is its seed phrase. It is shown once and is not saved anywhere. Write
it down if you want to use this account again: clearcast login asks for it. Treat
it like a password, even for a throwaway account. Anyone holding it controls
the account.

    \x1b[1m${phrase}\x1b[0m

custody address: ${account.address}
`);
  if (!dryRun) {
    const last = phrase.split(" ").at(-1)!;
    while ((await rl.question("type the LAST word of the phrase to confirm you've saved it: ")).trim().toLowerCase() !== last)
      log("that's not the last word. Look again.");
    process.stderr.write("\x1b[2J\x1b[3J\x1b[H"); // clear the screen and scrollback so the phrase leaves the terminal
  }

  // ---- 2. what it costs, and funding
  const price = await chain.readContract({ address: ID_GATEWAY_ADDRESS, abi: idGatewayABI, functionName: "price" });
  const value = (price * 110n) / 100n; // 10% headroom in case the price moves; the contract refunds the rest
  const need = value + 50_000_000_000_000n; // + 0.00005 ETH for gas, far more than it costs
  log(`registration price: ${formatEther(price)} ETH (includes 1 storage unit)`);
  log(`send at least ${formatEther(need)} ETH on Optimism (OP Mainnet, chain id 10) to:\n\n    ${account.address}\n`);

  const existing = await chain.readContract({ address: ID_REGISTRY_ADDRESS, abi: idRegistryABI, functionName: "idOf", args: [account.address] });
  if (existing > 0n) throw new NodeError(`this address already owns fid ${existing}`);

  if (dryRun) {
    // Simulate the registration as if the address were funded (a state
    // override, nothing is sent). This runs the real contract code and
    // returns the fid it would get, which proves the address, ABI and price.
    const { result } = await chain.simulateContract({
      account,
      address: ID_GATEWAY_ADDRESS,
      abi: idGatewayABI,
      functionName: "register",
      args: [zeroAddress],
      value,
      stateOverride: [{ address: account.address, balance: need }],
    });
    const [fid, overpayment] = result as unknown as [bigint, bigint];
    log(`dry run: simulated register() would create fid ${fid} and refund ${formatEther(overpayment)} ETH.`);
    log("dry run: nothing was sent.");
    return;
  }

  let balance = await chain.getBalance({ address: account.address });
  while (balance < need) {
    process.stderr.write(`\rwaiting for funds: ${formatEther(balance)} / ${formatEther(need)} ETH   `);
    await sleep(5000);
    balance = await chain.getBalance({ address: account.address });
  }
  log(`\nfunded: ${formatEther(balance)} ETH`);

  // ---- 3. register. The recovery address is zero: a test account that can't
  // be recovered if the phrase is lost. Pass a real address for a keeper.
  const wallet = createWalletClient({ account, chain: optimism, transport: http(OP_RPC) });
  const { request } = await chain.simulateContract({ account, address: ID_GATEWAY_ADDRESS, abi: idGatewayABI, functionName: "register", args: [zeroAddress], value });
  const tx = await wallet.writeContract(request);
  log(`register tx: https://optimistic.etherscan.io/tx/${tx}`);
  const receipt = await chain.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new NodeError(`the transaction reverted: ${tx}`);
  let fid = 0;
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== ID_REGISTRY_ADDRESS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: idRegistryABI, data: l.data, topics: l.topics });
      if (ev.eventName === "Register") fid = Number((ev.args as { id: bigint }).id);
    } catch {}
  }
  if (!fid) throw new NodeError(`registered, but couldn't find the Register event in ${tx}`);
  log(`\x1b[1mfid ${fid}\x1b[0m registered to ${account.address}`);

  // ---- 4. wait for your node to see it. Validators pick up Optimism events
  // after a few confirmations, and your node gets them in the next blocks.
  log(`waiting for your node (${NODE}) to see fid ${fid} and its storage...`);
  for (let i = 0; ; i++) {
    const s = await get<{ units: number }>("/v1/storageLimitsByFid", { fid }).catch(() => ({ units: 0 }));
    if (s.units > 0) break;
    if (i === 60) throw new NodeError("your node hasn't seen the registration after 5 minutes. Check clearcast status, then run clearcast login later.");
    await sleep(5000);
  }
  log(`your node has fid ${fid} with storage.`);

  const answer = (await rl.question("register this client's app key now, so you can post? [Y/n] ")).trim().toLowerCase();
  if (answer === "" || answer === "y" || answer === "yes") {
    await registerAppKey({ account, fid, path: "m/44'/60'/0'/0/0" }, { log });
  } else {
    log("ok. Run clearcast login later with the phrase you saved.");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof NodeError ? `error: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
