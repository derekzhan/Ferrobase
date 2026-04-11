import { useEffect, useRef } from 'react';
import { X, Github, Mail, Heart } from 'lucide-react';
import { FerrobaseIcon } from './icons/DbIcons';
import { useThemeStore } from '../stores';

interface AboutDialogProps {
  onClose: () => void;
}

const APP_VERSION = '0.1.1';
const BUILD_DATE = '2026-04-10';
const GITHUB_URL = 'https://github.com/derekzhan/Ferrobase';
const CONTACT_EMAIL = 'weichun.zhan@gmail.com';

export function AboutDialog({ onClose }: AboutDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog */}
      <div className="relative bg-[var(--bg-primary)] rounded-2xl shadow-2xl border border-[var(--border)] w-[420px] overflow-hidden animate-in fade-in zoom-in-95">
        {/* Gradient header — adapts to theme */}
        <div className={`relative h-36 flex items-center justify-center overflow-hidden ${
          isDark
            ? 'bg-gradient-to-br from-slate-800 via-slate-900 to-gray-950'
            : 'bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700'
        }`}>
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10">
            <svg width="100%" height="100%">
              <defs>
                <pattern id="about-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="10" cy="10" r="1" fill={isDark ? '#60A5FA' : 'white'} />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#about-grid)" />
            </svg>
          </div>
          <div className="relative flex flex-col items-center gap-2">
            <div className={`w-16 h-16 rounded-2xl backdrop-blur-sm flex items-center justify-center shadow-lg border ${
              isDark
                ? 'bg-blue-500/10 border-blue-400/20'
                : 'bg-white/20 border-white/30'
            }`}>
              <FerrobaseIcon size={40} />
            </div>
          </div>
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="px-8 py-6 text-center">
          <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1">Ferrobase</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            Lightweight Cross-Platform Database Client
          </p>

          {/* Version info */}
          <div className="bg-[var(--bg-secondary)] rounded-xl p-4 mb-5 text-left space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">Version</span>
              <span className="text-[var(--text-primary)] font-mono font-medium">v{APP_VERSION}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">Build Date</span>
              <span className="text-[var(--text-primary)] font-mono font-medium">{BUILD_DATE}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">Platform</span>
              <span className="text-[var(--text-primary)] font-mono font-medium">Tauri 2 + React</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">License</span>
              <span className="text-[var(--text-primary)] font-mono font-medium">MIT</span>
            </div>
          </div>

          {/* Links */}
          <div className="flex items-center justify-center gap-4 mb-5">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            >
              <Github size={14} />
              <span>GitHub</span>
            </a>
            <span className="text-[var(--border)]">|</span>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            >
              <Mail size={14} />
              <span>{CONTACT_EMAIL}</span>
            </a>
          </div>

          {/* Footer */}
          <p className="text-[10px] text-[var(--text-muted)] flex items-center justify-center gap-1">
            Made with <Heart size={10} className="text-red-500 fill-red-500" /> by Derek Zhan
          </p>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">
            &copy; 2026 Ferrobase. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
