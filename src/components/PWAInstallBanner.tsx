import React, { useState } from 'react';
import { Download, Share, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallBannerProps {
  compact?: boolean;
}

export const PWAInstallBanner: React.FC<PWAInstallBannerProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already installed in standalone mode, hide
  if (isInstalled) {
    return null;
  }

  if (compact) {
    if (isInstallable) {
      return (
        <button
          onClick={install}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#ff7b25] hover:bg-[#e06818] text-white text-xs font-medium shadow-sm transition-all"
          title="Install Hermes PWA to Home Screen"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Install</span>
        </button>
      );
    }
    if (isIOS) {
      return (
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#073642] hover:bg-[#0e4a57] text-[#eee8d5] text-xs font-medium border border-[#2aa198]/30 transition-all"
          title="Install on iOS"
        >
          <Smartphone className="w-3.5 h-3.5 text-[#ff7b25]" />
          <span className="hidden sm:inline">iOS Install</span>
        </button>
      );
    }
    return null;
  }

  // Full banner mode (e.g. on settings or dashboard)
  return (
    <>
      {isInstallable && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-gradient-to-r from-[#073642] to-[#002b36] border border-[#ff7b25]/40 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#ff7b25]/20 text-[#ff7b25]">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#eee8d5]">Install Mobile App</div>
              <div className="text-xs text-[#839496]">Fast full-screen launch, offline shell, low latency</div>
            </div>
          </div>
          <button
            onClick={install}
            className="px-3.5 py-2 rounded-lg bg-[#ff7b25] hover:bg-[#e06818] text-white text-xs font-medium transition shadow-md flex items-center gap-1.5 cursor-pointer"
          >
            <span>Install</span>
          </button>
        </div>
      )}

      {isIOS && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#073642]/60 border border-[#2aa198]/30">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#2aa198]/20 text-[#2aa198]">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#eee8d5]">Add to iPhone Home Screen</div>
              <div className="text-xs text-[#839496]">Pin to Home Screen for fullscreen native feel</div>
            </div>
          </div>
          <button
            onClick={() => setShowIOSGuide(true)}
            className="px-3 py-1.5 rounded-lg bg-[#002b36] hover:bg-[#073642] text-[#2aa198] text-xs font-medium border border-[#2aa198]/40"
          >
            Guide
          </button>
        </div>
      )}

      {/* iOS instructions modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-[#073642] border border-[#2aa198]/40 p-5 shadow-2xl text-[#eee8d5]">
            <div className="flex items-center justify-between pb-3 border-b border-[#002b36]">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-[#ff7b25]" />
                Install on iPhone / iPad
              </h3>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="p-1 rounded-md text-[#839496] hover:text-white hover:bg-[#002b36]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="py-4 space-y-3 text-xs leading-relaxed text-[#93a1a1]">
              <div className="flex items-start gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#ff7b25] text-white font-bold text-[10px]">1</span>
                <span>Tap the <strong className="text-white">Share</strong> button <Share className="w-3.5 h-3.5 inline mx-0.5 text-[#2aa198]" /> at the bottom of Safari.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#ff7b25] text-white font-bold text-[10px]">2</span>
                <span>Scroll down and select <strong className="text-white">Add to Home Screen</strong>.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#ff7b25] text-white font-bold text-[10px]">3</span>
                <span>Tap <strong className="text-white">Add</strong> in the top-right corner to finish.</span>
              </div>
            </div>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2 rounded-lg bg-[#002b36] hover:bg-[#0e4a57] text-[#eee8d5] text-xs font-medium border border-[#073642] transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
