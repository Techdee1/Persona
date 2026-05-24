import { useState, useRef, useEffect } from 'react';
import { MapPin } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import ProfilePanel from '../components/profile/ProfilePanel';
import RecommendationCard from '../components/task-b/RecommendationCard';
import AgentTimeline from '../components/task-b/AgentTimeline';
import ColdStartChat from '../components/task-b/ColdStartChat';
import ConversationLog from '../components/task-b/ConversationLog';
import { buildProfile, recommend, runAgent } from '../lib/api';
import { DEMO_USERS, DEMO_AGENT_PAYLOAD } from '../lib/demo-users';
import { useToast } from '../components/layout/Toast';
import DemoUserPicker from '../components/ui/DemoUserPicker';
import ColdStartInline from '../components/shared/ColdStartInline';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const QUERY_SUGGESTIONS = [
  'spicy grilled food, Lagos vibe',
  'budget-friendly Chinese food',
  'outdoor dining, good atmosphere',
];

function SectionHeader({ num, label }) {
  return (
    <div className="flex items-center gap-2.5 mb-3.5">
      <div className="w-1 h-5 bg-[#F59E0B] rounded-sm" />
      <span className="text-[10px] text-[#64748B] uppercase tracking-widest font-semibold">{num} — {label}</span>
    </div>
  );
}

