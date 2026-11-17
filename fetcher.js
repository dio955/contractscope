// ContractScope data fetcher — read-only, public APIs only, no keys, no server.
// Runs in the browser and in Node (globalThis.fetch). Every function returns a
// plain JSON result; a failed fetch is {ok: false, reason}, never a thrown error
// the agent would have to guess about, and never invented data.

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

export const CHAINS = {
  56: {
    name: "BNB Smart Chain",
    short: "BSC",
    rpcs: ["https://bsc-dataseed.binance.org", "https://bsc.publicnode.com"],
    dexscreenerChain: "bsc",
  },
  1: {
    name: "Ethereum",
    short: "Ethereum",
    rpcs: ["https://eth-mainnet.public.blastapi.io", "https://eth.drpc.org"],
    dexscreenerChain: "ethereum",
  },
};

// Function selectors for common read-only getters.
export const SELECTORS = {
  owner: "0x8da5cb5b",
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  balanceOf: "0x70a08231",
};

// EIP-1967 proxy slots.
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

let fetchImpl = null;

/** Override the fetch implementation (used by tests). Pass null to restore global fetch. */
export function setFetchImpl(fn) {
  fetchImpl = fn;
}

function doFetch(url, options) {
  const fn = fetchImpl || globalThis.fetch;
  return fn(url, options);
}

function withTimeout(ms) {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

export function isValidAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function normalizeAddress(value) {
  return typeof value === "string" ? value.trim() : value;
}

function badInput(reason) {
  return { ok: false, reason };
}

/** Validate an address + chain the way every fetcher does, before any network call. */
export function validateTarget(address, chainId) {
  const addr = normalizeAddress(address);
  if (!isValidAddress(addr)) {
    return badInput(`"${String(address)}" is not a valid contract address. Use a 0x address with 40 hex characters.`);
  }
  const chain = Number(chainId);
  if (!CHAINS[chain]) {
    return badInput(`Chain ${String(chainId)} is not supported. Use 56 (BNB Smart Chain) or 1 (Ethereum).`);
  }
  return { ok: true, address: addr, chainId: chain };
}

async function fetchJson(url, options = {}) {
  const response = await doFetch(url, { ...options, signal: withTimeout(20000) });
  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, reason: `HTTP ${response.status} from ${new URL(url).hostname}` };
  }
  try {
    return { ok: true, status: response.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: response.status, reason: `Non-JSON response from ${new URL(url).hostname}` };
  }
}

/** JSON-RPC call with fallback across the chain's public RPC endpoints. */
export async function rpcCall(chainId, method, params) {
  const chain = CHAINS[chainId];
  if (!chain) return badInput(`Chain ${chainId} is not supported.`);
  const errors = [];
  for (const url of chain.rpcs) {
    try {
      const response = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: withTimeout(15000),
      });
      const data = await response.json();
      if (data.error) {
        return { ok: false, reason: `RPC error from ${new URL(url).hostname}: ${data.error.message || "call failed"}`, reverted: true, rpc: url };
      }
      return { ok: true, result: data.result, rpc: url };
    } catch (error) {
      errors.push(`${new URL(url).hostname}: ${error.message}`);
    }
  }
  return { ok: false, reason: `On-chain check unavailable: all public RPC endpoints failed (${errors.join("; ")}).` };
}

function decodeAddress(hex) {
  if (typeof hex !== "string" || hex.length < 66) return null;
  return `0x${hex.slice(-40)}`;
}

function decodeUint(hex) {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  try {
    return BigInt(hex).toString();
  } catch {
    return null;
  }
}

function decodeString(hex) {
  if (typeof hex !== "string" || hex.length < 130) return null;
  try {
    const offset = Number(BigInt(`0x${hex.slice(2, 66)}`));
    const length = Number(BigInt(`0x${hex.slice(66, 130)}`));
    // offset points at the length word; the bytes follow 32 bytes later.
    const start = 2 + (offset + 32) * 2;
    const bytes = hex.slice(start, start + length * 2);
    const raw = new Uint8Array(length);
    for (let i = 0; i < length; i++) raw[i] = parseInt(bytes.slice(i * 2, i * 2 + 2), 16);
    return new TextDecoder("utf-8", { fatal: false }).decode(raw);
  } catch {
    return null;
  }
}

