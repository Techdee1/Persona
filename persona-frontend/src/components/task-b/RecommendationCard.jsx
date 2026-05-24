import { useState, useEffect } from 'react';
import { ChevronDown, Volume2, VolumeX } from 'lucide-react';
import { useSpeech } from '../../lib/useSpeech';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function truncateAtWord(text, limit = 100) {
  if (!text || text.length <= limit) return text ?? '';
  return text.slice(0, text.lastIndexOf(' ', limit)) + '…';
}

// Extract axis mentions from explanation text e.g. "food axis · weight 0.62"
function extractAxes(explanation) {
  if (!explanation) return [];
  const matches = [...explanation.matchAll(/(\w[\w\s]*?)\s+axis[^·]*·\s*weight\s*([\d.]+)/gi)];
  return matches.map(m => ({ name: m[1].trim(), weight: parseFloat(m[2]) })).slice(0, 3);
}

function StarRow({ stars }) {
  if (!stars) return null;
  const full = Math.round(stars);
  const color = full >= 4 ? '#22C55E' : full >= 3 ? '#F59E0B' : '#EF4444';
  return (
    <div className="flex items-center gap-1 mb-2">
      <span style={{ color, fontSize: 13 }}>
        {'★'.repeat(full)}{'☆'.repeat(Math.max(0, 5 - full))}
      </span>
      <span className="text-xs" style={{ color, fontFamily: 'JetBrains Mono, monospace' }}>
        {Number(stars).toFixed(1)}
      </span>
    </div>
  );
}

export default function RecommendationCard({ item, rank, animationDelay, agentMode = false, agentStepIndex = null }) {
  const [open, setOpen] = useState(false);
  const { speak, stop, speaking } = useSpeech();

  useEffect(() => () => window.speechSynthesis.cancel(), []);

  const rawName     = item.metadata?.name;
  const categories  = item.metadata?.categories?.split(', ').filter(Boolean) ?? [];
  const stars       = item.metadata?.stars ?? 0;
  const reviewCount = item.metadata?.review_count;
  const scorePct    = Math.round(Math.min(1, Math.max(0, item.score)) * 100);
  const isPreview   = rawName && rawName.length > 20;
  const displayName = rawName ?? `Business #${rank}`;
  const axes        = extractAxes(item.explanation);

  const handleSpeak = () => {
    if (speaking) { stop(); return; }
    speak(`Top recommendation: ${displayName}. ${stars ? stars + ' stars.' : ''} ${truncateAtWord(item.explanation ?? '')}`);
  };

  return (
    <div
      className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-4"
      style={{
        opacity: 0,
        animation: reduced ? 'none' : 'fadeSlideIn 0.35s ease forwards',
        animationDelay: reduced ? '0ms' : `${animationDelay}ms`,
      }}
    >
      {/* Rank + match score */}
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-6 h-6 rounded-full bg-[#F59E0B] flex items-center justify-center text-[11px] font-bold text-[#0A0A0F] shrink-0">
          #{rank}
        </div>
        <span className="text-[10px] text-[#64748B] uppercase tracking-widest">Match Score</span>
        {agentMode && agentStepIndex !== null && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full ml-1"
            style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#818CF8' }}>
            Agent step {agentStepIndex + 1}
          </span>
        )}
        <span className="text-[11px] ml-auto shrink-0"
          style={{ fontFamily: 'JetBrains Mono, monospace', color: '#6366F1' }}>
          {scorePct}%
        </span>
      </div>
      <div className="h-1.5 bg-[#1E1E2E] rounded-sm overflow-hidden mb-3">
        <div className="h-full bg-[#6366F1] rounded-sm"
          style={{ width: `${scorePct}%`, transition: reduced ? 'none' : 'width 0.6s ease' }} />
      </div>

      {/* Business name */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="text-base font-semibold text-[#F8FAFC]">
          {isPreview ? `Business #${rank}` : displayName}
        </div>
        {rank === 1 && (
          <button onClick={handleSpeak}
            aria-label={speaking ? 'Stop reading recommendation' : 'Read recommendation aloud'}
            className="bg-transparent border-none cursor-pointer shrink-0 transition-colors duration-200"
            style={{ color: speaking ? '#F59E0B' : '#64748B' }}>
            {speaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        )}
      </div>

      {/* Categories */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {categories.map(cat => (
            <span key={cat} className="bg-[#0A0A0F] border border-[#1E1E2E] rounded-full px-2 py-0.5 text-[11px] text-[#64748B]">
              {cat}
            </span>
          ))}
        </div>
      )}

      <StarRow stars={stars} />

      {/* Matched axes — surface from explanation */}
      {axes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {axes.map(a => (
            <span key={a.name} className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#F59E0B' }}>
              {a.name} · {(a.weight * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      )}

      {/* Review preview */}
      {isPreview && (
        <>
          <div className="text-[10px] text-[#64748B] uppercase tracking-widest mb-1">Review Preview</div>
          <div className="text-sm text-[#F8FAFC] leading-relaxed mb-2 italic"
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
            "{truncateAtWord(displayName)}"
          </div>
        </>
      )}

      {reviewCount > 0 && (
        <div className="text-[11px] text-[#64748B] mb-2.5">
          {reviewCount} review{reviewCount !== 1 ? 's' : ''} in dataset
        </div>
      )}

      {/* Explanation accordion */}
      <button onClick={() => setOpen(o => !o)} aria-label="Toggle explanation"
        className="w-full bg-transparent border-none pt-1.5 flex items-center justify-between cursor-pointer border-t border-[#1E1E2E]">
        <span className="text-xs text-[#64748B]">Why this was recommended</span>
        <ChevronDown size={14} color="#64748B"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {open && (
        <div className="bg-[#0A0A0F] rounded-b-lg px-3 py-2.5 border-l-4 border-[#6366F1] mt-1 text-[11px] text-[#64748B]"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {item.explanation}
        </div>
      )}
    </div>
  );
}
