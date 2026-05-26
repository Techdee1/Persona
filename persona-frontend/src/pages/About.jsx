function ArchBox({ title, sub, accent }) {
  return (
    <div
      className="bg-[#13131A] rounded-lg px-4 py-3 text-center min-w-[90px]"
      style={{ border: `1px solid ${accent ?? '#1E1E2E'}` }}
    >
      <div className="text-sm font-bold text-[#F8FAFC]">{title}</div>
      {sub && <div className="text-[11px] text-[#64748B] mt-0.5">{sub}</div>}
    </div>
  );
}

function Arrow() {
  return <div className="text-[#1E1E2E] text-xl px-1">→</div>;
}

function MethodCard({ title, body }) {
  return (
    <div className="flex-1 min-w-[260px] bg-[#13131A] border border-[#1E1E2E] rounded-xl p-6">
      <div className="text-base font-bold text-[#F8FAFC] mb-2">{title}</div>
      <div className="text-sm text-[#64748B] leading-relaxed">{body}</div>
    </div>
  );
}

const STACK = [
  { icon: '⚛️', label: 'React' },
  { icon: '🟨', label: 'JavaScript' },
  { icon: '🎨', label: 'Tailwind CSS' },
  { icon: '🐍', label: 'FastAPI' },
  { icon: '🤗', label: 'sentence-transformers' },
  { icon: '📊', label: 'Recharts' },
];

const TASK_A_CRITERIA = [
  { name: 'Review Text Quality', method: 'ROUGE / BERTScore' },
  { name: 'Rating Accuracy', method: 'RMSE' },
  { name: 'Behavioural Fidelity', method: 'Human evaluation' },
  { name: 'Solution Paper', method: 'Written submission' },
  { name: 'Code Reproducibility', method: 'Reproducibility audit' },
];

const TASK_B_CRITERIA = [
  { name: 'Ranking Quality', method: 'NDCG@10 / Hit Rate', pts: 30 },
  { name: 'Cold-Start & Cross-Domain', method: 'Held-out evaluation', pts: 25 },
  { name: 'Contextual Relevance', method: 'Human eval', pts: 20 },
  { name: 'Solution Paper', method: 'Written submission', pts: 15 },
  { name: 'Code Reproducibility', method: 'Reproducibility audit', pts: 10 },
];

export default function About() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 md:py-12">
      <h1 className="font-bold text-[#F8FAFC] text-center mb-6 tracking-tight" style={{ fontSize: 'clamp(24px, 4vw, 40px)' }}>
        How Persona Works
      </h1>

      {/* Solution paper downloads */}
      <div className="flex flex-col sm:flex-row gap-3 mb-10 justify-center">
        {[
          { label: 'Task A Solution Paper', file: '/PERSONA_Task_A_Solution_Paper.pdf', color: '#F59E0B' },
          { label: 'Task B Solution Paper', file: '/PERSONA_Task_B_Solution_Paper.pdf', color: '#6366F1' },
        ].map(({ label, file, color }) => (
          <a
            key={file}
            href={file}
            download
            aria-label={`Download ${label}`}
            className="flex items-center gap-2.5 px-4 py-3 rounded-xl border no-underline transition-all duration-200 group"
            style={{ background: `${color}10`, borderColor: `${color}40` }}
            onMouseEnter={e => { e.currentTarget.style.background = `${color}20`; e.currentTarget.style.borderColor = color; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${color}10`; e.currentTarget.style.borderColor = `${color}40`; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <div>
              <div className="text-xs font-semibold" style={{ color }}>{label}</div>
              <div className="text-[10px] text-[#64748B]">PDF · Solution paper</div>
            </div>
          </a>
        ))}
      </div>

      {/* Architecture */}
      <div className="mb-10">
        <div className="text-[10px] text-[#64748B] uppercase tracking-widest mb-4">Architecture</div>
        <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-4 md:p-6 flex items-center flex-wrap gap-1 justify-center overflow-x-auto">
          <ArchBox title="Browser" sub="React + Vite" accent="#6366F1" />
          <Arrow />
          <ArchBox title="Nginx" sub="Reverse Proxy" />
          <Arrow />
          <ArchBox title="FastAPI" sub="Port 8000" accent="#F59E0B" />
          <Arrow />
          <ArchBox title="Vector Store" sub="200k Yelp businesses" accent="#22C55E" />
        </div>
      </div>

      {/* Method cards */}
      <div className="flex flex-col sm:flex-row gap-4 mb-10">
        <MethodCard
          title="Review Simulation"
          body="Persona builds a psychological profile from a user's review history — extracting rating statistics, writing style, value keywords, and cultural signals. It then calibrates a predicted rating against the population mean and generates a culturally-aware review that mirrors the user's authentic voice."
        />
        <MethodCard
          title="Smart Recommendations"
          body="For users with history, Persona extracts preference axes and runs vector similarity search against 50k Yelp businesses. For new users, a cold-start chat collects preferences. A 4-step agent loop — profile → embed → search → rank — refines results using LLM reasoning."
        />
      </div>

      {/* Scoring Rubric */}
      <div className="mb-10">
        <div className="text-2xl font-bold text-[#F8FAFC] mb-6">Evaluation Criteria</div>

        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          {/* Task A */}
          <div className="flex-1 min-w-[260px] bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5 md:p-6" style={{ borderTop: '3px solid #6366F1' }}>
            <div className="text-[11px] text-[#6366F1] uppercase tracking-widest font-semibold mb-4">Task A · User Modeling</div>
            {TASK_A_CRITERIA.map(({ name, method }) => (
              <div key={name} className="mb-3 pb-3 border-b border-[#1E1E2E]">
                <div className="text-sm text-[#F8FAFC]">{name}</div>
                <div className="text-[11px] text-[#64748B] mt-0.5">{method}</div>
              </div>
            ))}
          </div>

          {/* Task B */}
          <div className="flex-1 min-w-[260px] bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5 md:p-6" style={{ borderTop: '3px solid #F59E0B' }}>
            <div className="text-[11px] text-[#F59E0B] uppercase tracking-widest font-semibold mb-4">Task B · Recommendation</div>
            {TASK_B_CRITERIA.map(({ name, method, pts }) => (
              <div key={name} className="mb-3 pb-3 border-b border-[#1E1E2E] flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm text-[#F8FAFC]">{name}</div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">{method}</div>
                </div>
                <span className="text-[#F59E0B] font-bold text-sm shrink-0" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{pts}pts</span>
              </div>
            ))}
            <div className="text-right text-sm text-[#F8FAFC] font-semibold mt-1">100 pts total</div>
          </div>
        </div>

        {/* Pull-quote */}
        <div className="text-center px-4 md:px-8">
          <p className="text-sm text-[#64748B] italic leading-relaxed">
            "A model score reflects what your machine did. A solution paper reveals what you understood. Both matter."
          </p>
          <p className="text-xs text-[#64748B] mt-1.5">— DSN x BCT Judging Panel</p>
        </div>
      </div>

      {/* Tech stack */}
      <div>
        <div className="text-[10px] text-[#64748B] uppercase tracking-widest mb-3">Tech Stack</div>
        <div className="flex flex-wrap gap-2">
          {STACK.map(({ icon, label }) => (
            <span key={label} className="bg-[#13131A] border border-[#1E1E2E] rounded-full px-3 py-1.5 text-xs text-[#64748B] flex items-center gap-1.5">
              {icon} {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
