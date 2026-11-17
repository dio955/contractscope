// Registers ContractScope's read-only operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names
// in "actions.agentTools" become model tools, called website_<name>.
// Every action is a read: nothing here changes page state, sends a transaction,
// or needs a confirmation dialog. Bad input is refused with {ok: false, reason}
// and fetch failures are returned as results, so the agent can explain them.
import { App } from "./script.js";

export function registerActions(actions) {
  actions.register({
    name: "get_contract_state",
    description: "Read the current contract on this page: address, chain, the last fetched facts per area, when it was last checked, and any fetch errors. Call it before answering questions about the contract on the page.",
    effect: "read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute: () => App.page.getState(),
  });
  actions.register({
    name: "fetch_source_facts",
    description: "Check whether a contract's source is verified on Sourcify and scan the verified source for mint, pause, owner, proxy, blacklist, maxTx and tax patterns. Returns verified status, match, source file names and the signals found. A 404 means not verified, not an error.",
    effect: "read",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["address", "chainId"],
      properties: {
        address: { type: "string", minLength: 42, maxLength: 42, description: "The 0x contract address to check, 40 hex characters." },
        chainId: { type: "integer", enum: [56, 1], description: "56 for BNB Smart Chain, 1 for Ethereum." },
      },
    },
    execute: ({ address, chainId }) => App.page.fetchSourceFacts(address, chainId),
  });
  actions.register({
    name: "fetch_ownership_facts",
    description: "Read a contract's ownership on-chain: owner() result, whether the owner is the zero address (renounced), and whether it is an EIP-1967 proxy with an implementation contract. A reverted owner() call is reported as unavailable, not guessed.",
    effect: "read",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["address", "chainId"],
      properties: {
        address: { type: "string", minLength: 42, maxLength: 42, description: "The 0x contract address to check, 40 hex characters." },
        chainId: { type: "integer", enum: [56, 1], description: "56 for BNB Smart Chain, 1 for Ethereum." },
      },
    },
    execute: ({ address, chainId }) => App.page.fetchOwnershipFacts(address, chainId),
  });
  actions.register({
    name: "fetch_tokenomics_facts",
    description: "Read a contract's token facts on-chain: name, symbol, decimals, totalSupply, and mintable/pausable/maxTx/blacklist/tax signals from the verified source. Holder count and top holders are honestly reported as unavailable (no keyless public API provides them). Non-ERC-20 contracts are reported as not a token.",
    effect: "read",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["address", "chainId"],
      properties: {
        address: { type: "string", minLength: 42, maxLength: 42, description: "The 0x contract address to check, 40 hex characters." },
        chainId: { type: "integer", enum: [56, 1], description: "56 for BNB Smart Chain, 1 for Ethereum." },
      },
    },
    execute: ({ address, chainId }) => App.page.fetchTokenomicsFacts(address, chainId),
  });
  actions.register({
    name: "fetch_liquidity_facts",
    description: "Read a token's liquidity from DexScreener: trading pairs on the chain, liquidity in USD, price, and a best-effort LP burn check (share of LP tokens at burn addresses) on the top pair. Reports no pairs honestly when DexScreener has none.",
    effect: "read",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["address", "chainId"],
      properties: {
        address: { type: "string", minLength: 42, maxLength: 42, description: "The 0x token address to check, 40 hex characters." },
        chainId: { type: "integer", enum: [56, 1], description: "56 for BNB Smart Chain, 1 for Ethereum." },
      },
    },
    execute: ({ address, chainId }) => App.page.fetchLiquidityFacts(address, chainId),
  });
}
