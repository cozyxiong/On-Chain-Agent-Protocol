import { fromBaseUnits, listTokens, resolveToken } from "../tokens/tokenRegistry.js";

const BALANCE_OF_SELECTOR = "0x70a08231";
const AGENT_PERMISSIONS_SELECTOR = "0x3b0b14cf";

export function createWalletQueryService(options = {}) {
  const rpcUrl = options.rpcUrl ?? process.env.SEPOLIA_RPC_URL;

  return {
    async balances(input) {
      assertAddress(input.address, "address");
      const requestedTokens = normalizeTokenList(input.tokens);
      const balances = [];

      for (const tokenInput of requestedTokens) {
        const token = resolveToken(tokenInput);
        const raw = token.native
          ? await rpc(rpcUrl, "eth_getBalance", [input.address, "latest"])
          : await erc20BalanceOf(rpcUrl, token.address, input.address);

        const baseUnits = BigInt(raw).toString();
        balances.push({
          symbol: token.symbol,
          address: token.address,
          decimals: token.decimals,
          raw: baseUnits,
          formatted: fromBaseUnits(baseUnits, token.decimals)
        });
      }

      return {
        address: input.address,
        chainId: 11155111,
        balances
      };
    },

    async agentPermission(input) {
      assertAddress(input.smartAccount, "smartAccount");
      assertAddress(input.agent, "agent");
      const data = `${AGENT_PERMISSIONS_SELECTOR}${padAddress(input.agent)}`;
      const result = await rpc(rpcUrl, "eth_call", [{ to: input.smartAccount, data }, "latest"]);
      const words = splitWords(result);
      return {
        smartAccount: input.smartAccount,
        agent: input.agent,
        active: BigInt(`0x${words[0]}`) !== 0n,
        target: `0x${words[1].slice(24)}`,
        maxValueWei: BigInt(`0x${words[2]}`).toString(),
        validUntil: Number(BigInt(`0x${words[3]}`))
      };
    }
  };
}

async function erc20BalanceOf(rpcUrl, tokenAddress, owner) {
  const data = `${BALANCE_OF_SELECTOR}${padAddress(owner)}`;
  return rpc(rpcUrl, "eth_call", [{ to: tokenAddress, data }, "latest"]);
}

async function rpc(rpcUrl, method, params) {
  if (!rpcUrl) {
    const error = new Error("SEPOLIA_RPC_URL is required");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });
  const payload = await response.json();
  if (payload.error) {
    const error = new Error(payload.error.message ?? `${method} failed`);
    error.statusCode = 500;
    throw error;
  }
  return payload.result;
}

function normalizeTokenList(tokens) {
  if (!tokens || (Array.isArray(tokens) && tokens.length === 0)) {
    return listTokens().map((token) => token.symbol);
  }
  return Array.isArray(tokens) ? tokens : [tokens];
}

function splitWords(hex) {
  const clean = String(hex ?? "").replace(/^0x/, "").padEnd(64 * 4, "0");
  return clean.match(/.{1,64}/g) ?? [];
}

function padAddress(address) {
  return String(address).toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function assertAddress(value, field) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value ?? "")) {
    const error = new Error(`${field} must be an EVM address`);
    error.statusCode = 400;
    throw error;
  }
}
