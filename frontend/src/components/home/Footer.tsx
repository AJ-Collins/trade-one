import React from "react";

const LINKS = {
  Product: ["Features", "Charts", "Pricing"],
};

export default function Footer() {
  return (
    <footer id="support" className="relative z-10 border-t border-slate-900 bg-[#06070d] px-6 py-16 md:px-12 lg:px-16 overflow-hidden">
      {/* Subtle top ambient glow line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#00f0ff]/40 to-transparent" />

      <div className="max-w-7xl mx-auto">
        {/* Main Footer Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-10 md:gap-8 lg:gap-12 mb-16">
          
          {/* Column 1: Brand Identity (Spans 2 columns on medium screens+) */}
          <div className="flex flex-col col-span-1 sm:col-span-2 md:col-span-2 space-y-5">
            <a href="#" className="flex items-center gap-2.5 group w-fit transition-transform duration-300 hover:scale-[1.02]">
              <img 
                src="/logo.png" 
                alt="AIscalpingPro Logo" 
                className="h-9 w-auto object-contain opacity-90 group-hover:opacity-100 transition-opacity" 
              />
            </a>
            
            <p className="text-xs md:text-sm text-slate-400 font-light leading-relaxed max-w-sm">
              High-frequency, low-latency AI automated scalping protocols engineered for modern algorithmic trading environments.
            </p>
            
            {/* Social Channels */}
            <div className="flex items-center gap-2 pt-2">
              {[
                {
                  id: "x",
                  icon: (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  )
                },
                {
                  id: "linkedin",
                  icon: (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                    </svg>
                  )
                },
                {
                  id: "youtube",
                  icon: (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.136z"/>
                    </svg>
                  )
                }
              ].map(({ id, icon }) => (
                <a
                  key={id}
                  href="#"
                  className="h-9 w-9 rounded-md bg-slate-950 border border-slate-900 flex items-center justify-center text-slate-500 hover:text-white hover:border-[#00f0ff]/30 hover:bg-slate-900/50 transition-all duration-200"
                >
                  {icon}
                </a>
              ))}
            </div>
          </div>

          {/* Columns 2 & 3: Dynamic Link Navigation Matrix */}
          {Object.entries(LINKS).map(([group, items]) => (
            <div key={group} className="col-span-1">
              <h4 className="font-mono font-semibold text-[11px] text-slate-200 mb-5 tracking-[0.15em] uppercase">
                {group}
              </h4>
              <ul className="space-y-3.5">
                {items.map((item) => (
                  <li key={item}>
                    <a 
                      href="#" 
                      className="text-xs text-slate-400 hover:text-[#00f0ff] font-light transition-all duration-200 block hover:translate-x-0.5 transform-gpu"
                    >
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Column 4: Dedicated Support Matrix (Spans 2 columns on desktop to fill visual space) */}
          <div className="col-span-1 sm:col-span-2 md:col-span-2">
            <h4 className="font-mono font-semibold text-[11px] text-slate-200 mb-5 tracking-[0.15em] uppercase">
              Support
            </h4>
            <div className="space-y-3.5">
              {/* Email Link */}
              <a 
                href="mailto:aiscalpingprosupport@gmail.com"
                className="flex items-center gap-3 text-xs text-slate-400 hover:text-[#00f0ff] font-light transition-all duration-200 group block hover:translate-x-0.5 transform-gpu"
              >
                <svg className="h-4 w-4 text-slate-600 group-hover:text-[#00f0ff] transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span className="truncate">aiscalpingprosupport@gmail.com</span>
              </a>

              {/* WhatsApp Link */}
              <a 
                href="https://wa.me/+16813794445"
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-3 text-xs text-slate-400 hover:text-[#00f0ff] font-light transition-all duration-200 group block hover:translate-x-0.5 transform-gpu"
              >
                <svg className="h-4 w-4 text-slate-600 group-hover:text-[#00f0ff] transition-colors shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-8.884 9.888-8.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.455 5.703 1.456h.004c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                <span>+1 (681) 379-4445</span>
              </a>
            </div>
          </div>

        </div>

        {/* Bottom Sub-Footer Bar */}
        <div className="border-t border-slate-900/60 pt-8 flex flex-col sm:flex-row items-center justify-center">
          <p className="text-[11px] text-slate-500 font-light">
            &copy; {new Date().getFullYear()} AIscalpingPro. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}