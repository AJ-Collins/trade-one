import { useState } from "react";
import { Search, Wallet, Clock, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Copy, Check, XCircle, ArrowUpRight, PlusCircle, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";

const statusStyles: Record<string, string> = {
  CREDITED:  "bg-emerald-500/15 text-emerald-400",
  SWEPT:     "bg-blue-500/15 text-blue-400",
  PENDING:   "bg-amber-500/15 text-amber-400",
  CONFIRMED: "bg-yellow-500/15 text-yellow-400",
  FAILED:    "bg-rose-500/15 text-rose-400",
};

const statusIcons: Record<string, React.ReactNode> = {
  CREDITED:  <CheckCircle2 className="h-3 w-3" />,
  SWEPT:     <ArrowUpRight className="h-3 w-3" />,
  PENDING:   <Clock className="h-3 w-3" />,
  CONFIRMED: <Clock className="h-3 w-3" />,
  FAILED:    <XCircle className="h-3 w-3" />,
};

const ITEMS_PER_PAGE = 10;

interface Deposit {
  id: string;
  user: string;
  coin: string;
  network: string;
  amount: number;
  usdValue: number;
  status: string;
  txHash: string;
  sweptTx: string | null;
  sweptAt: string | null;
  address: string;
  creditedAt: string | null;
  createdAt: string;
}

function truncate(str: string, len = 10) {
  if (!str) return "—";
  if (str.length <= len) return str;
  return `${str.slice(0, 6)}...${str.slice(-4)}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-gray-600 hover:text-white transition-colors ml-1"
    >
      {copied ? <Check className="h-3 w-3 text-[#39ff88]" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export default function AdminDepositsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [backfillModal, setBackfillModal] = useState(false);
  const [backfillForm, setBackfillForm] = useState({ network: 'eth_mainnet', txHashes: '' });
  const [backfillResults, setBackfillResults] = useState<any[] | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setCurrentPage(1);
    clearTimeout((window as any)._depositSearchTimer);
    (window as any)._depositSearchTimer = setTimeout(() => {
      setDebouncedSearch(e.target.value);
    }, 400);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["admin-deposits", debouncedSearch, currentPage],
    queryFn: async () => {
      const { data } = await api.get("/admin/deposits", {
        params: {
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          page: currentPage,
          limit: ITEMS_PER_PAGE,
        },
      });
      return data as { deposits: Deposit[]; total: number; totalPages: number };
    },
    refetchInterval: 15000,
  });

  const { data: stats } = useQuery({
    queryKey: ["admin-deposit-stats"],
    queryFn: async () => {
      const { data } = await api.get("/admin/deposits/stats");
      return data;
    },
    refetchInterval: 15000,
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/deposits/${id}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
      queryClient.invalidateQueries({ queryKey: ["admin-deposit-stats"] });
      setRetryingId(null);
    },
    onError: (e: any) => {
      alert(e?.response?.data?.error || "Retry failed");
      setRetryingId(null);
    },
  });

  const deposits = data?.deposits ?? [];
  const totalItems = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const backfillMutation = useMutation({
    mutationFn: (data: { network: string; txHashes: string }) => {
      const hashes = data.txHashes
        .split(/[,\s\n]+/)
        .map(h => h.trim())
        .filter(h => h.length > 0);
      return api.post('/admin/deposits/backfill', {
        network: data.network,
        txHashes: hashes,
      });
    },
    onSuccess: (res) => {
      setBackfillResults(res.data.results);
      setBackfillError(null);
      queryClient.invalidateQueries({ queryKey: ["admin-deposits"] });
      queryClient.invalidateQueries({ queryKey: ["admin-deposit-stats"] });
    },
    onError: (e: any) => {
      setBackfillError(e?.response?.data?.error || 'Backfill failed');
      setBackfillResults(null);
    },
  });

  const resetModal = () => {
    setBackfillModal(false);
    setBackfillForm({ network: 'eth_mainnet', txHashes: '' });
    setBackfillResults(null);
    setBackfillError(null);
  };

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-1">Deposits</h1>
      <p className="text-sm text-gray-400 mb-6">All deposit transactions and sweep status.</p>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Volume", value: stats ? `$${Number(stats.totalVolume).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—", icon: Wallet, color: "text-[#39ff88]" },
          { label: "Pending", value: stats?.pending ?? "—", icon: Clock, color: "text-[#f6ad55]" },
          { label: "Credited", value: stats?.credited ?? "—", icon: CheckCircle2, color: "text-[#7f9cf5]" },
          { label: "Failed", value: stats?.failed ?? "—", icon: XCircle, color: "text-[#ff4d6d]" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-[#0d0f17] border border-[#1a1f28] rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
              <Icon className={`h-4 w-4 ${color}`} /> {label}
            </div>
            <div className={`text-xl md:text-2xl font-black ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Sweep Progress Banner */}
      {stats && stats.credited > 0 && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-300">
              <span className="text-white font-bold">{stats.credited}</span> deposits credited,{" "}
              <span className="text-white font-bold">{stats.swept}</span> swept to hot wallet
            </span>
          </div>
          <div className="text-xs text-gray-500">Sweeper runs every 2 min</div>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input
            value={search}
            onChange={handleSearchChange}
            type="text"
            placeholder="Search by user email..."
            className="w-full bg-[#0d0f17] border border-[#1a1f28] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-[#39ff88]/40"
          />
        </div>
        <button
          onClick={() => setBackfillModal(true)}
          className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 font-bold text-xs px-3 py-2 rounded-lg transition whitespace-nowrap"
        >
          <PlusCircle className="h-4 w-4" />
          Backfill
        </button>
      </div>

      {/* Table */}
      <div className="bg-[#0d0f17] border border-[#1a1f28] rounded-xl overflow-x-auto min-h-[800px]">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-[#1a1f28] text-left text-gray-500 text-xs uppercase tracking-wider">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Coin / Network</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">USD Value</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Tx Hash</th>
              <th className="px-4 py-3">Sweep Tx</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-[#1a1f28]">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-3 bg-[#1a1f28] rounded animate-pulse w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : deposits.length > 0 ? (
              deposits.map((d) => (
                <tr key={d.id} className="border-b border-[#1a1f28] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-white text-xs truncate max-w-[130px]">{d.user}</td>
                  <td className="px-4 py-3">
                    <div className="text-white font-semibold text-xs">{d.coin}</div>
                    <div className="text-gray-500 text-[10px]">{d.network}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-300 text-xs">
                    {d.amount.toFixed(6)} {d.coin}
                  </td>
                  <td className="px-4 py-3 text-[#39ff88] font-semibold text-xs">
                    ${d.usdValue.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded flex items-center gap-1 w-fit ${statusStyles[d.status] ?? statusStyles.PENDING}`}>
                      {statusIcons[d.status]}
                      {d.status === 'SWEPT' ? 'SWEPT ✓' : d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                    <div className="flex items-center">
                      {truncate(d.txHash)}
                      {d.txHash && <CopyButton text={d.txHash} />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                    {d.sweptTx ? (
                      <div className="flex items-center">
                        <span className="text-blue-400">{truncate(d.sweptTx)}</span>
                        <CopyButton text={d.sweptTx} />
                      </div>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {(d.status === 'FAILED' || d.status === 'PENDING') && (
                      <button
                        onClick={() => { setRetryingId(d.id); retryMutation.mutate(d.id); }}
                        disabled={retryMutation.isPending && retryingId === d.id}
                        className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${retryMutation.isPending && retryingId === d.id ? 'animate-spin' : ''}`} />
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="text-center py-8 text-gray-500 text-sm">
                  No deposits found.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#1a1f28] bg-[#090b11]">
          <div className="text-xs text-gray-400">
            Showing{" "}
            <span className="text-white font-medium">
              {totalItems === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}
            </span>{" "}
            to{" "}
            <span className="text-white font-medium">
              {Math.min(currentPage * ITEMS_PER_PAGE, totalItems)}
            </span>{" "}
            of <span className="text-white font-medium">{totalItems}</span> deposits
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded border border-[#1a1f28] text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-40 transition"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-gray-400 px-1">
              Page <span className="text-white font-medium">{currentPage}</span> of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded border border-[#1a1f28] text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-40 transition"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      {backfillModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0d0f17] border border-[#1a1f28] w-full max-w-lg rounded-xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-lg font-bold text-white">Deposit Backfill</h3>
              <p className="text-xs text-gray-400 mt-1">
                Enter transaction hashes (one per line, max 20) to parse and credit any missed deposits.
              </p>
            </div>

            {backfillError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
                {backfillError}
              </div>
            )}

            {backfillResults && (
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-white">Results</h4>
                {backfillResults.map((r, i) => (
                  <div key={i} className={`border rounded-lg p-3 space-y-1 ${
                    r.status === 'credited' ? 'bg-emerald-500/10 border-emerald-500/20' :
                    r.status === 'already_credited' ? 'bg-amber-500/10 border-amber-500/20' :
                    r.status === 'no_match' ? 'bg-blue-500/10 border-blue-500/20' :
                    'bg-red-500/10 border-red-500/20'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-white truncate max-w-[200px]">{r.txHash}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        r.status === 'credited' ? 'text-emerald-400 bg-emerald-500/20' :
                        r.status === 'already_credited' ? 'text-amber-400 bg-amber-500/20' :
                        r.status === 'no_match' ? 'text-blue-400 bg-blue-500/20' :
                        'text-red-400 bg-red-500/20'
                      }`}>
                        {r.status.replace('_', ' ')}
                      </span>
                    </div>
                    {r.error && <p className="text-[10px] text-red-400 mt-1">{r.error}</p>}
                    {r.credits?.map((c: any, j: number) => (
                      <div key={j} className="text-[11px] text-gray-300 mt-2 font-mono bg-black/20 p-2 rounded">
                        <span className="text-[#39ff88]">+${c.usdValue.toFixed(2)}</span> ({c.amount} {c.symbol}) → {c.userId}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {!backfillResults && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                    Network
                  </label>
                  <select
                    value={backfillForm.network}
                    onChange={e => setBackfillForm(f => ({ ...f, network: e.target.value }))}
                    className="w-full bg-[#05070a] border border-[#1a1f28] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-[#39ff88]/40"
                  >
                    <option value="eth_mainnet">Ethereum Mainnet</option>
                    <option value="bsc_mainnet">BSC Mainnet</option>
                    <option value="polygon_mainnet">Polygon Mainnet</option>
                    <option value="arbitrum_mainnet">Arbitrum Mainnet</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">
                    Transaction Hashes (one per line)
                  </label>
                  <textarea
                    rows={5}
                    placeholder="0xb5f206db4aee...&#10;0xfa49208ad9b8..."
                    value={backfillForm.txHashes}
                    onChange={e => setBackfillForm(f => ({ ...f, txHashes: e.target.value }))}
                    className="w-full bg-[#05070a] border border-[#1a1f28] rounded-lg px-3 py-2 text-xs text-white font-mono outline-none focus:border-[#39ff88]/40 resize-y"
                  />
                  <p className="text-[10px] text-gray-600 mt-1">Supports up to 20 transactions per request.</p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={resetModal} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition">
                {backfillResults ? 'Close' : 'Cancel'}
              </button>
              {!backfillResults && (
                <button
                  onClick={() => backfillMutation.mutate(backfillForm)}
                  disabled={
                    backfillMutation.isPending ||
                    !backfillForm.network ||
                    !backfillForm.txHashes.trim()
                  }
                  className="bg-amber-500 text-[#05070a] font-bold text-sm px-4 py-2 rounded-lg hover:bg-amber-400 flex items-center gap-2 disabled:opacity-50 transition"
                >
                  {backfillMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {backfillMutation.isPending ? 'Processing...' : 'Run Backfill'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}