// Live read-only fetcher check (NOT part of node --test: it calls real APIs).
// Run: node tests/live-check.mjs
// Prints the four fact areas for PACTURE and TART on BSC. No transaction, no key.
import { checkContract } from "../fetcher.js";

const PACTURE = "0x10b80088fDAf9363d83671BE66b64f231f9e92f6";
const TART = "0x7AB8d02CBb51Ff7223fDe700eAaa2a91Bf750314";

function summarize(result) {
  if (!result.ok) return { ok: false, reason: result.reason };
  const { source, ownership, tokenomics, liquidity } = result.facts;
  return {
    ok: true,
    address: result.address,
    chain: result.chainName,
    checkedAt: result.checkedAt,
    fetchErrors: result.fetchErrors,
    source: source.ok
      ? { verified: source.verified, match: source.match, files: source.sources.length, signals: source.signals }
      : { error: source.reason },
    ownership: ownership.ok
      ? { hasCode: ownership.hasCode, owner: ownership.owner, renounced: ownership.renounced, isProxy: ownership.isProxy, implementation: ownership.implementation }
      : { error: ownership.reason },
    tokenomics: tokenomics.ok
      ? { isToken: tokenomics.isToken, name: tokenomics.name, symbol: tokenomics.symbol, decimals: tokenomics.decimals, totalSupply: tokenomics.totalSupply, mintable: tokenomics.mintable, pausable: tokenomics.pausable, taxSignals: tokenomics.taxSignals, holderCount: tokenomics.holderCount }
      : { error: tokenomics.reason },
    liquidity: liquidity.ok
      ? { pairCount: liquidity.pairCount, topPair: liquidity.topPair ? { dex: liquidity.topPair.dex, pair: liquidity.topPair.pairAddress, liquidityUsd: liquidity.topPair.liquidityUsd, priceUsd: liquidity.topPair.priceUsd } : null, lpLock: liquidity.lpLock }
      : { error: liquidity.reason },
  };
}

for (const address of [PACTURE, TART]) {
  console.log(JSON.stringify(summarize(await checkContract(address, 56)), null, 2));
}
