import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { useToast } from './Toast';

export default function AppShell() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const handleReset = () => {
    window.dispatchEvent(new CustomEvent('persona:reset'));
    navigate('/');
    showToast('Demo reset ✓', 'success');
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F]">
      <nav className="fixed top-0 left-0 right-0 h-14 z-50 bg-[#0A0A0F] border-b border-[#1E1E2E] flex items-center px-4 md:px-6 gap-4">

        {/* Logo */}
        <button
          onClick={() => navigate('/')}
          aria-label="Go to home"
          className="flex items-center gap-2 bg-transparent border-none cursor-pointer shrink-0"
        >
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <circle cx="14" cy="14" r="13" stroke="#F59E0B" strokeWidth="1.5" />
            <circle cx="14" cy="10" r="3" fill="#F59E0B" />
            <circle cx="8" cy="18" r="2" fill="#F59E0B" opacity="0.7" />
            <circle cx="20" cy="18" r="2" fill="#F59E0B" opacity="0.7" />
            <line x1="14" y1="13" x2="8" y2="18" stroke="#F59E0B" strokeWidth="1" opacity="0.5" />
            <line x1="14" y1="13" x2="20" y2="18" stroke="#F59E0B" strokeWidth="1" opacity="0.5" />
            <line x1="8" y1="18" x2="20" y2="18" stroke="#F59E0B" strokeWidth="1" opacity="0.3" />
          </svg>
          <span className="font-bold text-base text-[#F8FAFC] tracking-widest hidden sm:inline" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            PERSONA
          </span>
        </button>

        {/* Center nav */}
        <div className="flex-1 flex justify-center gap-1 md:gap-2">
          {[{ to: '/task-a', label: 'Task A' }, { to: '/task-b', label: 'Task B' }].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `px-3 md:px-5 py-1.5 rounded-full text-sm font-semibold no-underline transition-all duration-200 ${
                  isActive
                    ? 'text-[#F59E0B] bg-[rgba(245,158,11,0.08)] shadow-[0_2px_0_#F59E0B]'
                    : 'text-[#64748B] bg-transparent'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>

        {/* Right */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0">
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `text-sm no-underline transition-colors duration-200 hidden sm:inline ${isActive ? 'text-[#F8FAFC]' : 'text-[#64748B]'}`
            }
          >
            About
          </NavLink>

          {/* GitHub Repo Link (SVG) */}
          <a
            href="https://github.com/Techdee1/Persona.git"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-[#64748B] hover:text-[#F8FAFC] transition-colors duration-200"
            aria-label="View source code on GitHub"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.285 0 .315.21.69.825.57C20.565 21.795 24 17.31 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>

          <button
            onClick={handleReset}
            aria-label="Reset demo"
            className="hidden md:flex items-center gap-1.5 bg-transparent border border-[#1E1E2E] rounded-lg text-[#64748B] text-xs px-3 py-1.5 cursor-pointer transition-all duration-200 hover:border-[#6366F1] hover:text-[#F8FAFC]"
          >
            <RotateCcw size={12} />
            Reset Demo
          </button>

          <span className="bg-[#13131A] border border-[#1E1E2E] rounded-full px-2.5 py-1 text-[10px] md:text-[11px] text-[#F59E0B] font-semibold tracking-wide whitespace-nowrap">
            DSN x BCT · Hackathon 3.0
          </span>
        </div>
      </nav>

      <div className="pt-14 min-h-[calc(100vh-56px)]">
        <Outlet />
      </div>
    </div>
  );
}