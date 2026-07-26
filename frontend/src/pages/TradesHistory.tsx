import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";

const statusStyles: Record<string, string> = {
  PROFIT: "bg-emerald-500/15 text-emerald-400",
  LOSS: "bg-red-500/15 text-red-400",
  RUNNING: "bg-amber-500/15 text-amber-400",
  CANCELLED: "bg-gray-500/15 text-gray-400",
};

const ITEMS_PER_PAGE = 10;

interface Trade {
  id: string;
  user: string;
  asset: string;
  type: string;
  stake: number;
  payout: number;
  profit: number;
  entryPrice: number;
  exitPrice: number;
  status: string;
  startTime: string;
  endTime: string | null;
  createdAt: string;
}

export default function TradesHistory() {
  const [currentPage, setCurrentPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["user-trades", currentPage],
    queryFn: async () => {
      const { data } = await api.get("/user/trades", {
        params: {
          page: currentPage,
          limit: ITEMS_PER_PAGE,
        },
      });
      return data as { trades: Trade[]; total: number; totalPages: number; page: number };
    },
  });

  const trades = data?.trades ?? [];
  const totalItems = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <h1 className="text-2xl font-black text-white mb-1">Trades</h1>
      <p className="text-sm text-gray-400 mb-6">All your platform trade activity.</p>

      {/* Main Container */}
      <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-xl overflow-hidden">

        {/* 1. LOADING STATE */}
        {isLoading ? (
          <>
            {/* Mobile Skeleton */}
            <div className="md:hidden divide-y divide-[#1a1f28] p-4 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-3 pt-4 first:pt-0 animate-pulse">
                  <div className="flex justify-between items-center">
                    <div className="h-4 bg-[#1a1f28] rounded w-28" />
                    <div className="h-5 bg-[#1a1f28] rounded w-16" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="h-3 bg-[#1a1f28] rounded w-12" />
                    <div className="h-3 bg-[#1a1f28] rounded w-12 animate-delay-75" />
                    <div className="h-3 bg-[#1a1f28] rounded w-12 justify-self-end" />
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop Skeleton */}
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1f28] text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Stake</th>
                  <th className="px-4 py-3">Payout</th>
                  <th className="px-4 py-3">P&L</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#1a1f28]">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-[#1a1f28] rounded animate-pulse w-20" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : trades.length > 0 ? (
          <>
            {/* 2. MOBILE CARD VIEW (Visible below 768px) */}
            <div className="md:hidden divide-y divide-[#1a1f28]">
              {trades.map((t) => {
                const displayStatus =
                    t.status === "COMPLETED"
                      ? t.profit >= 0
                        ? "PROFIT"
                        : "LOSS"
                      : t.status === "RUNNING"
                        ? "RUNNING"
                        : "CANCELLED";
                return (
                  <div key={t.id} className="p-4 space-y-3 hover:bg-white/[0.01] transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-base">{t.asset}</span>
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${t.type === "BUY" ? "bg-[#39ff88]/10 text-[#39ff88]" : "bg-[#ff4d6d]/10 text-[#ff4d6d]"}`}>
                          {t.type}
                        </span>
                      </div>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${statusStyles[displayStatus]}`}>
                        {displayStatus}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs border-t border-[#1a1f28]/50 pt-2">
                      <div>
                        <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Stake</p>
                        <p className="text-gray-300 font-medium">${t.stake.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">Payout</p>
                        <p className="text-gray-300 font-medium">${t.payout.toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500 text-[10px] uppercase tracking-wider mb-0.5">P&L</p>
                        <p className={`font-bold ${t.profit >= 0 ? "text-[#39ff88]" : "text-[#ff4d6d]"}`}>
                          {t.profit >= 0 ? "+" : ""}${t.profit.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 3. DESKTOP TABLE VIEW (Visible above 768px) */}
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a1f28] text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Stake</th>
                  <th className="px-4 py-3">Payout</th>
                  <th className="px-4 py-3">P&L</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const displayStatus =
                    t.status === "COMPLETED"
                      ? t.profit >= 0
                        ? "PROFIT"
                        : "LOSS"
                      : t.status === "RUNNING"
                        ? "RUNNING"
                        : "CANCELLED";
                  return (
                    <tr key={t.id} className="border-b border-[#1a1f28] last:border-0 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 font-semibold text-white">{t.asset}</td>
                      <td className={`px-4 py-3 font-bold text-xs ${t.type === "BUY" ? "text-[#39ff88]" : "text-[#ff4d6d]"}`}>
                        {t.type}
                      </td>
                      <td className="px-4 py-3 text-gray-300">${t.stake.toFixed(2)}</td>
                      <td className="px-4 py-3 text-gray-300">${t.payout.toFixed(2)}</td>
                      <td className={`px-4 py-3 font-semibold ${t.profit >= 0 ? "text-[#39ff88]" : "text-[#ff4d6d]"}`}>
                        {t.profit >= 0 ? "+" : ""}${t.profit.toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${statusStyles[displayStatus]}`}>
                          {displayStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          /* 4. EMPTY STATE */
          <div className="text-center py-12 text-gray-500 text-sm">
            No trades found.
          </div>
        )}

        {/* 5. RESPONSIVE PAGINATION */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t border-[#1a1f28] bg-[#090b11]">
          <div className="text-xs text-gray-400 order-2 sm:order-1">
            Showing{" "}
            <span className="text-white font-medium">
              {totalItems === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}
            </span>{" "}
            to{" "}
            <span className="text-white font-medium">
              {Math.min(currentPage * ITEMS_PER_PAGE, totalItems)}
            </span>{" "}
            of <span className="text-white font-medium">{totalItems}</span> trades
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto order-1 sm:order-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              className="p-1.5 flex-1 sm:flex-none flex justify-center rounded border border-[#1a1f28] text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-gray-400 px-3 whitespace-nowrap">
              Page <span className="text-white font-medium">{currentPage}</span> of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="p-1.5 flex-1 sm:flex-none flex justify-center rounded border border-[#1a1f28] text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}