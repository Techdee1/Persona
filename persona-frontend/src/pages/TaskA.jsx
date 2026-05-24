import { useState, useEffect, useRef } from 'react';
import { Copy, Check, Volume2, VolumeX } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useSpeech } from '../lib/useSpeech';
import ProfilePanel from '../components/profile/ProfilePanel';
import TracePanel from '../components/trace/TracePanel';
import FidelityDashboard from '../components/task-a/FidelityDashboard';
import Tooltip from '../components/ui/Tooltip';
import { buildProfile, simulateTaskA } from '../lib/api';
import { DEMO_USERS, DEMO_REAL_REVIEWS, DEMO_EXPLANATIONS } from '../lib/demo-users';
import { useToast } from '../components/layout/Toast';
import DemoUserPicker from '../components/ui/DemoUserPicker';
import ColdStartInline from '../components/shared/ColdStartInline';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const PLACE_SUGGESTIONS = [
  { name: 'Chicken Republic Lekki', description: 'Fast food, Nigerian cuisine', categories: 'Fast Food, Nigerian', price_range: 'Budget' },
  { name: 'Kilimanjaro Restaurant', description: 'Nigerian cuisine, Lagos', categories: 'Nigerian, Casual Dining', price_range: 'Mid-range' },
  { name: 'Mama Cass Victoria Island', description: 'Traditional Nigerian food', categories: 'Nigerian, Traditional', price_range: 'Budget' },
];

// Maps trace clause keywords to profile layer labels
const TRACE_LAYER_MAP = [
  { pattern: /rating|star|score|mean|calibrat/i,   label: 'Rating Calibration',   color: '#F59E0B' },
  { pattern: /cultural|nigerian|pidgin|code.switch/i, label: 'Cultural Signal',    color: '#22C55E' },
  { pattern: /trajector|drift|trend|recent/i,       label: 'Trajectory',           color: '#6366F1' },
  { pattern: /style|vocab|word|length|sentence/i,   label: 'Stylometry',           color: '#818CF8' },
  { pattern: /keyword|food|service|price|atmospher/i, label: 'Value Keywords',     color: '#F59E0B' },
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

function wordOverlapScore(a, b) {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...setA].filter(w => setB.has(w)).length;
  return Math.round((intersection / Math.max(setA.size, setB.size)) * 100);
}

function HighlightedReview({ text, userId }) {
  const explanations = DEMO_EXPLANATIONS[userId];
  if (!explanations || !text) return <span>{text}</span>;

  const entries = Object.entries(explanations).sort((a, b) => b[0].length - a[0].length);
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let matched = false;
    for (const [phrase, explanation] of entries) {
      const idx = remaining.toLowerCase().indexOf(phrase.toLowerCase());
      if (idx === 0) {
        parts.push(
          <Tooltip key={key++} text={explanation}>
            <span style={{ textDecoration: 'underline dotted #F59E0B', cursor: 'help' }}>
              {remaining.slice(0, phrase.length)}
            </span>
          </Tooltip>
        );
        remaining = remaining.slice(phrase.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      let nextMatch = remaining.length;
      for (const [phrase] of entries) {
        const idx = remaining.toLowerCase().indexOf(phrase.toLowerCase());
        if (idx > 0 && idx < nextMatch) nextMatch = idx;
      }
      parts.push(<span key={key++}>{remaining.slice(0, nextMatch)}</span>);
      remaining = remaining.slice(nextMatch);
    }
  }

  return <>{parts}</>;
}

function TypewriterText({ text, userId }) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!text) return;
    setDone(false);
    if (reduced) { setDisplayed(text); setDone(true); return; }
    setDisplayed('');
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(iv); setDone(true); }
    }, 30);
    return () => clearInterval(iv);
  }, [text]);

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <button
        onClick={copy}
        aria-label="Copy review text"
        className="absolute top-2 right-2 bg-transparent border-none cursor-pointer"
        style={{ color: copied ? '#22C55E' : '#64748B' }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <div className="bg-[#0A0A0F] border border-[#1E1E2E] rounded-lg p-3 pr-9 text-[#F8FAFC] leading-relaxed min-h-[80px] text-sm"
        style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        {done
          ? <HighlightedReview text={displayed} userId={userId} />
          : <>{displayed}{displayed.length < text.length && <span className="opacity-50">|</span>}</>
        }
      </div>
    </div>
  );
}

