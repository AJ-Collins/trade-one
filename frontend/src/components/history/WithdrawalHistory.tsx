import { useState } from "react";
import type { Transaction } from "../../types/index";
import { Copy, Check, X, ExternalLink } from "lucide-react";
import { parseTransactionValues, getCryptoLogo, truncateAddress, getExplorerUrl } from "../../lib/transactionFormat";

interface HistoryProps {
  transactions: Transaction[];
}

export default function WithdrawalHistory({ transactions }: HistoryProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

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
    if (s === "COMPLETED" || s === "APPROVED" || s === "SUCCESS") return { label: "COMPLETED", color: "bg-[#0f2a1d] text-[#39ff88]" };
    if (s === "PENDING") return { label: "PENDING", color: "bg-[#1a2428] text-yellow-400" };
    return { label: "REJECTED", color: "bg-[#2a1414] text-red-400" };
  };

  if (transactions.length === 0) {
    return <p className="text-sm text-gray-500 py-12 text-center">No recent withdrawals found.</p>;
  }

  return (
    <>
      <div className="w-full space-y-1">
        {transactions.map((tx) => {
          const statusInfo = getStatusDisplay(tx.status);
          const { crypto, usd } = parseTransactionValues(tx.amount, tx.coin);

          const dateObj = new Date(tx.createdAt);
          const dateString = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          const timeString = dateObj.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

          const networkLabel = tx.network || `${tx.coin} Wallet`;

          return (
            <div
              key={tx.id}
              onClick={() => setSelectedTx(tx)}
              className="w-full flex items-center gap-3 py-3 px-2 hover:bg-white/[0.02] transition-colors rounded-xl cursor-pointer"
            >
              {/* Left: Logo */}
              <img
                src={getCryptoLogo(tx.coin)}
                alt={tx.coin}
                className="w-10 h-10 rounded-full shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/generic.png";
                }}
              />

              {/* Right: Details & Amounts (stacked row by row, no overlap) */}
              <div className="flex-1 flex flex-col min-w-0 gap-0.5">
                {/* Row 1: Title & Status */}
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-base">Withdrawal</span>
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded uppercase ${statusInfo.color}`}>
                    {statusInfo.label}
                  </span>
                </div>

                {/* Row 2: Network Label & USD Amount */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-gray-400 font-medium truncate">
                    {networkLabel}
                  </span>
                  <span className="font-bold text-[13px] text-[#ff4d6d] shrink-0">
                    -${usd}
                  </span>
                </div>

                {/* Row 3: Date/Time & Crypto Amount */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-gray-400 font-medium shrink-0">
                    {dateString} at {timeString}
                  </span>
                  <span
                    className="text-[11px] text-gray-400 font-medium truncate text-right"
                    title={`-${crypto} ${tx.coin}`}
                  >
                    -{crypto} {tx.coin}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Bottom Drawer / Modal */}
      {selectedTx && (() => {
        const { crypto, usd } = parseTransactionValues(selectedTx.amount, selectedTx.coin);
        return (
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
                  <h2 className="text-2xl font-black text-white leading-none">Withdrew<br/>{crypto} {selectedTx.coin}</h2>
                  <p className="text-sm text-gray-400 font-medium">
                    ≈ ${usd}
                  </p>
                </div>
              </div>

              <div className="w-full h-px bg-[#1a1f28] mb-6" />

              {/* Details Table */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400 font-medium">Amount</span>
                  <div className="text-right">
                    <div className="text-sm font-bold text-white">{crypto} {selectedTx.coin}</div>
                    <div className="text-xs text-gray-400 font-medium">≈ ${usd}</div>
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
                  <span className="text-sm text-gray-400 font-medium">Method</span>
                  <span className="text-sm font-bold text-white">
                    {selectedTx.network || selectedTx.coin}
                  </span>
                </div>
                <div className="w-full h-px bg-[#1a1f28]/50" />

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400 font-medium">Network</span>
                  <span className="text-sm font-bold text-white flex items-center gap-1.5">
                    <img src={getCryptoLogo(selectedTx.coin)} alt={selectedTx.coin} className="w-4 h-4 rounded-full" />
                    {selectedTx.network || `${selectedTx.coin} Network`}
                  </span>
                </div>
                <div className="w-full h-px bg-[#1a1f28]/50" />

                {selectedTx.toAddress && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400 font-medium">Withdrawal address</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white font-mono">{truncateAddress(selectedTx.toAddress, 8, 6)}</span>
                      <button onClick={(e) => handleCopy("drawer-addr", selectedTx.toAddress!, e)} className="text-gray-400 hover:text-white">
                        {copiedId === "drawer-addr" ? <Check className="w-4 h-4 text-[#39ff88]" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}
                {selectedTx.toAddress && <div className="w-full h-px bg-[#1a1f28]/50" />}

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400 font-medium">Date</span>
                  <span className="text-sm font-bold text-white text-right">
                    {new Date(selectedTx.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at {new Date(selectedTx.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                {selectedTx.txHash && (
                  <>
                    <div className="w-full h-px bg-[#1a1f28]/50" />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400 font-medium">Transaction ID</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white font-mono">{truncateAddress(selectedTx.txHash, 8, 6)}</span>
                        <button onClick={(e) => handleCopy("drawer-tx", selectedTx.txHash!, e)} className="text-gray-400 hover:text-white">
                          {copiedId === "drawer-tx" ? <Check className="w-4 h-4 text-[#39ff88]" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {(() => {
                              const explorerUrl = getExplorerUrl(selectedTx.coin, selectedTx.network, selectedTx.txHash);
                              return explorerUrl ? (
                                <a
                                  href={explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-8 w-full bg-[#1a1f28] hover:bg-[#252b38] text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
                                >
                                  View on blockchain explorer <ExternalLink className="w-4 h-4" />
                                </a>
                              ) : null;
                            })()}
            </div>
          </div>
        );
      })()}
    </>
  );
}