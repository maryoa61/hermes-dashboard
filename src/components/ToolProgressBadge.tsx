import React, { useState } from 'react';
import { Wrench, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { ToolProgressItem } from '../types/hermes';

interface ToolProgressBadgeProps {
  progressList: ToolProgressItem[];
  isActive?: boolean;
}

export const ToolProgressBadge: React.FC<ToolProgressBadgeProps> = ({ progressList, isActive = false }) => {
  const [expanded, setExpanded] = useState(false);

  if (!progressList || progressList.length === 0) {
    if (!isActive) return null;
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#073642]/80 border border-[#2aa198]/30 text-xs text-[#2aa198] animate-pulse my-2">
        <Terminal className="w-3.5 h-3.5 animate-spin" />
        <span>Initializing agent tool...</span>
      </div>
    );
  }

  const latest = progressList[progressList.length - 1];

  return (
    <div className="my-2 border border-[#073642] rounded-lg bg-[#001e26]/90 overflow-hidden text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#073642]/40 hover:bg-[#073642]/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2 text-[#2aa198]">
          <Wrench className={`w-3.5 h-3.5 ${isActive ? 'animate-bounce text-[#ff7b25]' : ''}`} />
          <span className="font-mono font-medium truncate max-w-[220px] sm:max-w-md">
            {isActive ? 'Tool running: ' : 'Tools executed: '}
            <span className="text-[#eee8d5]">{latest.message}</span>
          </span>
          {progressList.length > 1 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#073642] text-[10px] text-[#93a1a1]">
              +{progressList.length - 1}
            </span>
          )}
        </div>
        <div className="text-[#586e75]">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {expanded && (
        <div className="p-2 space-y-1.5 border-t border-[#073642] max-h-48 overflow-y-auto font-mono text-[11px] text-[#839496] bg-[#00141a]" dir="ltr">
          {progressList.map((item, idx) => (
            <div key={item.id || idx} className="flex items-start gap-2 py-1 px-1.5 rounded hover:bg-[#073642]/30">
              <span className="text-[#586e75] select-none text-[10px]">
                {new Date(item.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="text-[#2aa198] flex-1 break-all">{item.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
