export const MOCK_RATES: Record<string, number> = {
  BTC: 64500,
  ETH: 3450,
  BNB: 590,
  SOL: 145,
  TON: 7.5,
  MATIC: 0.65,
  TRX: 0.12,
  USDT: 1.0,
  USDC: 1.0,
};

/**
 * Intelligent helper to handle both types of backends safely:
 * 1. If backend amount is already crypto (e.g. "0.01" BTC), use it as crypto and calculate USD.
 * 2. If backend amount is USD (e.g. "698" dollars worth), convert it to crypto.
 */
export const parseTransactionValues = (rawAmount: string | number, coin: string) => {
  const numAmount = Number(rawAmount);
  const upperCoin = coin?.toUpperCase() || "";
  const rate = MOCK_RATES[upperCoin] || 1;

  const isLikelyUsdAmount =
    (upperCoin === "BTC" && numAmount > 2) ||
    (upperCoin === "ETH" && numAmount > 10) ||
    (upperCoin === "SOL" && numAmount > 50) ||
    (upperCoin === "BNB" && numAmount > 20) ||
    upperCoin === "USDT" ||
    upperCoin === "USDC";

  if (isLikelyUsdAmount && upperCoin !== "USDT" && upperCoin !== "USDC") {
    const usd = numAmount;
    const cryptoVal = usd / rate;
    const crypto = rate === 1 ? cryptoVal.toFixed(2) : parseFloat(cryptoVal.toFixed(8));
    return { crypto, usd: usd.toFixed(2) };
  } else if (upperCoin === "USDT" || upperCoin === "USDC") {
    return { crypto: numAmount.toFixed(2), usd: numAmount.toFixed(2) };
  } else {
    const crypto = rate === 1 ? numAmount.toFixed(2) : numAmount;
    const usdVal = numAmount * rate;
    return { crypto, usd: usdVal.toFixed(2) };
  }
};

export const getCryptoLogo = (symbol: string) => {
  const map: Record<string, string> = {
    USDT: "usdt", BTC: "btc", ETH: "eth", BNB: "bnb", USDC: "usdc",
    TRX: "trx", TON: "ton", SOL: "sol", MATIC: "matic",
  };
  const key = map[symbol?.toUpperCase()] || "generic";
  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${key}.png`;
};

export function truncateAddress(address: string, start = 6, end = 4) {
  if (!address) return "—";
  if (address.length <= start + end + 3) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

// Returns the block explorer URL for a given coin/network + tx hash.
// Falls back to a best-guess based on coin if network string doesn't match cleanly.
export const getExplorerUrl = (
  coin: string,
  network: string | null | undefined,
  txHash: string | null | undefined
): string | null => {
  if (!txHash) return null;
  const c = coin?.toUpperCase() || "";
  const n = (network || "").toUpperCase();

  // BTC
  if (c === "BTC") return `https://mempool.space/tx/${txHash}`;

  // TRON
  if (c === "TRX" || n.includes("TRON") || n.includes("TRC20")) {
    return `https://tronscan.org/#/transaction/${txHash}`;
  }

  // BNB Smart Chain
  if (c === "BNB" || n.includes("BSC") || n.includes("BEP20")) {
    return `https://bscscan.com/tx/${txHash}`;
  }

  // Polygon
  if (c === "MATIC" || n.includes("POLYGON")) {
    return `https://polygonscan.com/tx/${txHash}`;
  }

  // Solana
  if (c === "SOL" || n.includes("SOLANA")) {
    return `https://solscan.io/tx/${txHash}`;
  }

  // TON
  if (c === "TON") {
    return `https://tonscan.org/tx/${txHash}`;
  }

  // ETH + ERC20 tokens (ETH, USDT-ERC20, USDC-ERC20, default fallback)
  return `https://etherscan.io/tx/${txHash}`;
};