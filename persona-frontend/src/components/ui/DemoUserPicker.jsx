import { DEMO_USERS } from '../../lib/demo-users';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function DemoUserPicker({ selected, onSelect }) {
  return (
    <div className="grid grid-cols-3 gap-2 mb-3">
      {Object.entries(DEMO_USERS).map(([key, user]) => {
        const isSelected = selected === key;
        const isNewUser  = key === 'demo_newuser';
        const initials   = user.displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            aria-label={`Select demo user ${user.displayName}`}
            aria-pressed={isSelected}
            className="flex flex-col items-center gap-1 rounded-xl border p-3 cursor-pointer transition-all duration-200"
            style={{
              background: isSelected ? `${user.accent}12` : '#0A0A0F',
              borderColor: isSelected ? user.accent : '#1E1E2E',
              borderStyle: isNewUser && !isSelected ? 'dashed' : 'solid',
              boxShadow: isSelected ? `0 0 0 1px ${user.accent}` : 'none',
              transform: isSelected && !reduced ? 'translateY(-1px)' : 'none',
            }}
          >
            {/* Avatar */}
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
              style={{
                background: isSelected ? user.accent : '#1E1E2E',
                color: isSelected ? '#0A0A0F' : '#64748B',
              }}
            >
              {isNewUser && !isSelected ? '?' : initials}
            </div>

            {/* Name */}
            <span
              className="text-[11px] font-semibold text-center leading-tight"
              style={{ color: isSelected ? user.accent : '#F8FAFC' }}
            >
              {user.displayName}
            </span>

            {/* Rating / hint */}
            <span
              className="text-[10px] text-center leading-tight"
              style={{
                fontFamily: isNewUser ? 'inherit' : 'JetBrains Mono, monospace',
                color: isSelected ? user.accent : '#64748B',
              }}
            >
              {isNewUser ? '4 questions' : user.avgRating}
            </span>
          </button>
        );
      })}
    </div>
  );
}
