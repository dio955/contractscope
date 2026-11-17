// ContractScope page script. Exports App.page: the single page object that both
// the page's own form and the agent's site-actions call, so both follow one set
// of rules. All data fetching is read-only (see fetcher.js). No transaction is
// ever sent from this page.
import {
  CHAINS,
  checkContract as fetchAll,
  fetchLiquidityFacts,
  fetchOwnershipFacts,
  fetchSourceFacts,
  fetchTokenomicsFacts,
  validateTarget,
} from "./fetcher.js";

const state = {
  currentAddress: "",
  currentChain: 56,
  facts: { source: null, ownership: null, tokenomics: null, liquidity: null },
  lastCheckedAt: null,
  fetchErrors: [],
};

function el(id) {
  try {
    if (typeof document === "undefined") return null;
    return document.querySelector(`#${id}`);
  } catch {
    return null;
  }
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = value;
}

/** Render the contract card from state. Never throws: the page works without it. */
function renderCard() {
  try {
    const card = el("contract-card");
    if (!card) return;
    const { source, ownership, tokenomics, liquidity } = state.facts;
    setText("card-address", state.currentAddress || "—");
    setText("card-chain", state.currentAddress ? (CHAINS[state.currentChain]?.name || `Chain ${state.currentChain}`) : "—");
    setText("card-checked", state.lastCheckedAt ? new Date(state.lastCheckedAt).toLocaleString("en-US") : "Not checked yet");
    setText("fact-source", source
      ? source.ok
        ? source.verified
          ? `Verified on Sourcify (${source.match || "match"}, ${source.sources.length} source file${source.sources.length === 1 ? "" : "s"})`
          : "Not verified on Sourcify — no source scan possible"
        : `Unavailable: ${source.reason}`
      : "—");
    setText("fact-owner", ownership
      ? ownership.ok
        ? !ownership.hasCode
          ? "No contract code at this address on this chain"
          : ownership.owner === null
            ? `Unknown — ${ownership.ownerNote || "owner() not available"}`
            : ownership.renounced
              ? `Renounced (owner is ${ownership.owner})`
              : `Owner: ${ownership.owner}`
        : `Unavailable: ${ownership.reason}`
      : "—");
    setText("fact-proxy", ownership
      ? ownership.ok
        ? ownership.isProxy
          ? `Yes — implementation ${ownership.implementation}`
          : "No EIP-1967 implementation slot found"
        : `Unavailable: ${ownership.reason}`
      : "—");
    setText("fact-token", tokenomics
      ? tokenomics.ok
        ? tokenomics.isToken
          ? `${tokenomics.name || "?"} (${tokenomics.symbol || "?"})${tokenomics.decimals !== null ? `, ${tokenomics.decimals} decimals` : ""}${tokenomics.totalSupply !== null ? `, total supply ${tokenomics.totalSupply}` : ""}`
          : "Not an ERC-20 token (no metadata getters answered)"
        : `Unavailable: ${tokenomics.reason}`
      : "—");
    setText("fact-mint-pause", tokenomics
      ? tokenomics.ok
        ? tokenomics.sourceVerified
          ? `Mint function in source: ${tokenomics.mintable ? "yes" : "no"} · Pausable: ${tokenomics.pausable ? "yes" : "no"} · MaxTx limit: ${tokenomics.hasMaxTx ? "yes" : "no"}`
          : "Source not verified — mint/pausable unknown from source"
        : `Unavailable: ${tokenomics.reason}`
      : "—");
    setText("fact-tax", tokenomics
      ? tokenomics.ok
        ? tokenomics.taxSignals.length > 0
          ? `Tax/fee patterns found in source: ${tokenomics.taxSignals.join("; ")} (patterns only — rates are not read here)`
          : "No buy/sell tax patterns found in the verified source"
        : `Unavailable: ${tokenomics.reason}`
      : "—");
    setText("fact-holders", tokenomics
      ? tokenomics.ok
        ? "Holder count and top holders: unavailable (no keyless public API provides them)"
        : `Unavailable: ${tokenomics.reason}`
      : "—");
    setText("fact-liquidity", liquidity
      ? liquidity.ok
        ? liquidity.pairCount === 0
          ? "No trading pair reported by DexScreener on this chain"
          : liquidity.topPair
            ? `Top pair: ${liquidity.topPair.dex || "?"} ${liquidity.topPair.baseSymbol || ""}/${liquidity.topPair.quoteSymbol || ""} — liquidity $${liquidity.topPair.liquidityUsd ?? "unknown"} (${liquidity.pairCount} pair${liquidity.pairCount === 1 ? "" : "s"} total)`
            : `${liquidity.pairCount} pair(s) reported`
        : `Unavailable: ${liquidity.reason}`
      : "—");
    setText("fact-lplock", liquidity
      ? liquidity.ok
        ? liquidity.lpLock
          ? liquidity.lpLock.checked
            ? `${liquidity.lpLock.burnedToDeadOrZeroPct}% of LP tokens at burn addresses — ${liquidity.lpLock.note}`
            : liquidity.lpLock.note
          : "No pair to check LP lock against"
        : `Unavailable: ${liquidity.reason}`
      : "—");
    const errors = el("card-errors");
    if (errors) {
      errors.textContent = state.fetchErrors.length > 0
        ? `Some checks failed and are reported as unknown, not guessed: ${state.fetchErrors.join(" ")}`
        : "";
    }
    card.hidden = false;
  } catch {
    // Rendering must never break the check itself.
  }
}

