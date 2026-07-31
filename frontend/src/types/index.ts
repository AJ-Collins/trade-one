export type UserRole = "USER" | "ADMIN";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  referralRate: number;
  kycStatus: "UNVERIFIED" | "PENDING" | "VERIFIED";
  idDocument: string | null;
  accounts: FinancialAccount[];
  createdAt: string;
}

export interface FinancialAccount {
  id: string;
  type: "DEMO" | "REAL";
  balance: number;
  currency: string;
  createdAt: string;
}

export interface ExchangeAccount {
  id: number;
  name: string;
  exchange: string;
  apiKey: string;
  isPaper: boolean;
  createdAt: string;
}

export interface Bot {
  id: number;
  name: string;
  template: string;
  status: "running" | "stopped";
  settings: string;
  baseCurrency: string;
  quoteCurrency: string;
  exchangeAccountId: number;
  exchangeAccount?: ExchangeAccount;
  orders?: Order[];
  logs?: BotLog[];
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: number;
  botId: number;
  exchangeOrderId?: string;
  side: "buy" | "sell";
  type: "limit" | "market";
  status: "pending" | "filled" | "cancelled";
  price?: number;
  quantity: number;
  filledQty: number;
  symbol: string;
  createdAt: string;
}

export interface BotLog {
  id: number;
  botId: number;
  message: string;
  level: "info" | "warn" | "error";
  createdAt: string;
}

export interface MarketTicker {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  sparkline: number[]; // array of recent prices for the mini chart
}

export interface MarketSummary {
  totalVolume: number;
  topGainer: MarketTicker;
  topLoser: MarketTicker;
}

// types.ts
export interface Network {
  name: string;
  fee: number;
}

export interface CryptoAsset {
  id: string;
  name: string;
  symbol: string;
  networks: Network[];
}

export interface Transaction {
  id: string;
  coin: string;
  network: string;
  amount: string | number;
  status: string;
  txHash?: string | null;
  createdAt: string;
  usdValueAtCredit?: string | number | null;
  toAddress?: string;
}

export interface KYCDocument {
  id: string;
  type: string;
  fileName: string;
  uploadedAt: string;
}

export interface KYCSubmission {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  submittedAt: string;
  reviewedAt?: string;
  adminNotes?: string;
  documents: KYCDocument[];
}

export interface KYCStatus {
  status: "UNVERIFIED" | "PENDING" | "VERIFIED";
  lastSubmission?: KYCSubmission;
}

// Data Array mapped to match your exact image constraints and CDN links
export const CRYPTO_OPTIONS: CryptoAsset[] = [
  { 
    id: "USDT", 
    name: "Tether", 
    symbol: "USDT", 
    networks: [
      { name: "Tron (TRC20)", fee: 1.00 },
      { name: "Ethereum (ERC20)", fee: 12.00 },
      { name: "BSC (BEP20)", fee: 0.30 },
      { name: "Polygon", fee: 0.15 },
      { name: "Arbitrum", fee: 0.40 },
      { name: "Optimism", fee: 0.40 }
    ] 
  },
  { 
    id: "BTC", 
    name: "Bitcoin", 
    symbol: "BTC", 
    networks: [
      { name: "Native Bitcoin", fee: 2.50 },
      { name: "Lightning Network", fee: 0.05 }
    ] 
  },
  { 
    id: "ETH", 
    name: "Ethereum", 
    symbol: "ETH", 
    networks: [
      { name: "Ethereum (ERC20)", fee: 8.00 },
      { name: "Base Network", fee: 0.10 },
      { name: "Arbitrum One", fee: 0.25 }
    ] 
  },
  { 
    id: "USDC", 
    name: "USD Coin", 
    symbol: "USDC", 
    networks: [
      { name: "Ethereum (ERC20)", fee: 8.00 },
      { name: "BSC (BEP20)", fee: 0.30 },
      { name: "Tron (TRC20)", fee: 1.00 }
    ] 
  },
];