function balanceOfData(address) {
  return `${SELECTORS.balanceOf}${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

async function ethCall(chainId, address, data) {
  const res = await rpcCall(chainId, "eth_call", [{ to: address, data }, "latest"]);
  if (!res.ok) return res;
  return { ok: true, result: res.result, rpc: res.rpc };
}

/** Scan verified source text for common risk signals. Returns names, never verdicts. */
export function scanSource(sourceText) {
  const src = sourceText || "";
  const has = (re) => re.test(src);
  return {
    hasMintFunction: has(/\bmint\s*\(/i),
    hasPauseFunction: has(/paus(e|able|d)\s*\(|whenNotPaused|whenPaused/i),
    hasOwnerFunction: has(/\bowner\s*\(|onlyOwner/i),
    hasProxyPattern: has(/delegatecall|upgradeable|UUPS|TransparentUpgradeableProxy|EIP1967/i),
    hasBlacklist: has(/blacklist|isBlacklisted/i),
    hasMaxTx: has(/maxTx|_maxTxAmount|maxTransactionAmount/i),
    taxSignals: [
      has(/buyTax|_buyTax/i) ? "buyTax in source" : null,
      has(/sellTax|_sellTax/i) ? "sellTax in source" : null,
      has(/taxFee|_taxFee/i) ? "taxFee in source" : null,
      has(/swapAndLiquify/i) ? "swapAndLiquify in source" : null,
      has(/marketingFee|liquidityFee|devFee/i) ? "fee (marketing/liquidity/dev) in source" : null,
    ].filter(Boolean),
  };
}

/**
 * Sourcify verified-source check. The v2 endpoint with ?fields=sources,metadata
 * returns the full source inline. A 404 means "not verified", not an error.
 */
export async function fetchSourceFacts(address, chainId) {
  const target = validateTarget(address, chainId);
  if (!target.ok) return target;
  const url = `https://sourcify.dev/server/v2/contract/${target.chainId}/${target.address}?fields=sources,metadata`;
  let fetched;
  try {
    fetched = await fetchJson(url);
  } catch (error) {
    return { ok: false, reason: `Source check unavailable: could not reach Sourcify (${error.message}).` };
  }
  if (!fetched.ok) {
    if (fetched.status === 404) {
      return {
        ok: true, address: target.address, chainId: target.chainId,
        verified: false, match: null, verifiedAt: null,
        sources: [], sourceChars: 0, signals: scanSource(""),
        note: "Source is not verified on Sourcify for this chain, so no source scan was possible.",
      };
    }
    return { ok: false, reason: `Source check unavailable: Sourcify returned ${fetched.reason}.` };
  }
  const data = fetched.data || {};
  const sources = data.sources || {};
  const names = Object.keys(sources);
  const combined = names.map((name) => sources[name]?.content || "").join("\n");
  return {
    ok: true, address: target.address, chainId: target.chainId,
    verified: true, match: data.match || null, verifiedAt: data.verifiedAt || null,
    sources: names, sourceChars: combined.length, signals: scanSource(combined),
    note: "Source signals come from a keyword scan of the verified source; they show that a pattern exists, not what it does at runtime.",
  };
}

