import { useState } from "react";
import { Link } from "react-router-dom";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#charts", label: "Charts" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#faq", label: "FAQ" },
  { href: "#support", label: "Support" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleNavClick = () => setMenuOpen(false);

  return (
    <>
      <header className="sticky top-0 z-50 flex items-center justify-between px-4 py-4 md:px-8 lg:px-12 border-b border-[#1a1f28] bg-[#0a0c14]/80 backdrop-blur-xl">
        
        {/* Left Side: Identity Frame & Structural Navigation */}
        <div className="flex items-center gap-12">
          <Link to="/" className="flex items-center gap-3 flex-shrink-0 group">
            {/* Rigid Terminal System Icon replacing standard imagery / adjusting constraints */}
            <div className="h-10 w-10">
              <img src="/logo-head.png" alt="AIscalpingPro" className="h-10 w-10" />
            </div>
            <div className="flex flex-col">
              <span className="font-mono font-black text-sm text-white tracking-wider uppercase leading-none">
                AIscalping<span className="text-[#00f0ff]">Pro</span>
              </span>
            </div>
          </Link>

          {/* Core System Navigation Links */}
          <nav className="hidden lg:flex items-center gap-2">
            {NAV_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="relative px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-white hover:text-[#00f0ff] border border-transparent hover:border-[#1a1f28] hover:bg-[#070712] rounded-sm transition-all group"
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        {/* Right Side: Environment Monitors & Core Actions */}
        <div className="flex items-center gap-4">

          {/* Primary Call to Action */}
          <Link to="/register" className="hidden sm:block">
            <button className="bg-[#39ff88] text-black font-mono font-black text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-[#2ed672] transition-colors shadow-[0_0_15px_rgba(57,255,136,0.15)] flex items-center gap-1.5 cursor-pointer">
              Get Started
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </Link>
          <Link to="/login" className="hidden sm:block">
            <button className="border border-[#1a1f28] text-white font-mono font-black text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:border-[#39ff88]/40 hover:bg-[#0a0c14]/80 backdrop-blur-sm transition-all duration-200 cursor-pointer">
              Sign In
            </button>
          </Link>

          {/* System Menu Toggle (Mobile Hamburger) */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="lg:hidden p-2 text-[#9ca3af] hover:text-white border border-[#1a1f28] bg-[#070712] rounded-sm transition-colors"
            aria-label="Toggle System Menu"
          >
            {menuOpen ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Mobile System Overlay Menu */}
      <div
        className={`lg:hidden sticky top-[65px] z-40 bg-[#0a0c14]/98 backdrop-blur-xl border-b border-[#1a1f28] overflow-hidden transition-all duration-300 ease-in-out ${
          menuOpen ? "max-h-[420px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <nav className="flex flex-col px-4 py-4 gap-1.5 bg-[#070712]/50">
          {NAV_LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              onClick={handleNavClick}
              className="font-mono text-xs font-bold uppercase tracking-wider text-[#9ca3af] hover:text-[#00f0ff] py-3.5 px-4 rounded-sm border border-[#1a1f28]/30 bg-[#0a0c14] hover:border-[#1a1f28] transition-colors"
            >
              {label}
            </a>
          ))}
          
          {/* Action Blocks for Smaller Interface Nodes */}
          <div className="mt-4 pt-4 border-t border-[#1a1f28]/60 flex flex-col gap-2.5">
            <Link 
              to="/login" 
              onClick={handleNavClick} 
              className="w-full text-center text-white font-mono font-bold text-xs uppercase tracking-widest py-3.5 rounded-sm bg-[#0a0c14] border border-[#1a1f28] hover:border-[#9ca3af]/40 transition-colors"
            >
              Sign In
            </Link>
            <Link 
              to="/register" 
              onClick={handleNavClick} 
              className="w-full text-center bg-[#39ff88] text-black font-mono font-black text-xs uppercase tracking-widest py-3.5 rounded-sm hover:bg-[#2ed672] transition-colors flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(57,255,136,0.15)]"
            >
              Get Started
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </Link>
          </div>
        </nav>
      </div>
    </>
  );
}