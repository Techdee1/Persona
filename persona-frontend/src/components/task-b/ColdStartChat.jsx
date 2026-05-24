import { useState, useEffect } from 'react';
import { getColdStartQuestions, answerColdStart } from '../../lib/api';
import { useToast } from '../layout/Toast';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const OPTION_LABELS = {
  top_marks:            '⭐ I give full marks freely',
  reserve_top:          '🎯 I reserve top ratings for the best',
  food_quality:         '🍽️ Food quality',
  service:              '🤝 Service',
  price_value:          '💰 Price & value',
  atmosphere:           '✨ Atmosphere',
  brief_and_direct:     '✍️ Brief and direct',
  detailed_and_thorough:'📝 Detailed and thorough',
  yes_often:            '🇳🇬 Yes, often',
  sometimes:            'Sometimes',
  rarely:               'Rarely or never',
};

export default function ColdStartChat({ onProfileBuilt }) {
  const { showToast } = useToast();
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getColdStartQuestions()
      .then(data => setQuestions(data.questions ?? []))
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (option) => {
    if (selected !== null) return;
    setSelected(option);
    const newAnswers = [...answers, { question_id: questions[current].id, answer: option }];
    setAnswers(newAnswers);

    setTimeout(() => {
      if (current + 1 < questions.length) {
        setCurrent(c => c + 1);
        setSelected(null);
      } else {
        setBuilding(true);
        answerColdStart('cold_start_user', newAnswers)
          .then(profile => {
            setDone(true);
            setTimeout(() => onProfileBuilt(profile), 1000);
          })
          .catch(e => {
            showToast(e.message || 'Failed to build profile. Try again.', 'error');
            setBuilding(false);
          });
      }
    }, 400);
  };

  if (loading) {
    return (
      <div className="p-4">
        {[1, 2, 3].map(i => <div key={i} className="skeleton h-3.5 mb-2.5 rounded" />)}
      </div>
    );
  }

  if (done) {
    return (
      <div className="p-6 text-center">
        <div className="text-3xl mb-2">✅</div>
        <div className="text-[#22C55E] font-bold text-base">Profile built! ✓</div>
      </div>
    );
  }

  if (building) {
    return (
      <div className="p-4">
        <div className="text-[#64748B] text-sm mb-3">Building your profile...</div>
        {[1, 2, 3].map(i => <div key={i} className="skeleton h-3 mb-2 rounded" />)}
      </div>
    );
  }

  if (!questions.length) {
    return <div className="text-[#64748B] text-sm p-4">No questions available.</div>;
  }

  const q = questions[current];
  // #10: progress uses current + 1 so bar fills as each question is answered
  const progress = ((current + 1) / questions.length) * 100;

  return (
    <div className="p-1">
      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between mb-1.5">
          <span className="text-[11px] text-[#64748B]">Question {current + 1} of {questions.length}</span>
        </div>
        <div className="h-1 bg-[#1E1E2E] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#6366F1] rounded-full"
            style={{ width: `${progress}%`, transition: reduced ? 'none' : 'width 300ms ease' }}
          />
        </div>
      </div>

      {/* Question bubble */}
      <div
        className="bg-[#13131A] border border-[#1E1E2E] rounded-tr-xl rounded-br-xl rounded-bl-xl px-3.5 py-3 text-sm text-[#F8FAFC] mb-3.5"
        style={{ animation: reduced ? 'none' : 'fadeSlideIn 0.3s ease' }}
      >
        {q.question}
      </div>

      {/* Option chips with human-readable labels */}
      <div className="flex flex-wrap gap-2">
        {q.options.map(opt => {
          const isSelected = selected === opt;
          return (
            <button
              key={opt}
              onClick={() => handleSelect(opt)}
              disabled={selected !== null}
              className="rounded-full px-4 py-2 text-sm flex items-center gap-1.5 cursor-pointer disabled:cursor-default"
              style={{
                border: `1px solid ${isSelected ? '#6366F1' : '#1E1E2E'}`,
                background: isSelected ? '#6366F1' : 'transparent',
                color: isSelected ? '#fff' : '#F8FAFC',
                transition: reduced ? 'none' : 'all 0.2s',
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
