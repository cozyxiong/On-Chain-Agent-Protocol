const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

export const SEPOLIA_TOKENS = Object.freeze({
  ETH: {
    chainId: 11155111,
    symbol: "ETH",
    address: NATIVE_TOKEN,
    decimals: 18,
    native: true
  },
  WETH: {
    chainId: 11155111,
    symbol: "WETH",
    address: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    decimals: 18,
    native: false
  },
  USDC: {
    chainId: 11155111,
    symbol: "USDC",
    address: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    decimals: 6,
    native: false
  }
});

export function resolveToken(symbolOrAddress, options = {}) {
  if (typeof symbolOrAddress !== "string" || symbolOrAddress.trim() === "") {
    badRequest("Token is required");
  }

  const chainId = options.chainId ?? 11155111;
  const tokenKey = symbolOrAddress.trim().toUpperCase();
  const known = SEPOLIA_TOKENS[tokenKey];

  if (known) {
    if (known.chainId !== chainId) {
      badRequest(`Token ${tokenKey} is not configured for chain ${chainId}`);
    }
    return known;
  }

  if (/^0x[a-fA-F0-9]{40}$/.test(symbolOrAddress)) {
    return {
      chainId,
      symbol: symbolOrAddress,
      address: symbolOrAddress,
      decimals: options.decimals ?? 18,
      native: symbolOrAddress.toLowerCase() === NATIVE_TOKEN
    };
  }

  badRequest(`Unsupported token: ${symbolOrAddress}`);
}

export function toBaseUnits(amount, decimals) {
  if (typeof amount !== "string" && typeof amount !== "number") {
    badRequest("Amount must be a decimal string or number");
  }

  const raw = String(amount);
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    badRequest("Amount must be a positive decimal");
  }

  const [whole, fraction = ""] = raw.split(".");
  if (fraction.length > decimals) {
    badRequest(`Amount has more than ${decimals} decimals`);
  }

  return `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}

export function fromBaseUnits(amount, decimals) {
  const raw = String(amount);
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function listTokens() {
  return Object.values(SEPOLIA_TOKENS);
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}
