import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getToken, TOKEN_KEY } from "@/lib/api";
import { Zap, LayoutDashboard, Flame, BookOpen, LogOut, Moon, Sun } from "lucide-react";

const logout = () => {
  window.localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event("dealloot-auth"));
};

const base = "flex items-center gap-2 rounded-full px-2.5 sm:px-4 py-2 text-sm font-semibold transition-colors duration-200";
const active = "bg-slate-900 text-white";
const idle = "text-slate-700 hover:bg-slate-100 hover:text-slate-950";

const useIsAdmin = () => {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    const sync = () => setAdmin(!!getToken());
    sync();
    window.addEventListener("dealloot-auth", sync);
    return () => window.removeEventListener("dealloot-auth", sync);
  }, []);
  return admin;
};

const useTheme = () => {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("dealloot-theme", next ? "dark" : "light");
    setDark(next);
  };
  return [dark, toggle] as const;
};

export const Navbar = () => {
  const admin = useIsAdmin();
  const [dark, toggleTheme] = useTheme();
  return (

  <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl">
    <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-8">
      <Link to="/" data-testid="brand-logo-link" className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#FF5A1F] text-white">
          <Zap className="h-5 w-5" strokeWidth={2.5} />
        </span>
        <span className="font-display text-xl font-extrabold tracking-tight">
          Deal<span className="text-[#FF5A1F]">Loot</span>
        </span>
      </Link>
      <nav className="flex items-center gap-0.5 sm:gap-1">
        <Link to="/" activeOptions={{ exact: true }} className={base} activeProps={{ className: active }} inactiveProps={{ className: idle }} data-testid="public-deals-nav-link">
          <Flame className="h-4 w-4" /> <span className="hidden sm:inline">Deals</span>
        </Link>
        <a href="/guides" data-testid="guides-nav-link" aria-label="Shopping guides" className={`${base} ${idle}`}><BookOpen className="h-4 w-4" /><span className="hidden sm:inline">Guides</span></a>
        <button type="button" onClick={toggleTheme} data-testid="theme-toggle-button" aria-label={dark ? "Switch to normal mode" : "Switch to dark mode"} title={dark ? "Normal mode" : "Dark mode"} className={`${base} ${idle}`}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        {admin && <Link to="/admin" aria-label="Control Room" className={base} activeProps={{ className: active }} inactiveProps={{ className: idle }} data-testid="admin-dashboard-nav-link">
          <LayoutDashboard className="h-4 w-4" /> <span className="hidden sm:inline">Control Room</span>
        </Link>}
        {admin && <button type="button" onClick={logout} aria-label="Log out" className={`${base} border border-slate-300 text-slate-700 hover:bg-red-50 hover:text-red-700`} data-testid="admin-logout-button">
          <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Log out</span>
        </button>}
      </nav>
    </div>
  </header>
  );
};
