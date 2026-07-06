export default function Footer() {
  return (
    <footer id="support" className="relative z-10 border-t border-[#1a1f28] bg-[#0a0c14] px-4 py-12 md:px-8 lg:px-12">
      <div className="max-w-7xl mx-auto flex flex-col items-center justify-center text-center">
        
        {/* Support Header */}
        <h4 className="font-mono font-bold text-xs text-white mb-6 tracking-widest uppercase">
          Support
        </h4>
        
        {/* Contact Links */}
        <div className="flex flex-col sm:flex-row gap-6 sm:gap-12">
          
          {/* Email Link (Opens default email client) */}
          <a 
            href="mailto:aiscalpingprosupport@gmail.com" // Replace with your real email
            className="flex items-center gap-3 text-sm text-[#9ca3af] hover:text-[#00f0ff] font-light transition-colors group"
          >
            <svg className="h-5 w-5 text-[#5f6470] group-hover:text-[#00f0ff] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            aiscalpingprosupport@gmail.com
          </a>

          {/* WhatsApp Link (Opens WhatsApp web/app directly) */}
          <a 
            href="https://wa.me/+16813794445" // Replace with your phone number (include country code, no spaces or special characters)
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-3 text-sm text-[#9ca3af] hover:text-[#00f0ff] font-light transition-colors group"
          >
            <svg className="h-5 w-5 text-[#5f6470] group-hover:text-[#00f0ff] transition-colors" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-8.884 9.888-8.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.455 5.703 1.456h.004c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            +1 (681) 379-4445
          </a>
          
        </div>

      </div>
    </footer>
  );
}