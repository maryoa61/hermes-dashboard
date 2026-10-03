import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronUp } from 'lucide-react';

interface ThinkingBlockProps {
  reasoning: string;
  isStreaming?: boolean;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ reasoning, isStreaming = false }) => {
  // Auto-expand while streaming if empty, or keep user preference
  const [expanded, setExpanded] = useState<boolean>(true);

  if (!reasoning || reasoning.trim().length === 0) {
    if (!isStreaming) return null;
    return (
      <div className="my-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#001e26] border border-[#2aa198]/30 text-xs text-[#2aa198] animate-pulse">
        <Brain className="w-3.5 h-3.5 animate-spin text-[#ff7b25]" />
        <span>Thinking...</span>
      </div>
    );
  }

  const charCount = reasoning.length;

  return (
    <div className="my-2.5 rounded-xl border border-[#2aa198]/25 bg-[#001820]/90 overflow-hidden text-xs shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#00222a]/80 hover:bg-[#073642]/50 transition-colors text-left select-none"
      >
        <div className="flex items-center gap-2 text-[#2aa198]">
          <Brain className={`w-3.5 h-3.5 ${isStreaming ? 'animate-pulse text-[#ff7b25]' : 'text-[#2aa198]'}`} />
          <span className="font-semibold tracking-wide text-[#eee8d5] text-[11px] uppercase">
            {isStreaming ? 'Thinking...' : 'Reasoning Process'}
          </span>
          <span className="text-[10px] text-[#586e75] font-mono">
            ({charCount} chars)
          </span>
        </div>
        <div className="text-[#586e75]">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {expanded && (
        <div
          className="p-3 bg-[#00141a] border-t border-[#073642]/60 text-[#839496] font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto"
          dir="ltr"
        >
          {reasoning}
        </div>
      )}
    </div>
  );
};
