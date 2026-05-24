const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

export default function ConversationLog({ turns, onClear, isColdStartSession = false, agentMode = false }) {
  if (!turns.length) return null;

  return (
    <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#64748B] uppercase tracking-widest">Conversation</span>
          {isColdStartSession && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)', color: '#818CF8' }}>
              Cold-start session
            </span>
          )}
          {agentMode && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#6366F1' }}>
              Agent
            </span>
          )}
        </div>
        <span className="text-[10px] text-[#64748B]">{turns.length} turn{turns.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="relative">
        <div className="absolute left-[5px] top-2 bottom-6 w-0.5 bg-[#1E1E2E] rounded-sm" />

        {turns.map((turn, i) => {
          const isLatest = i === turns.length - 1;
          return (
            <div
              key={turn.id}
              className="pl-5 mb-3 relative"
              style={{
                opacity: 0,
                animation: reduced ? 'none' : 'fadeSlideIn 0.3s ease forwards',
                animationDelay: reduced ? '0ms' : `${i * 60}ms`,
                background: isLatest ? '#1A1A2E' : 'transparent',
                borderLeft: isLatest ? '2px solid #6366F1' : 'none',
                borderRadius: isLatest ? '0 6px 6px 0' : 0,
                padding: isLatest ? '8px 8px 8px 20px' : '0 0 0 20px',
              }}
            >
              <div
                className="absolute top-1.5 w-3 h-3 rounded-full"
                style={{
                  left: 0,
                  background: isLatest ? '#6366F1' : '#1E1E2E',
                  border: isLatest ? 'none' : '2px solid #6366F1',
                }}
              />

              <div className="flex items-start justify-between gap-2">
                <span className="text-sm text-[#F8FAFC] overflow-hidden text-ellipsis whitespace-nowrap max-w-[160px]">
                  "{turn.query.length > 40 ? turn.query.slice(0, 40) + '…' : turn.query}"
                </span>
                <div className="flex flex-col items-end shrink-0">
                  <span className="text-[11px] text-[#64748B]">{turn.resultCount} results</span>
                  <span className="text-[11px] text-[#64748B]">{fmt(turn.timestamp)}</span>
                </div>
              </div>

              {turn.constraintsApplied.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {turn.constraintsApplied.map((c, j) => (
                    <span key={j} className="bg-[#0A0A0F] border border-[#1E1E2E] rounded-full px-2 py-0.5 text-[10px] text-[#64748B]">
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={onClear}
        aria-label="Clear session"
        className="mt-2 w-full bg-transparent border border-[#1E1E2E] rounded-md text-[#64748B] text-[11px] py-1 cursor-pointer transition-all duration-200 hover:border-[#6366F1] hover:text-[#F8FAFC]"
      >
        Clear session
      </button>
    </div>
  );
}
