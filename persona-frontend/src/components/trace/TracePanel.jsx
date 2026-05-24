import { useState, useEffect } from 'react';
import { BrainCircuit, Volume2, VolumeX } from 'lucide-react';
import { useSpeech } from '../../lib/useSpeech';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const TRACE_LAYER_MAP = [
  { pattern: /rating|star|score|mean|calibrat/i,      label: 'Rating Calibration', color: '#F59E0B' },
  { pattern: /cultural|nigerian|pidgin|code.switch/i, label: 'Cultural Signal',    color: '#22C55E' },
  { pattern: /trajector|drift|trend|recent/i,         label: 'Trajectory',         color: '#6366F1' },
  { pattern: /style|vocab|word|length|sentence/i,     label: 'Stylometry',         color: '#818CF8' },
  { pattern: /keyword|food|service|price|atmospher/i, label: 'Value Keywords',     color: '#F59E0B' },
];

function getLayerTag(clause) {
  for (const { pattern, label, color } of TRACE_LAYER_MAP) {
    if (pattern.test(clause)) return { label, color };
  }
  return null;
}

function JsonBox({ data }) {
  const str = JSON.stringify(data, null, 2);
  return (
    <div className="bg-[#0A0A0F] rounded-lg px-3 py-2.5 text-[11px] max-h-48 overflow-auto mt-2"
      style={{ fontFamily: 'JetBrains Mono, monospace' }}>
      {str.split('\n').map((line, i) => {
        const km = line.match(/^(\s*)("[\w\s]+")\s*:/);
        const vm = line.match(/:\s*(".*"|[\d.]+|true|false|null)/);
        return (
          <div key={i}>
            {km ? (
              <>
                <span className="text-[#64748B]">{km[1]}</span>
                <span className="text-[#6366F1]">{km[2]}</span>
                <span className="text-[#64748B]">: </span>
                {vm ? <span className="text-[#F59E0B]">{vm[1]}</span>
                  : <span className="text-[#64748B]">{line.slice(km[0].length)}</span>}
              </>
            ) : <span className="text-[#64748B]">{line}</span>}
          </div>
        );
      })}
    </div>
  );
}

function AgentStep({ step, index }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="pl-7 relative mb-4"
      style={{
        opacity: 0,
        animation: reduced ? 'none' : 'fadeSlideIn 0.3s ease forwards',
        animationDelay: reduced ? '0ms' : `${index * 300}ms`,
      }}
    >
      <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-[#6366F1] flex items-center justify-center">
        <span className="text-white text-[8px] font-bold">✓</span>
      </div>
      <button
        onClick={() => setOpen(o => !o)}
        className="bg-transparent border-none p-0 text-left w-full cursor-pointer"
        aria-label={`Toggle step ${index + 1} details`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#F8FAFC]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            Step {index + 1} — {step.tool}
          </span>
          <span className="text-[11px] text-[#22C55E]">✓</span>
          <ChevronDownIcon open={open} />
        </div>
      </button>
      <div className="text-xs text-[#64748B] mt-0.5">{step.thought}</div>
      {open && <JsonBox data={step.result} />}
    </div>
  );
}

function ChevronDownIcon({ open }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function TracePanel({ trace, mode, steps = [], loading }) {
  const [raw, setRaw] = useState(false);
  const { speak, stop, speaking } = useSpeech();

  useEffect(() => () => window.speechSynthesis.cancel(), []);

  if (loading) {
    return (
      <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5">
        <div className="skeleton h-3.5 w-1/2 mb-3" />
        <div className="skeleton h-3 mb-2" />
        <div className="skeleton h-3 w-4/5 mb-2" />
        <div className="skeleton h-3 w-3/5" />
      </div>
    );
  }

  const isEmpty = mode === 'text' ? !trace : steps.length === 0;
  if (isEmpty) {
    return (
      <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5 flex flex-col items-center justify-center min-h-[140px] gap-2.5">
        <BrainCircuit size={32} color="#1E1E2E" />
        <span className="text-[#64748B] text-sm">Reasoning trace will appear after simulation.</span>
      </div>
    );
  }

  if (mode === 'agent') {
    return (
      <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5">
        <div className="text-sm font-semibold text-[#F8FAFC] mb-4">Agent Trace</div>
        <div className="relative">
          <div className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-[#6366F1] opacity-40" />
          {steps.map((step, i) => <AgentStep key={i} step={step} index={i} />)}
        </div>
      </div>
    );
  }

  const clauses = trace ? trace.split('; ').filter(Boolean) : [];

  const handleSpeak = () => {
    if (speaking) { stop(); return; }
    speak(clauses.join('. '));
  };

  return (
    <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3.5">
        <span className="text-sm font-semibold text-[#F8FAFC]">Reasoning Trace</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSpeak}
            aria-label={speaking ? 'Stop reading trace' : 'Read trace aloud'}
            className="bg-transparent border-none cursor-pointer flex items-center gap-1 text-[11px] transition-colors duration-200"
            style={{ color: speaking ? '#F59E0B' : '#64748B' }}
          >
            {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
            {speaking ? 'Stop' : 'Read aloud'}
          </button>
          <button
            onClick={() => setRaw(r => !r)}
            aria-label="Toggle raw trace view"
            className="bg-transparent border border-[#1E1E2E] rounded-md text-[#64748B] text-[11px] px-2 py-0.5 cursor-pointer"
          >
            {raw ? 'bullets' : '[raw]'}
          </button>
        </div>
      </div>
      {raw ? (
        <pre className="text-[11px] text-[#64748B] bg-[#0A0A0F] rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words m-0"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {trace}
        </pre>
      ) : (
        <div className="flex flex-col gap-2">
          {clauses.map((clause, i) => {
            const tag = getLayerTag(clause);
            return (
              <div
                key={i}
                className="border-l-4 border-[#6366F1] pl-3"
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  opacity: 0,
                  animation: reduced ? 'none' : 'fadeSlideX 0.3s ease forwards',
                  animationDelay: reduced ? '0ms' : `${i * 120}ms`,
                }}
              >
                {tag && (
                  <span
                    className="text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded mr-2"
                    style={{ background: `${tag.color}18`, color: tag.color, border: `1px solid ${tag.color}40` }}
                  >
                    {tag.label}
                  </span>
                )}
                <span className="text-xs text-[#F8FAFC]">{clause}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
