import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutGrid, History, ArrowDownToLine, ArrowUpFromLine,
  Bot, Wallet, User, LogOut, Menu, X,
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import api from "../../lib/api";

const NAV_ITEMS = [
  { to: "/welcome", label: "Dashboard", icon: LayoutGrid },
  { to: "/trade", label: "Bots", icon: Bot },
  { to: "/deposit", label: "Deposit", icon: ArrowDownToLine },
  { to: "/withdraw", label: "Withdraw", icon: ArrowUpFromLine },
  { to: "/trades", label: "Trades History", icon: History },
  { to: "/history", label: "History", icon: History },
];

export default function DashboardNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout, user } = useAuth();
  const location = useLocation();
  const { data: liveAccount } = useQuery({
    queryKey: ['accountBalance'],
    queryFn: async () => {
      const res = await api.get('/user/account/balance');
      return res.data;
    },
    refetchInterval: 10000,
    staleTime: 0,
  });

  const balance = liveAccount?.balance ?? user?.accounts?.find(a => a.type === "REAL")?.balance ?? 0;
  const currency = liveAccount?.currency ?? user?.accounts?.find(a => a.type === "REAL")?.currency ?? "USD";
  const realBalance = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(balance);

  return (
    <>
      {/* ── Top bar (all screens) ── */}
      <header className="sticky top-0 z-40 flex items-center gap-4 px-4 md:px-6 h-16 bg-[#05070a] border-b border-[#1a1f28]">
        {/* Mobile menu toggle */}
        <button
          onClick={() => setMobileOpen(true)}
          className="md:hidden text-gray-300 hover:text-white cursor-pointer"
        >
          <Menu className="h-6 w-6" />
        </button>

        <Link to="/" className="flex items-center gap-2 flex-shrink-0">
          <img src="/logo-head.png" alt="Logo" className="h-8 w-auto" />
        </Link>

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-1 ml-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-[#39ff88]/10 text-[#39ff88]"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-2 bg-[#0d0f17] border border-[#1a1f28] rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold">
            <Wallet className="h-4 w-4 text-[#39ff88]" />
            {realBalance}
          </div>
          <Link to="/profile" className="text-gray-400 hover:text-white cursor-pointer">
            <User className="h-5 w-5" />
          </Link>
          <button onClick={logout} className="text-gray-400 hover:text-[#ff4d6d] cursor-pointer">
            <LogOut className="h-5 w-5 text-[#ff4d6d]" />
          </button>
        </div>
      </header>

      {/* ── Mobile sidebar overlay ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 bg-[#05070a] border-r border-[#1a1f28] p-4 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <img src="/logo-head.png" alt="Logo" className="h-8 w-auto" />
              <button onClick={() => setMobileOpen(false)} className="text-gray-400">
                <X className="h-6 w-6" />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
                const active = location.pathname === to;
                return (
                  <Link
                    key={to}
                    to={to}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                      active
                        ? "bg-[#39ff88]/10 text-[#39ff88]"
                        : "text-gray-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}