function storeFacts(result) {
  state.facts = result.facts;
  state.lastCheckedAt = result.checkedAt;
  state.fetchErrors = result.fetchErrors || [];
  renderCard();
  return { ok: true, address: result.address, chainId: result.chainId, chainName: result.chainName, checkedAt: result.checkedAt, facts: result.facts, fetchErrors: result.fetchErrors };
}

export const App = {
  page: {
    /** Plain-JSON copy of the page state for the agent's read tool. */
    getState() {
      return {
        currentAddress: state.currentAddress,
        currentChain: state.currentChain,
        chainName: CHAINS[state.currentChain]?.name || null,
        facts: JSON.parse(JSON.stringify(state.facts)),
        lastCheckedAt: state.lastCheckedAt,
        fetchErrors: [...state.fetchErrors],
        supportedChains: Object.entries(CHAINS).map(([id, c]) => ({ chainId: Number(id), name: c.name })),
        disclaimer: "This is not a guarantee of safety — always do your own research.",
      };
    },

    /** Validate and remember a target without fetching. Refuses bad input. */
    setTarget(address, chainId) {
      const target = validateTarget(address, chainId);
      if (!target.ok) return target;
      state.currentAddress = target.address;
      state.currentChain = target.chainId;
      renderCard();
      return { ok: true, address: target.address, chainId: target.chainId };
    },

    /** Full read-only check of one contract; stores the facts and renders the card. */
    async checkContract(address, chainId) {
      const target = validateTarget(address ?? state.currentAddress, chainId ?? state.currentChain);
      if (!target.ok) return target;
      state.currentAddress = target.address;
      state.currentChain = target.chainId;
      const result = await fetchAll(target.address, target.chainId);
      if (!result.ok) return result;
      return storeFacts(result);
    },

    /** One fact area at a time; each validates its input and never throws for it. */
    async fetchSourceFacts(address, chainId) {
      const target = validateTarget(address ?? state.currentAddress, chainId ?? state.currentChain);
      if (!target.ok) return target;
      const result = await fetchSourceFacts(target.address, target.chainId);
      if (result.ok && target.address === state.currentAddress && target.chainId === state.currentChain) {
        state.facts.source = result;
        renderCard();
      }
      return result;
    },

    async fetchOwnershipFacts(address, chainId) {
      const target = validateTarget(address ?? state.currentAddress, chainId ?? state.currentChain);
      if (!target.ok) return target;
      const result = await fetchOwnershipFacts(target.address, target.chainId);
      if (result.ok && target.address === state.currentAddress && target.chainId === state.currentChain) {
        state.facts.ownership = result;
        renderCard();
      }
      return result;
    },

    async fetchTokenomicsFacts(address, chainId) {
      const target = validateTarget(address ?? state.currentAddress, chainId ?? state.currentChain);
      if (!target.ok) return target;
      const result = await fetchTokenomicsFacts(target.address, target.chainId);
      if (result.ok && target.address === state.currentAddress && target.chainId === state.currentChain) {
        state.facts.tokenomics = result;
        renderCard();
      }
      return result;
    },

    async fetchLiquidityFacts(address, chainId) {
      const target = validateTarget(address ?? state.currentAddress, chainId ?? state.currentChain);
      if (!target.ok) return target;
      const result = await fetchLiquidityFacts(target.address, target.chainId);
      if (result.ok && target.address === state.currentAddress && target.chainId === state.currentChain) {
        state.facts.liquidity = result;
        renderCard();
      }
      return result;
    },

    /** Read-only check used by site.js dialogs (no irreversible actions on this site). */
    checkTarget(address, chainId) {
      return validateTarget(address, chainId);
    },
  },
};

// Wire the page's own form to the same methods the assistant calls.
try {
  const form = el("check-form");
  if (form && typeof form.addEventListener === "function") {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const addressInput = el("contract-address");
      const chainSelect = el("contract-chain");
      const status = el("check-status");
      const address = addressInput ? addressInput.value : "";
      const chainId = chainSelect ? Number(chainSelect.value) : 56;
      if (status) status.textContent = "Checking… (read-only, no transaction is sent)";
      const result = await App.page.checkContract(address, chainId);
      if (status) {
        status.textContent = result.ok
          ? result.fetchErrors.length > 0
            ? `Checked with ${result.fetchErrors.length} failed area(s) — see the card.`
            : "Checked. See the contract card below."
          : result.reason;
      }
    });
    for (const button of (typeof document !== "undefined" && document.querySelectorAll
      ? document.querySelectorAll("[data-sample]") : [])) {
      button.addEventListener("click", () => {
        const addressInput = el("contract-address");
        const chainSelect = el("contract-chain");
        if (addressInput) addressInput.value = button.getAttribute("data-sample") || "";
        if (chainSelect) chainSelect.value = button.getAttribute("data-chain") || "56";
      });
    }
  }
} catch {
  // The page must keep working even if the form wiring fails.
}
