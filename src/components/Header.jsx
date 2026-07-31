import React from "react";
import { Moon, Sun, Settings as SettingsIcon, Cloud, CloudOff, RefreshCw, CloudUpload } from "lucide-react";
import { ACCENT, DISPLAY_FONT, MONO_FONT, TEAL, AMBER } from "../theme.js";

/* Compact sync indicator. Silent when there is nothing to say: a deployment
   without the backend shows no chip at all rather than a permanently broken
   cloud icon. */
function SyncChip({ sync, onOpenSettings, online }) {
  if (!online) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-1 rounded-full"
            style={{ fontFamily: MONO_FONT, color: AMBER, background: AMBER + "18" }} title="No connection — changes are saved on this device">
        <CloudOff size={12} strokeWidth={2} /> offline
      </span>
    );
  }
  if (!sync || !sync.capability.sync) return null;

  const { status, user } = sync;
  if (!user) {
    return (
      <button onClick={onOpenSettings} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-1 rounded-full mz-tx2 mz-hovi"
              style={{ fontFamily: MONO_FONT }} title="Sign in to sync across devices">
        <Cloud size={12} strokeWidth={2} /> sync off
      </button>
    );
  }
  const busy = status === "syncing";
  const bad = status === "error" || status === "offline";
  const color = bad ? AMBER : busy ? ACCENT : TEAL;
  const Icon = bad ? CloudOff : busy ? RefreshCw : CloudUpload;
  return (
    <button
      onClick={sync.syncNow}
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-1 rounded-full"
      style={{ fontFamily: MONO_FONT, color, background: color + "18" }}
      title={bad ? "Sync didn't complete — tap to retry" : busy ? "Syncing…" : "Synced — tap to sync now"}
    >
      <Icon size={12} strokeWidth={2} className={busy ? "mz-spin" : undefined} />
      {bad ? "retry" : busy ? "syncing" : "synced"}
    </button>
  );
}

export default function Header({ theme, onToggleTheme, onOpenSettings, sync, online }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-4">
      <div className="flex items-baseline gap-3 min-w-0">
        <h1 className="text-2xl tracking-tight mz-tx1" style={{ fontFamily: DISPLAY_FONT, fontWeight: 700 }}>Mizan</h1>
        <span className="text-lg" style={{ fontFamily: DISPLAY_FONT, color: ACCENT }}>ميزان</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <SyncChip sync={sync} onOpenSettings={onOpenSettings} online={online} />
        {/* the strapline is the first thing to go when the row gets tight */}
        <span className="hidden sm:inline text-[11px] uppercase tracking-widest mz-tx2 ml-1" style={{ fontFamily: MONO_FONT }}>
          net worth · live gold
        </span>
        <button onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} className="mz-iconbtn mz-tx2">
          {theme === "dark" ? <Sun size={16} strokeWidth={2} /> : <Moon size={16} strokeWidth={2} />}
        </button>
        <button onClick={onOpenSettings} aria-label="Settings" className="mz-iconbtn mz-tx2 -mr-2">
          <SettingsIcon size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
