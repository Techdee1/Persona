import { useEffect, useRef } from 'react';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const PIDGIN_TERMS = [
  'dey', 'na', 'omo', 'abeg', 'wahala', 'sha', 'sef', 'joor', 'nau', 'sabi',
  'wetin', 'dem', 'kai', 'ehn', 'mehn', 'oya', 'wey', 'una', 'chop', 'waka',
  'gist', 'taya', 'badt', 'padi', 'pepper', 'e don', 'no be', 'make e', 'do am',
];

function detectPidginTerms(text) {
  if (!text) return [];
  return PIDGIN_TERMS.filter(term => new RegExp(`\\b${term}\\b`, 'i').test(text));
}

function MetricBar({ label, sublabel, value, delay }) {
  const barRef = useRef(null);
  const color = value >= 80 ? '#22C55E' : value >= 60 ? '#F59E0B' : '#EF4444';

  useEffect(() => {
    if (!barRef.current || reduced) return;
    const el = barRef.current;
    el.style.width = '0%';
    const t = setTimeout(() => { el.style.width = `${value}%`; }, delay + 50);
    return () => clearTimeout(t);
  }, [value, delay]);

  return (
    <div className="mb-3">
      <div className="flex items-start gap-2.5 mb-1">
        <div className="w-32 shrink-0">
          <div className="text-xs text-[#64748B]">{label}</div>
          {sublabel && <div className="text-[9px] text-[#475569] leading-tight mt-0.5">{sublabel}</div>}
        </div>
        <div className="flex-1 h-1.5 bg-[#1E1E2E] rounded-sm overflow-hidden mt-1">
          <div
            ref={barRef}
            className="h-full rounded-sm"
            style={{
              background: color,
              width: reduced ? `${value}%` : '0%',
              transition: reduced ? 'none' : 'width 0.6s ease-out',
            }}
          />
        </div>
        <span className="text-xs w-8 text-right shrink-0" style={{ fontFamily: 'JetBrains Mono, monospace', color }}>{value}</span>
      </div>
    </div>
  );
}

export default function FidelityDashboard({ profile, output }) {
  if (!profile || !output) return null;

  const { stylometry, rating_stats, cultural_signals } = profile;
  const predicted = output.predicted_rating ?? 0;
  const reviewText = output.review_text ?? '';

  // Tone Match: compare generated review's vocab richness to user's historical baseline
  const genWords = reviewText.toLowerCase().match(/\b\w+\b/g) ?? [];
  const genVocabRichness = genWords.length > 0 ? new Set(genWords).size / genWords.length : 0;
  const profileVocabRichness = stylometry?.vocab_richness ?? 0;
  const toneMatch = profileVocabRichness > 0
    ? Math.max(0, Math.min(100, Math.round(100 - (Math.abs(genVocabRichness - profileVocabRichness) / profileVocabRichness) * 100)))
    : 50;

  const std = rating_stats?.std_dev ?? 1;
  const mean = rating_stats?.mean ?? 3;
  const ratingConsistency = Math.max(0, Math.round(100 - (Math.abs(predicted - mean) / (std || 1)) * 20));
  const culturalAccuracy = cultural_signals?.code_switching_detected ? 95
    : (cultural_signals?.nigerian_english_index ?? 0) > 0 ? 70 : 50;
  const avgWords = stylometry?.avg_word_count ?? 1;
  const reviewWords = reviewText.split(' ').filter(Boolean).length;
  const lengthFidelity = Math.max(0, Math.round(100 - (Math.abs(reviewWords - avgWords) / (avgWords || 1)) * 100));

  const overall = Math.round((toneMatch + ratingConsistency + culturalAccuracy + lengthFidelity) / 4);
  const overallColor = overall >= 80 ? '#22C55E' : overall >= 60 ? '#F59E0B' : '#EF4444';

  const detectedTerms = detectPidginTerms(reviewText);

  return (
    <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold text-[#F8FAFC]">Behavioural Fidelity</span>
        <div className="flex items-baseline gap-0.5">
          <span className="text-3xl font-bold" style={{ fontFamily: 'JetBrains Mono, monospace', color: overallColor }}>{overall}</span>
          <span className="text-sm text-[#64748B]">/100</span>
        </div>
      </div>

      {[
        { label: 'Tone Match',          sublabel: 'vocab richness vs profile baseline', value: toneMatch },
        { label: 'Rating Consistency',  sublabel: 'predicted vs user mean ± std dev',   value: ratingConsistency },
        { label: 'Cultural Accuracy',   sublabel: 'Nigerian register alignment',         value: culturalAccuracy },
        { label: 'Length Fidelity',     sublabel: 'word count vs avg review length',     value: lengthFidelity },
      ].map((m, i) => (
        <MetricBar key={m.label} label={m.label} sublabel={m.sublabel} value={m.value} delay={i * 100} />
      ))}

      {detectedTerms.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[#1E1E2E]">
          <div className="text-[10px] text-[#64748B] uppercase tracking-widest mb-2">Detected Pidgin Terms</div>
          <div className="flex flex-wrap gap-1.5">
            {detectedTerms.map(term => (
              <span
                key={term}
                className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)', color: '#818CF8' }}
              >
                {term}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="text-[11px] text-[#64748B] mt-3 italic">
        Computed against user's psychological profile
      </div>
    </div>
  );
}