/** Ownership: owner() getter, renounced check, and EIP-1967 proxy slots. */
export async function fetchOwnershipFacts(address, chainId) {
  const target = validateTarget(address, chainId);
  if (!target.ok) return target;
  const code = await rpcCall(chainId, "eth_getCode", [target.address, "latest"]);
  if (!code.ok) return { ok: false, reason: code.reason };
  const hasCode = typeof code.result === "string" && code.result !== "0x" && code.result.length > 2;
  if (!hasCode) {
    return {
      ok: true, address: target.address, chainId: target.chainId,
      hasCode: false, owner: null, renounced: null, isProxy: null, implementation: null,
      note: "No code at this address on this chain, so it is not a contract here.",
    };
  }
  const ownerCall = await ethCall(chainId, target.address, SELECTORS.owner);
  let owner = null;
  let ownerNote = null;
  if (ownerCall.ok) {
    owner = decodeAddress(ownerCall.result);
    if (owner === null) ownerNote = "owner() returned data that could not be decoded as an address.";
  } else {
    ownerNote = "owner() is not available on this contract (the call reverted or is unsupported).";
  }
  const implSlot = await rpcCall(chainId, "eth_getStorageAt", [target.address, IMPLEMENTATION_SLOT, "latest"]);
  let implementation = null;
  if (implSlot.ok && typeof implSlot.result === "string") {
    const impl = decodeAddress(implSlot.result);
    if (impl && impl !== ZERO_ADDRESS) implementation = impl;
  }
  const adminSlot = await rpcCall(chainId, "eth_getStorageAt", [target.address, ADMIN_SLOT, "latest"]);
  let admin = null;
  if (adminSlot.ok && typeof adminSlot.result === "string") {
    const adm = decodeAddress(adminSlot.result);
    if (adm && adm !== ZERO_ADDRESS) admin = adm;
  }
  return {
    ok: true, address: target.address, chainId: target.chainId,
    hasCode: true,
    owner,
    renounced: owner === null ? null : owner.toLowerCase() === ZERO_ADDRESS,
    ownerNote,
    isProxy: implementation !== null,
    implementation,
    proxyAdmin: admin,
    note: "Renounced means owner() returns the zero address. A proxy means the logic contract can be replaced; check the implementation contract separately.",
  };
}

/** Token facts: ERC-20 metadata via eth_call, mint/pausable from the verified source. */
export async function fetchTokenomicsFacts(address, chainId) {
  const target = validateTarget(address, chainId);
  if (!target.ok) return target;
  const [nameRes, symbolRes, decimalsRes, supplyRes] = await Promise.all([
    ethCall(chainId, target.address, SELECTORS.name),
    ethCall(chainId, target.address, SELECTORS.symbol),
    ethCall(chainId, target.address, SELECTORS.decimals),
    ethCall(chainId, target.address, SELECTORS.totalSupply),
  ]);
  const name = nameRes.ok ? decodeString(nameRes.result) : null;
  const symbol = symbolRes.ok ? decodeString(symbolRes.result) : null;
  const decimals = decimalsRes.ok ? decodeUint(decimalsRes.result) : null;
  const totalSupply = supplyRes.ok ? decodeUint(supplyRes.result) : null;
  const isToken = name !== null || symbol !== null || totalSupply !== null;
  const source = await fetchSourceFacts(target.address, target.chainId);
  const signals = source.ok ? source.signals : scanSource("");
  return {
    ok: true, address: target.address, chainId: target.chainId,
    isToken,
    name, symbol,
    decimals: decimals === null ? null : Number(decimals),
    totalSupply,
    mintable: source.ok && source.verified ? signals.hasMintFunction : null,
    pausable: source.ok && source.verified ? signals.hasPauseFunction : null,
    hasMaxTx: source.ok && source.verified ? signals.hasMaxTx : null,
    hasBlacklist: source.ok && source.verified ? signals.hasBlacklist : null,
    taxSignals: source.ok && source.verified ? signals.taxSignals : [],
    sourceVerified: source.ok ? source.verified : null,
    holderCount: null,
    topHolders: null,
    holderNote: "Holder count and top holders are unavailable: no keyless public API provides them, so this check does not invent them.",
    note: isToken
      ? "Metadata comes from on-chain getter calls; a null value means that getter reverted or is missing, not that the value is zero."
      : "This contract does not answer ERC-20 metadata getters, so it is probably not an ERC-20 token (for example, an NFT or a mint contract).",
  };
}

