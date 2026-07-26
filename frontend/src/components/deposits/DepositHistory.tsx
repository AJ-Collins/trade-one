import { useState } from "react";
import { History, CheckCircle, Clock, XCircle, Copy, Check, X, ExternalLink } from "lucide-react";

interface DepositItem {
  id: string;
  coin: string;
  network: string;
  amount: string | number;
  usdValueAtCredit: string | number | null;
  status: "CREDITED" | "PENDING" | "CONFIRMED" | "SWEPT" | "FAILED";
  txHash: string;
  createdAt: string;
}

const getCryptoLogo = (symbol: string) => {
  const map: Record<string, string> = {
    USDT: "usdt",
    BTC: "btc",
    ETH: "eth",
    BNB: "bnb",
    USDC: "usdc",
    TRX: "trx",
    TON: "ton",
    SOL: "sol",
    MATIC: "matic",
  };
  const key = map[symbol?.toUpperCase()] || "generic";
  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${key}.png`;
};

function truncateHash(hash: string, start = 7, end = 4) {
  if (!hash) return "—";
  if (hash.length <= start + end + 3) return hash;
  return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}

export default function DepositHistory({ history }: { history: DepositItem[] }) {
  const [selectedTx, setSelectedTx] = useState<DepositItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (id: string, text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const getStatusDisplay = (status: string) => {
    const s = status.toUpperCase();
    if (s === "SWEPT" || s === "CREDITED" || s === "COMPLETED" || s === "CONFIRMED") return { label: "COMPLETED", color: "bg-[#0f2a1d] text-[#39ff88]" };
    if (s === "PENDING") return { label: "PENDING", color: "bg-[#1a2428] text-yellow-400" };
    return { label: "FAILED", color: "bg-[#2a1414] text-red-400" };
  };

  return (
    <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-xl p-5 space-y-4 w-full max-w-md mx-auto">
      <h3 className="text-sm font-bold text-white flex items-center gap-2">
        <History className="h-4 w-4 text-gray-400" /> Deposit History
      </h3>

      {history.length === 0 ? (
        <p className="text-xs text-gray-500 py-2">No historical deposit records found.</p>
      ) : (
        <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
          {history.map((item) => {
            const statusInfo = getStatusDisplay(item.status);
            const usd = item.usdValueAtCredit ? Number(item.usdValueAtCredit) : null;
            
            const dateObj = new Date(item.createdAt);
            const dateString = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            const timeString = dateObj.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            
            const networkLabel = item.network || `${item.coin} Wallet`;

            return (
              <div
                key={item.id}
                onClick={() => setSelectedTx(item)}
                className="w-full flex items-center justify-between gap-3 py-3 px-2 hover:bg-white/[0.02] transition-colors rounded-xl cursor-pointer"
              >
                {/* Left: Logo & Details */}
                <div className="flex items-center gap-3">
                  <img 
                    src={getCryptoLogo(item.coin)} 
                    alt={item.coin} 
                    className="w-10 h-10 rounded-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/generic.png";
                    }}
                  />
                  
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-base">Deposit</span>
                      <span className={`text-[10px] font-black px-1.5 py-0.5 rounded uppercase ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-400 font-medium">
                      {networkLabel} <span className="mx-1">•</span> {dateString} at {timeString}
                    </div>
                  </div>
                </div>

                {/* Right: Amounts */}
                <div className="flex flex-col items-end gap-0.5 text-right">
                  <span className="font-bold text-base text-[#39ff88]">
                    +${usd ? usd.toFixed(2) : Number(item.amount).toFixed(2)}
                  </span>
                  <span className="text-[11px] text-gray-400 font-medium">
                    +{Number(item.amount)} {item.coin}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Bottom Drawer / Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedTx(null)}>
          <div 
            className="w-full sm:max-w-md bg-[#0d0f17] sm:border border-[#1a1f28] rounded-t-3xl sm:rounded-2xl p-6 sm:p-8 animate-slideUp sm:animate-fadeIn relative"
            onClick={e => e.stopPropagation()}
          >
            <button onClick={() => setSelectedTx(null)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
            
            {/* Header */}
            <div className="flex flex-col items-start gap-4 mb-6">
              <img 
                src={getCryptoLogo(selectedTx.coin)} 
                alt={selectedTx.coin} 
                className="w-12 h-12 rounded-full"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/generic.png";
                }}
              />
              <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-black text-white leading-none">Deposited<br/>{Number(selectedTx.amount)} {selectedTx.coin}</h2>
                <p className="text-sm text-gray-400 font-medium">
                  ≈ ${selectedTx.usdValueAtCredit ? Number(selectedTx.usdValueAtCredit).toFixed(2) : Number(selectedTx.amount).toFixed(2)}
                </p>
              </div>
            </div>
            
            <div className="w-full h-px bg-[#1a1f28] mb-6" />
            
            {/* Details Table */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400 font-medium">Amount</span>
                <div className="text-right">
                  <div className="text-sm font-bold text-white">{Number(selectedTx.amount)} {selectedTx.coin}</div>
                  <div className="text-xs text-gray-400 font-medium">≈ ${selectedTx.usdValueAtCredit ? Number(selectedTx.usdValueAtCredit).toFixed(2) : Number(selectedTx.amount).toFixed(2)}</div>
                </div>
              </div>
              <div className="w-full h-px bg-[#1a1f28]/50" />
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400 font-medium">Status</span>
                <span className={`text-[11px] font-black px-2 py-0.5 rounded uppercase ${getStatusDisplay(selectedTx.status).color}`}>
                  {getStatusDisplay(selectedTx.status).label}
                </span>
              </div>
              <div className="w-full h-px bg-[#1a1f28]/50" />

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400 font-medium">Network</span>
                <span className="text-sm font-bold text-white flex items-center gap-1.5">
                  <img src={getCryptoLogo(selectedTx.coin)} alt={selectedTx.coin} className="w-4 h-4 rounded-full" />
                  {selectedTx.network || selectedTx.coin}
                </span>
              </div>
              <div className="w-full h-px bg-[#1a1f28]/50" />

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400 font-medium">Date</span>
                <span className="text-sm font-bold text-white text-right">
                  {new Date(selectedTx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at {new Date(selectedTx.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="w-full h-px bg-[#1a1f28]/50" />

              {selectedTx.txHash && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400 font-medium">Transaction ID</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white font-mono">{truncateHash(selectedTx.txHash, 8, 8)}</span>
                    <button onClick={(e) => handleCopy("drawer-tx", selectedTx.txHash!, e)} className="text-gray-400 hover:text-white">
                      {copiedId === "drawer-tx" ? <Check className="w-4 h-4 text-[#39ff88]" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button className="mt-8 w-full bg-[#1a1f28] hover:bg-[#252b38] text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm">
              View on blockchain explorer <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}