function ConfidenceBand({ predictedRating, profile }) {
  if (!profile) return null;
  const std = profile.rating_stats?.std_dev ?? 0;
  const count = profile.rating_stats?.count ?? 0;
  if (!std && !count) return null;

  const lower = Math.max(1, predictedRating - std).toFixed(1);
  const upper = Math.min(5, predictedRating + std).toFixed(1);
  const confidence = count >= 10 ? 'High' : count >= 5 ? 'Medium' : 'Low';
  const confidenceColor = count >= 10 ? '#22C55E' : count >= 5 ? '#F59E0B' : '#EF4444';
  const lowerPct = ((parseFloat(lower) - 1) / 4) * 100;
  const upperPct = ((parseFloat(upper) - 1) / 4) * 100;

  return (
    <div className="mt-3 px-3.5 py-2.5 bg-[#0A0A0F] rounded-lg border border-[#1E1E2E]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-[#64748B]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          Range: {lower} — {upper}
        </span>
        <span
          title={`Based on ${count} reviews. More history = narrower range.`}
          className="flex items-center gap-1 text-[11px] cursor-default"
          style={{ color: confidenceColor }}
        >
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: confidenceColor }} />
          Confidence: {confidence}
        </span>
      </div>
      <div className="h-1 bg-[#1E1E2E] rounded-sm relative">
        <div
          className="absolute h-full bg-[#F59E0B] rounded-sm"
          style={{
            left: `${lowerPct}%`, width: `${upperPct - lowerPct}%`,
            transition: reduced ? 'none' : 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

function ComparisonDrawer({ generatedText, userId }) {
  const [open, setOpen] = useState(false);
  if (!userId?.startsWith('demo_')) return null;

  const realReview = DEMO_REAL_REVIEWS[userId] ?? '';
  const score = generatedText && realReview ? wordOverlapScore(generatedText, realReview) : 0;
  const scoreColor = score >= 60 ? '#22C55E' : score >= 40 ? '#F59E0B' : '#EF4444';

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Compare with real review"
        className="w-full bg-transparent border border-[#1E1E2E] rounded-lg text-[#64748B] text-xs py-2 cursor-pointer transition-all duration-200 hover:border-[#6366F1] hover:text-[#F8FAFC]"
      >
        {open ? 'Hide comparison' : 'Compare with real review'}
      </button>

      <div style={{
        overflow: 'hidden',
        maxHeight: open ? 400 : 0,
        transition: reduced ? 'none' : 'max-height 0.35s ease',
      }}>
        <div className="pt-3">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="flex-1 text-[11px] text-[#6366F1] font-semibold uppercase tracking-wide">AI Generated</div>
            <div className="flex flex-col items-center gap-0.5">
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold border"
                style={{ background: `${scoreColor}20`, borderColor: scoreColor, color: scoreColor }}
              >
                ~ROUGE-L: {score}%
              </span>
              <span className="text-[9px] text-[#64748B]">word overlap approximation</span>
            </div>
            <div className="flex-1 text-[11px] text-[#F59E0B] font-semibold uppercase tracking-wide text-right">Real Review</div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5">
            {[generatedText, realReview].map((txt, i) => (
              <div key={i} className="flex-1 bg-[#0A0A0F] border border-[#1E1E2E] rounded-lg p-3 text-xs text-[#F8FAFC] leading-relaxed max-h-48 overflow-y-auto"
                style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                {txt}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutputPanel({ output, loading, profile, userId }) {
  const { speak, stop, speaking } = useSpeech();
  useEffect(() => () => window.speechSynthesis.cancel(), []);

  if (loading) {
    return (
      <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5">
        <div className="skeleton w-20 h-20 rounded-full mx-auto mb-4" />
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-3 mb-2" />)}
      </div>
    );
  }

  if (!output) {
    return (
      <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5 flex flex-col items-center justify-center min-h-[160px] gap-2.5">
        <span className="text-5xl" style={{ color: '#1E1E2E' }}>★</span>
        <span className="text-[#64748B] text-sm">Simulation output will appear here.</span>
      </div>
    );
  }

  const rating = output.predicted_rating ?? 0;

  return (
    <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5">
      <div className="text-center mb-4">
        <div className="flex justify-center gap-1 mb-2">
          {[1, 2, 3, 4, 5].map(i => (
            <span key={i} style={{
              fontSize: 24, color: i <= Math.round(rating) ? '#F59E0B' : '#1E1E2E',
              opacity: 0, animation: reduced ? 'none' : 'fadeSlideIn 0.3s ease forwards',
              animationDelay: reduced ? '0ms' : `${(i - 1) * 100}ms`,
            }}>★</span>
          ))}
        </div>
        <div className="text-3xl font-bold text-[#F8FAFC]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {rating.toFixed(1)} / 5.0
        </div>
        <div className="text-[10px] text-[#64748B] uppercase tracking-widest mt-1">Predicted Rating</div>
      </div>

      <ConfidenceBand predictedRating={rating} profile={profile} />

      <div className="h-px bg-[#1E1E2E] my-4" />

      <div className="flex items-center justify-between mb-2.5">
        <div className="text-[10px] text-[#64748B] uppercase tracking-widest">Generated Review</div>
        <button
          onClick={() => speaking ? stop() : speak(output.review_text ?? '')}
          aria-label={speaking ? 'Stop reading review' : 'Read review aloud'}
          className="bg-transparent border-none cursor-pointer flex items-center gap-1 text-[11px] transition-colors duration-200"
          style={{ color: speaking ? '#F59E0B' : '#64748B' }}
        >
          {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
          {speaking ? 'Stop' : 'Read aloud'}
        </button>
      </div>
      <TypewriterText text={output.review_text ?? ''} userId={userId} />
      <ComparisonDrawer generatedText={output.review_text ?? ''} userId={userId} />
    </div>
  );
}

export default function TaskA() {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const [records, setRecords] = useState([]);
  const [selectedDemo, setSelectedDemo] = useState('');
  const [demoChip, setDemoChip] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [targetItem, setTargetItem] = useState({ name: '', description: '', categories: '', price_range: '', context: '' });
  const [useLLM, setUseLLM] = useState(false);
  const [output, setOutput] = useState(null);
  const [outputLoading, setOutputLoading] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const chipTimer = useRef(null);
  const autoBuilt = useRef(false);

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
      setRecords([]); setSelectedDemo(''); setProfile(null); setOutput(null);
      setTargetItem({ name: '', description: '', categories: '', price_range: '', context: '' }); setUseLLM(false);
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

  const handleSimulate = async () => {
    setOutputLoading(true); setTraceLoading(true);
    try {
      const result = await simulateTaskA({
        user_id: selectedDemo || 'custom_user', records,
        target_item: targetItem, use_llm: useLLM,
      });
      setOutput(result);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setOutputLoading(false); setTraceLoading(false);
    }
  };

  const isColdStart = selectedDemo === 'demo_newuser';

  const handleColdStartComplete = (generatedProfile, generatedRecords) => {
    setProfile(generatedProfile);
    setRecords(generatedRecords);
    setDemoChip(true);
    clearTimeout(chipTimer.current);
    chipTimer.current = setTimeout(() => setDemoChip(false), 4000);
  };

  const canSimulate = profile !== null && targetItem.name.trim() !== '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 md:p-6 min-h-[calc(100vh-56px)]">

      {/* Left col — inputs */}
      <div className="bg-[#13131A] border border-[#1E1E2E] rounded-xl p-5">
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
          <label htmlFor="records-input" className="text-xs text-[#64748B] block mb-1.5">Review Records (JSON)</label>
          <textarea
            id="records-input" rows={6}
            placeholder="Paste JSON review records here, or select a demo user above."
            value={records.length ? JSON.stringify(records, null, 2) : ''}
            onChange={e => { try { setRecords(JSON.parse(e.target.value)); } catch { } }}
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, resize: 'vertical', minHeight: 120 }}
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

        <div className="h-px bg-[#1E1E2E] mb-5" />
        <SectionHeader num="02" label="Target Item" />

        <div className="mb-2.5">
          <label htmlFor="item-name" className="text-xs text-[#64748B] block mb-1.5">Place Name</label>
          <input id="item-name" type="text" placeholder="e.g. Chicken Republic Lekki"
            value={targetItem.name} onChange={e => setTargetItem(t => ({ ...t, name: e.target.value }))} />
          {!targetItem.name && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PLACE_SUGGESTIONS.map(s => (
                <button key={s.name} onClick={() => setTargetItem(s)}
                  aria-label={`Use suggestion: ${s.name}`}
                  className="rounded-full border border-[#1E1E2E] bg-[#1E1E2E] text-[#94A3B8] text-xs px-3 py-1 cursor-pointer transition-all duration-200 hover:border-[#6366F1] hover:bg-[rgba(99,102,241,0.12)] hover:text-[#F8FAFC]">
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mb-2.5">
          <label htmlFor="item-desc" className="text-xs text-[#64748B] block mb-1.5">Description (optional)</label>
          <input id="item-desc" type="text" placeholder="e.g. Fast food, Nigerian cuisine"
            value={targetItem.description} onChange={e => setTargetItem(t => ({ ...t, description: e.target.value }))} />
        </div>

        <div className="mb-2.5">
          <label htmlFor="item-categories" className="text-xs text-[#64748B] block mb-1.5">Categories (optional)</label>
          <input id="item-categories" type="text" placeholder="e.g. Nigerian, Fast Food, Casual"
            value={targetItem.categories} onChange={e => setTargetItem(t => ({ ...t, categories: e.target.value }))} />
        </div>

        <div className="mb-3.5">
          <label htmlFor="item-context" className="text-xs text-[#64748B] block mb-1.5">Context (optional)</label>
          <input id="item-context" type="text" placeholder="e.g. Dinner with family, late night, special occasion"
            value={targetItem.context} onChange={e => setTargetItem(t => ({ ...t, context: e.target.value }))} />
        </div>

        <div className="mb-3.5">
          <Toggle on={useLLM} onToggle={() => setUseLLM(v => !v)} label="Use LLM" />
          {useLLM && (
            <div className="mt-2 bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.3)] rounded-lg px-2.5 py-1.5 text-xs text-[#F59E0B]"
              style={{ animation: reduced ? 'none' : 'fadeSlideIn 0.2s ease' }}>
              ⚡ LLM mode adds ~3s latency
            </div>
          )}
        </div>

        <button
          onClick={handleSimulate}
          disabled={!canSimulate || outputLoading}
          title={!canSimulate ? 'Build a profile first' : ''}
          className="w-full border-none rounded-lg py-2.5 font-semibold text-sm cursor-pointer disabled:cursor-not-allowed"
          style={{
            background: canSimulate ? '#F59E0B' : '#1E1E2E',
            color: canSimulate ? '#0A0A0F' : '#64748B',
          }}
        >
          {outputLoading
            ? <div className="skeleton h-4 w-3/5 mx-auto rounded" />
            : 'Simulate Review'}
        </button>
      </div>

      {/* Center col — profile */}
      <div>
        <ProfilePanel profile={profile} loading={profileLoading} pageContext="task-a" />
      </div>

      {/* Right col — trace + fidelity + output */}
      <div className="flex flex-col gap-4">
        <TracePanel trace={output?.reasoning ?? null} mode="text" loading={traceLoading} />
        <FidelityDashboard profile={profile} output={output} />
        <OutputPanel output={output} loading={outputLoading} profile={profile} userId={selectedDemo || 'custom_user'} />
      </div>
    </div>
  );
}