function Toggle({ on, onToggle, label }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#F8FAFC]">{label}</span>
      <button
        role="switch" aria-checked={on} aria-label={label} onClick={onToggle}
        className="relative border-none cursor-pointer rounded-full"
        style={{
          width: 40, height: 22,
          background: on ? '#6366F1' : '#1E1E2E',
          transition: reduced ? 'none' : 'background 0.2s',
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: on ? 21 : 3,
          width: 16, height: 16, borderRadius: '50%', background: '#F8FAFC',
          transition: reduced ? 'none' : 'left 0.2s',
        }} />
      </button>
    </div>
  );
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export default function TaskB() {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const [entryMode, setEntryMode] = useState('history');
  const [records, setRecords] = useState([]);
  const [selectedDemo, setSelectedDemo] = useState('');
  const [demoChip, setDemoChip] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [axes, setAxes] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [agentSteps, setAgentSteps] = useState([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [constraintInput, setConstraintInput] = useState('');
  const [constraints, setConstraints] = useState([]);
  const [turns, setTurns] = useState([]);
  const chipTimer = useRef(null);
  const autoBuilt = useRef(false);

  // Cancel speech on unmount
  useEffect(() => () => window.speechSynthesis.cancel(), []);

  const isColdStart = selectedDemo === 'demo_newuser';

  const handleColdStartComplete = (generatedProfile, generatedRecords) => {
    setProfile(generatedProfile);
    setRecords(generatedRecords);
    setDemoChip(true);
    clearTimeout(chipTimer.current);
    chipTimer.current = setTimeout(() => setDemoChip(false), 4000);
  };

  const primaryDomain = profile
    ? (Object.entries(profile.value_keywords ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)
    : null;

  const NON_FOOD_KEYWORDS = ['movie', 'film', 'gym', 'hotel', 'shop', 'book', 'activity', 'park', 'spa'];
  const isCrossDomain = !!primaryDomain && NON_FOOD_KEYWORDS.some(k => queryText.toLowerCase().includes(k));

  const handleBuildProfile = async (uid, recs) => {
    setProfileLoading(true);
    try {
      const p = await buildProfile(uid, recs);
      setProfile(p);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    const demoParam = searchParams.get('demo');
    if (demoParam && DEMO_USERS[demoParam] && !autoBuilt.current) {
      autoBuilt.current = true;
      const demoUser = DEMO_USERS[demoParam];
      setRecords(demoUser.records);
      setSelectedDemo(demoParam);
      handleBuildProfile(demoParam, demoUser.records);
    }
  }, []);

  useEffect(() => {
    const onReset = () => {
      setRecords([]); setSelectedDemo(''); setProfile(null);
      setRecommendations([]); setAxes([]); setSessionId(null);
      setTurns([]); setQueryText(''); setConstraints([]);
      autoBuilt.current = false;
    };
    window.addEventListener('persona:reset', onReset);
    return () => window.removeEventListener('persona:reset', onReset);
  }, []);

  const handleDemoSelect = (key) => {
    if (selectedDemo === key) {
      setSelectedDemo('');
      setRecords([]);
      return;
    }
    setSelectedDemo(key);
    setRecords(DEMO_USERS[key]?.records ?? []);
    setDemoChip(true);
    clearTimeout(chipTimer.current);
    chipTimer.current = setTimeout(() => setDemoChip(false), 2000);
  };

  useEffect(() => () => clearTimeout(chipTimer.current), []);

  // Constraints persist across turns — only cleared by explicit session clear
  const handleRecommend = async (append = false) => {
    setRecsLoading(true);
    try {
      const result = await recommend({
        user_id: selectedDemo || 'custom_user', records,
        query_text: queryText, top_k: 5,
        session_id: sessionId ?? undefined,
      });
      setSessionId(result.session_id);
      setAxes(result.axes ?? []);
      const newRecs = result.recommendations ?? [];
      setRecommendations(prev => append ? [...prev, ...newRecs] : newRecs);
      setTurns(prev => [...prev, {
        id: uuid(), query: queryText,
        constraintsApplied: [...constraints],   // snapshot current constraints
        resultCount: newRecs.length, timestamp: new Date(),
        isColdStart: isColdStart,
      }]);
      // constraints intentionally NOT cleared — they persist across turns

      if (agentMode) {
        setAgentLoading(true);
        try {
          const agentResult = await runAgent({ ...DEMO_AGENT_PAYLOAD, user_id: selectedDemo || 'demo_generous' });
          setAgentSteps(agentResult.steps ?? []);
        } catch (e) {
          showToast(e.message, 'error');
        } finally {
          setAgentLoading(false);
        }
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setRecsLoading(false);
    }
  };

  const handleClearSession = () => {
    setTurns([]); setSessionId(null); setRecommendations([]); setAxes([]);
    setConstraints([]); setConstraintInput('');
  };

  const addConstraint = (e) => {
    if (e.key === 'Enter' && constraintInput.trim()) {
      setConstraints(c => [...c, constraintInput.trim()]);
      setConstraintInput('');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 md:p-6 min-h-[calc(100vh-56px)]">

      {/* Left col — inputs */}
      <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5">
        {/* Tab switcher */}
        <div className="flex gap-1 mb-5 bg-[#0A0A0F] rounded-lg p-1">
          {[['history', 'Review History'], ['coldstart', 'Cold Start Chat']].map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setEntryMode(mode)}
              className="flex-1 py-1.5 rounded-md border-none text-xs font-semibold cursor-pointer"
              style={{
                background: entryMode === mode ? '#6366F1' : 'transparent',
                color: entryMode === mode ? '#fff' : '#64748B',
                transition: reduced ? 'none' : 'all 0.2s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {entryMode === 'history' ? (
          <>
            <SectionHeader num="01" label="Build Profile" />
            <div className="mb-3">
              <label className="text-xs text-[#64748B] block mb-1.5">Demo User</label>
              <DemoUserPicker selected={selectedDemo} onSelect={handleDemoSelect} />
              {isColdStart && (
                <ColdStartInline onComplete={handleColdStartComplete} key={selectedDemo} />
              )}
              {demoChip && (
                <div className="mt-2 inline-flex items-center gap-1 bg-[rgba(34,197,94,0.1)] border border-[#22C55E] rounded-full px-2.5 py-0.5 text-[11px] text-[#22C55E]">
                  {isColdStart ? 'Profile generated from your answers ✓' : 'Demo data loaded ✓'}
                </div>
              )}
            </div>
            <div className="mb-3">
              <label htmlFor="records-b" className="text-xs text-[#64748B] block mb-1.5">Review Records (JSON)</label>
              <textarea
                id="records-b" rows={4}
                placeholder="Paste JSON review records here, or select a demo user above."
                value={records.length ? JSON.stringify(records, null, 2) : ''}
                onChange={e => { try { setRecords(JSON.parse(e.target.value)); } catch { } }}
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, resize: 'vertical', minHeight: 90 }}
              />
            </div>
            <button
              onClick={() => handleBuildProfile(selectedDemo || 'custom_user', records)}
              disabled={profileLoading}
              className="w-full bg-[#6366F1] text-white border-none rounded-lg py-2.5 font-semibold text-sm mb-5 cursor-pointer disabled:cursor-not-allowed"
            >
              {profileLoading
                ? <div className="skeleton h-4 w-3/5 mx-auto rounded" />
                : 'Build Profile'}
            </button>
          </>
        ) : (
          <ColdStartChat onProfileBuilt={(p) => setProfile(p)} />
        )}

        <div className="h-px bg-[#1E1E2E] mb-5" />
        <SectionHeader num="03" label="Your Query" />

        <div className="mb-2.5">
          <label htmlFor="query-input" className="text-xs text-[#64748B] block mb-1.5">What are you looking for?</label>
          <input id="query-input" type="text"
            placeholder="e.g. spicy grilled food, budget-friendly, Lagos vibe"
            value={queryText} onChange={e => setQueryText(e.target.value)} />
          {!queryText && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {QUERY_SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => setQueryText(s)}
                  aria-label={`Use suggestion: ${s}`}
                  className="rounded-full border border-[#1E1E2E] bg-[#1E1E2E] text-[#94A3B8] text-xs px-3 py-1 cursor-pointer transition-all duration-200 hover:border-[#6366F1] hover:bg-[rgba(99,102,241,0.12)] hover:text-[#F8FAFC]"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <ConversationLog turns={turns} onClear={handleClearSession} isColdStartSession={isColdStart} agentMode={agentMode} />

        <div className="mb-3.5">
          <label htmlFor="constraint-input" className="text-xs text-[#64748B] block mb-1.5">Constraints (press Enter to add)</label>
          <input id="constraint-input" type="text" placeholder="e.g. outdoor seating"
            value={constraintInput} onChange={e => setConstraintInput(e.target.value)} onKeyDown={addConstraint} />
          {constraints.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {constraints.map((c, i) => (
                <span key={i} className="bg-[#0A0A0F] border border-[#6366F1] rounded-full px-2.5 py-0.5 text-[11px] text-[#F8FAFC] flex items-center gap-1.5">
                  {c}
                  <button
                    onClick={() => setConstraints(cs => cs.filter((_, j) => j !== i))}
                    aria-label={`Remove constraint ${c}`}
                    className="bg-transparent border-none text-[#64748B] cursor-pointer p-0 text-xs"
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => handleRecommend(false)}
          disabled={recsLoading || !queryText.trim()}
          className="w-full border-none rounded-lg py-2.5 font-semibold text-sm mb-3 cursor-pointer disabled:cursor-not-allowed"
          style={{
            background: queryText.trim() ? '#6366F1' : '#1E1E2E',
            color: queryText.trim() ? '#fff' : '#64748B',
          }}
        >
          {recsLoading
            ? <div className="skeleton h-4 w-3/5 mx-auto rounded" />
            : 'Find Recommendations'}
        </button>

        <Toggle on={agentMode} onToggle={() => setAgentMode(v => !v)} label="Agent Mode" />
        {agentMode && agentSteps.length === 0 && (
          <div className="mt-2 bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.3)] rounded-lg px-2.5 py-1.5 text-xs text-[#F59E0B]"
            style={{ animation: reduced ? 'none' : 'fadeSlideIn 0.2s ease' }}>
            Shows the 4-step AI reasoning pipeline
          </div>
        )}
        {agentMode && agentSteps.length > 0 && (
          <div className="mt-2 flex items-center gap-2 bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.3)] rounded-lg px-2.5 py-1.5">
            <span className="w-2 h-2 rounded-full bg-[#6366F1] shrink-0" style={{ animation: reduced ? 'none' : 'pulse-opacity 1.5s ease-in-out infinite' }} />
            <span className="text-xs text-[#6366F1] font-semibold">Agent reasoning active</span>
            <span className="text-[10px] text-[#64748B] ml-auto">{agentSteps.length} steps</span>
          </div>
        )}
      </div>

      {/* Center col — profile + axes */}
      <div className="flex flex-col gap-4">
        <ProfilePanel
          profile={profile} loading={profileLoading}
          primaryDomain={primaryDomain} queryText={queryText} pageContext="task-b"
        />

        {/* Cross-domain transfer panel */}
        {isCrossDomain && primaryDomain && (
          <div className="bg-[#13131A] border border-[#F59E0B] rounded-xl p-4"
            style={{ borderLeft: '4px solid #F59E0B' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm">⚡</span>
              <span className="text-xs font-semibold text-[#F59E0B] uppercase tracking-widest">Cross-Domain Transfer</span>
            </div>
            <div className="text-xs text-[#64748B] leading-relaxed">
              Applying <span className="text-[#F59E0B] font-semibold">{primaryDomain}</span> preference axes to your current query context.
            </div>
            {axes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {axes.slice(0, 3).map(a => (
                  <span key={a.name} className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#F59E0B' }}>
                    {a.name} · {((a.weight ?? 0) * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {axes.length > 0 && (
          <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5">
            <div className="text-[10px] text-[#64748B] uppercase tracking-widest mb-3.5">Detected Preference Axes</div>
            {axes.map((axis, i) => {
              const maxWeight = Math.max(...axes.map(a => a.weight ?? 0), 0.001);
              const normalisedWidth = ((axis.weight ?? 0) / maxWeight) * 100;
              return (
                <div key={axis.name} style={{
                  marginBottom: 14, opacity: 0,
                  animation: reduced ? 'none' : 'fadeSlideIn 0.3s ease forwards',
                  animationDelay: reduced ? '0ms' : `${i * 80}ms`,
                }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-[#F8FAFC]">{axis.name}</span>
                    <div className="w-28 h-1.5 bg-[#1E1E2E] rounded-sm overflow-hidden">
                      <div style={{
                        height: '100%', background: '#F59E0B', borderRadius: 3,
                        width: `${normalisedWidth}%`,
                        transition: reduced ? 'none' : 'width 0.6s ease',
                      }} />
                    </div>
                  </div>
                  <div className="text-xs text-[#64748B]">{axis.rationale}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right col — agent + recommendations */}
      <div className="flex flex-col gap-4">
        {agentMode && <AgentTimeline steps={agentSteps} loading={agentLoading} />}

        <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold text-[#F8FAFC]">
              {recommendations.length > 0
                ? `${recommendations.length} results${queryText ? ` for "${queryText}"` : ''}`
                : 'Recommendations'}
            </span>
            {recommendations.length > 0 && (
              <button
                onClick={() => handleRecommend(true)}
                disabled={recsLoading}
                aria-label="Show more recommendations"
                className="bg-transparent border border-[#1E1E2E] rounded-lg text-[#64748B] text-xs px-3 py-1 cursor-pointer transition-all duration-200 hover:border-[#6366F1] hover:text-[#F8FAFC] disabled:cursor-not-allowed"
              >
                Show more
              </button>
            )}
          </div>

          {recsLoading && recommendations.length === 0 ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-[#0A0A0F] rounded-lg p-4">
                  <div className="skeleton h-3.5 w-3/4 mb-2" />
                  <div className="skeleton h-2.5 w-1/2 mb-1.5" />
                  <div className="skeleton h-2.5 w-4/5" />
                </div>
              ))}
            </div>
          ) : recommendations.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-3">
              <MapPin size={32} color="#1E1E2E" />
              <span className="text-[#64748B] text-sm">Enter a query and click Find Recommendations.</span>
              <div className="flex flex-wrap gap-1.5 justify-center mt-1">
                {QUERY_SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => setQueryText(s)}
                    aria-label={`Use suggestion: ${s}`}
                    className="rounded-full border border-[#1E1E2E] bg-[#1E1E2E] text-[#94A3B8] text-xs px-3 py-1 cursor-pointer transition-all duration-200 hover:border-[#6366F1] hover:bg-[rgba(99,102,241,0.12)] hover:text-[#F8FAFC]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {recommendations.map((item, i) => (
                <RecommendationCard
                  key={`${item.item_id}-${i}`}
                  item={item} rank={i + 1} animationDelay={i * 60}
                  agentMode={agentMode}
                  agentStepIndex={agentMode && agentSteps.length > 0 ? Math.min(i, agentSteps.length - 1) : null}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
