import { useState } from 'react';
import {
  COLD_START_QUESTIONS,
  OPTION_LABELS,
  buildProfileFromAnswers,
  generatePreviewRecords,
} from '../../lib/cold-start-engine';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function ColdStartInline({ onComplete }) {
  const [current, setCurrent]   = useState(0);
  const [answers, setAnswers]   = useState([]);
  const [selected, setSelected] = useState(null);
  const [building, setBuilding] = useState(false);
  const [done, setDone]         = useState(false);

  const total    = COLD_START_QUESTIONS.length;
  const q        = COLD_START_QUESTIONS[current];
  const progress = ((current + 1) / total) * 100;

  const handleSelect = (option) => {
    if (selected !== null) return;
    setSelected(option);

    const newAnswers = [...answers, { question_id: q.id, answer: option }];
    setAnswers(newAnswers);

    setTimeout(() => {
      if (current + 1 < total) {
        setCurrent(c => c + 1);
        setSelected(null);
      } else {
        setBuilding(true);
        setTimeout(() => {
          const profile = buildProfileFromAnswers(newAnswers);
          const records = generatePreviewRecords(newAnswers);
          setBuilding(false);
          setDone(true);
          onComplete(profile, records);
        }, 800);
      }
    }, 380);
  };

  if (done) {
    return (
      <div
        className="bg-[#0A0A0F] border border-[#22C55E] rounded-xl p-4 mt-2"
        style={{ animation: reduced ? 'none' : 'fadeSlideIn 0.3s ease' }}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">✅</span>
          <span className="text-sm text-[#22C55E] font-semibold">Profile built from your answers</span>
        </div>
      </div>
    );
  }

  if (building) {
    return (
      <div
        className="bg-[#0A0A0F] border border-[#1E1E2E] rounded-xl p-4 mt-2"
        style={{ animation: reduced ? 'none' : 'fadeSlideIn 0.3s ease' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 border-[#6366F1] border-t-transparent animate-spin shrink-0" />
          <span className="text-sm text-[#64748B]">Building your profile...</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-[#0A0A0F] border border-[#1E1E2E] rounded-xl p-4 mt-2"
      style={{ animation: reduced ? 'none' : 'fadeSlideIn 0.3s ease' }}
    >
      {/* Progress */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-[#64748B] uppercase tracking-widest">
          Question {current + 1} of {total}
        </span>
        <span className="text-[10px] text-[#6366F1]">{Math.round(progress)}%</span>
      </div>
      <div className="h-1 bg-[#1E1E2E] rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-[#6366F1] rounded-full"
          style={{ width: `${progress}%`, transition: reduced ? 'none' : 'width 300ms ease' }}
        />
      </div>

      {/* Question bubble */}
      <div
        className="text-sm text-[#F8FAFC] mb-3 leading-relaxed"
        style={{ animation: reduced ? 'none' : 'fadeSlideIn 0.25s ease' }}
        key={current}
      >
        {q.question}
      </div>

      {/* Option chips */}
      <div className="flex flex-wrap gap-2">
        {q.options.map(opt => {
          const isSelected = selected === opt;
          return (
            <button
              key={opt}
              onClick={() => handleSelect(opt)}
              disabled={selected !== null}
              aria-pressed={isSelected}
              className="rounded-full px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:cursor-default transition-all duration-200"
              style={{
                border: `1px solid ${isSelected ? '#6366F1' : '#1E1E2E'}`,
                background: isSelected ? '#6366F1' : '#1E1E2E',
                color: isSelected ? '#fff' : '#94A3B8',
              }}
            >
              {isSelected && <span>✓</span>}
              {OPTION_LABELS[opt] ?? opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