/** Liquidity: DexScreener pairs plus a best-effort LP burn check on the top pair. */
export async function fetchLiquidityFacts(address, chainId) {
  const target = validateTarget(address, chainId);
  if (!target.ok) return target;
  let fetched;
  try {
    fetched = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${target.address}`);
  } catch (error) {
    return { ok: false, reason: `Liquidity check unavailable: could not reach DexScreener (${error.message}).` };
  }
  if (!fetched.ok) return { ok: false, reason: `Liquidity check unavailable: DexScreener returned ${fetched.reason}.` };
  const allPairs = Array.isArray(fetched.data?.pairs) ? fetched.data.pairs : [];
  const chainKey = CHAINS[target.chainId].dexscreenerChain;
  const pairs = allPairs
    .filter((p) => p.chainId === chainKey)
    .map((p) => ({
      dex: p.dexId || null,
      pairAddress: p.pairAddress || null,
      url: p.url || null,
      baseSymbol: p.baseToken?.symbol || null,
      quoteSymbol: p.quoteToken?.symbol || null,
      priceUsd: p.priceUsd || null,
      liquidityUsd: p.liquidity?.usd ?? null,
      volume24hUsd: p.volume?.h24 ?? null,
      marketCapUsd: p.marketCap ?? null,
    }))
    .sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
  const top = pairs[0] || null;
  let lpLock = null;
  if (top?.pairAddress) {
    const [deadRes, zeroRes, supplyRes] = await Promise.all([
      ethCall(chainId, top.pairAddress, balanceOfData(DEAD_ADDRESS)),
      ethCall(chainId, top.pairAddress, balanceOfData(ZERO_ADDRESS)),
      ethCall(chainId, top.pairAddress, SELECTORS.totalSupply),
    ]);
    const deadBal = deadRes.ok ? decodeUint(deadRes.result) : null;
    const zeroBal = zeroRes.ok ? decodeUint(zeroRes.result) : null;
    const supply = supplyRes.ok ? decodeUint(supplyRes.result) : null;
    if (deadBal !== null && zeroBal !== null && supply !== null && BigInt(supply) > 0n) {
      const burned = BigInt(deadBal) + BigInt(zeroBal);
      const pct = Number((burned * 10000n) / BigInt(supply)) / 100;
      lpLock = {
        checked: true, pairAddress: top.pairAddress,
        burnedToDeadOrZeroPct: pct,
        note: `${pct}% of the pair's LP tokens sit at the burn/dead addresses. That is a burn check, not proof of a timelock: locked LP in a locker contract is not detected here.`,
      };
    } else {
      lpLock = { checked: false, pairAddress: top.pairAddress, note: "LP burn check unavailable: the pair contract did not answer balance/totalSupply calls." };
    }
  }
  return {
    ok: true, address: target.address, chainId: target.chainId,
    pairCount: pairs.length,
    pairs: pairs.slice(0, 5),
    topPair: top,
    lpLock,
    note: pairs.length === 0
      ? "DexScreener reports no trading pair for this token on this chain."
      : "Pairs and liquidity come from DexScreener; always cross-check the pair address before trusting it.",
  };
}

/** Run all four fact areas for one contract. Never throws for bad input. */
export async function checkContract(address, chainId) {
  const target = validateTarget(address, chainId);
  if (!target.ok) return target;
  const [source, ownership, tokenomics, liquidity] = await Promise.all([
    fetchSourceFacts(target.address, target.chainId),
    fetchOwnershipFacts(target.address, target.chainId),
    fetchTokenomicsFacts(target.address, target.chainId),
    fetchLiquidityFacts(target.address, target.chainId),
  ]);
  const errors = [source, ownership, tokenomics, liquidity]
    .filter((r) => !r.ok)
    .map((r) => r.reason);
  return {
    ok: true, address: target.address, chainId: target.chainId,
    chainName: CHAINS[target.chainId].name,
    checkedAt: new Date().toISOString(),
    facts: { source, ownership, tokenomics, liquidity },
    fetchErrors: errors,
  };
}
