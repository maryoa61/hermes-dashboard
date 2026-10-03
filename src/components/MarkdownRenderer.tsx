import React, { useMemo, useState } from 'react';
import { marked } from 'marked';
import { Check, Copy } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

// Basic HTML sanitizer to prevent XSS when rendering markdown
function sanitizeHtml(html: string): string {
  // Strip dangerous script, iframe, object, embed tags
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '');
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Parse code blocks vs regular markdown
  const parts = useMemo(() => {
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    const segments: Array<{ type: 'markdown' | 'code'; content: string; lang?: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        segments.push({
          type: 'markdown',
          content: content.substring(lastIndex, match.index),
        });
      }
      segments.push({
        type: 'code',
        lang: match[1] || 'bash',
        content: match[2].trimEnd(),
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      segments.push({
        type: 'markdown',
        content: content.substring(lastIndex),
      });
    }

    return segments;
  }, [content]);

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <div className="space-y-3 leading-relaxed text-sm md:text-base break-words">
      {parts.map((part, idx) => {
        if (part.type === 'code') {
          return (
            <div
              key={idx}
              dir="ltr"
              className="my-3 rounded-lg overflow-hidden border border-[#073642] bg-[#001e26] text-[#839496] font-mono text-xs md:text-sm text-left shadow-md"
            >
              <div className="flex items-center justify-between px-3 py-1.5 bg-[#073642]/60 border-b border-[#073642] text-[11px] text-[#93a1a1]">
                <span className="font-semibold uppercase tracking-wider text-[#2aa198]">{part.lang}</span>
                <button
                  onClick={() => handleCopy(part.content, idx)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#002b36] text-[#93a1a1] hover:text-[#eee8d5] transition-colors"
                  title="Copy code"
                >
                  {copiedIndex === idx ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 overflow-x-auto whitespace-pre leading-5">
                <code>{part.content}</code>
              </pre>
            </div>
          );
        }

        // Standard Markdown section
        const parsedHtml = sanitizeHtml(
          marked.parse(part.content, {
            breaks: true,
            gfm: true,
          }) as string
        );

        return (
          <div
            key={idx}
            className="prose prose-invert max-w-none prose-p:my-1.5 prose-headings:text-[#eee8d5] prose-headings:my-2 prose-a:text-[#2aa198] prose-a:underline hover:prose-a:text-[#ff7b25] prose-strong:text-[#eee8d5] prose-code:text-[#ff7b25] prose-code:bg-[#073642]/60 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-[0.9em] prose-code:dir-ltr prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5"
            dangerouslySetInnerHTML={{ __html: parsedHtml }}
          />
        );
      })}
    </div>
  );
};
