import type { Transaction } from "../../types/index";
import { CheckCircle2, Clock, XCircle, Copy, ExternalLink } from "lucide-react";

interface HistoryProps {
  transactions: Transaction[];
}

function truncateAddress(address: string, start = 7, end = 5) {
  if (!address) return "";
  if (address.length <= start + end + 3) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

export default function WithdrawalHistory({ transactions }: HistoryProps) {
  const handleCopyAddress = (text: string) => {
    if (text) {
      navigator.clipboard.writeText(text);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "completed":
      case "approved":
      case "success":
        return "bg-[#0f2a1d] text-[#39ff88]";
      case "pending":
        return "bg-[#1a2428] text-yellow-400";
      case "rejected":
      case "failed":
        return "bg-[#2a1414] text-red-400";
      default:
        return "bg-[#1a1f28] text-gray-400";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case "completed":
      case "approved":
      case "success":
        return <CheckCircle2 className="h-3 w-3" />;
      case "pending":
        return <Clock className="h-3 w-3" />;
      case "rejected":
      case "failed":
        return <XCircle className="h-3 w-3" />;
      default:
        return <Clock className="h-3 w-3" />;
    }
  };

  if (transactions.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-xs text-gray-500">No withdrawal history yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
      {transactions.map((tx) => {
        const amount = typeof tx.amount === "string" ? parseFloat(tx.amount) : tx.amount;
        const date = new Date(tx.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const time = new Date(tx.createdAt).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        });

        return (
          <div
            key={tx.id}
            className="bg-[#0a0d12] border border-[#1a1f28] rounded-xl p-4 flex items-center justify-between gap-4 hover:border-[#39ff88]/30 transition-all"
          >
            {/* Left: Icon + Details */}
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 flex-shrink-0 rounded-full bg-[#1a9e6a]/20 border border-[#1a9e6a] flex items-center justify-center text-sm font-bold text-[#39ff88]">
                {tx.coin.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="font-bold text-white text-sm">
                    ${amount.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-gray-500 font-medium">
                    {tx.coin}
                  </div>
                  <div className="text-[11px] text-gray-600">
                    {tx.network}
                  </div>
                </div>
                {tx.toAddress && (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-500 font-mono">
                      {truncateAddress(tx.toAddress)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyAddress(tx.toAddress!)}
                      className="text-gray-600 hover:text-[#39ff88] p-0.5 transition-colors flex-shrink-0"
                      title="Copy Address"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Status + Date */}
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <div
                className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 ${getStatusColor(
                  tx.status
                )}`}
              >
                {getStatusIcon(tx.status)}
                <span className="capitalize">{tx.status}</span>
              </div>
              <div className="text-[10px] text-gray-600 text-right">
                <div>{date}</div>
                <div>{time}</div>
              </div>
              {tx.txHash && (
                <a
                  href={`https://etherscan.io/tx/${tx.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] text-[#39ff88] hover:underline flex items-center gap-0.5 mt-1"
                >
                  View <ExternalLink className="h-2 w-2" />
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
