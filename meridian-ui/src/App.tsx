import { useState } from "react";
import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "./api";
import { RequireAuth, getUser, logout } from "./auth";
import ChatWidget from "./components/ChatWidget";
import Icon, { type IconName } from "./components/Icon";
import { initials } from "./format";
import { resetMockStore } from "./mocks/mockApi";
import Dashboard from "./pages/Dashboard";
import IntakeForm from "./pages/IntakeForm";
import Login from "./pages/Login";
import ManifestUpload from "./pages/ManifestUpload";
import MyRequests from "./pages/MyRequests";
import Results from "./pages/Results";
import { setUseMockApi } from "./runtimeEnv";
import { getTheme, setTheme, type Theme } from "./theme";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "Dashboard", icon: "grid", end: true },
  { to: "/intake/new", label: "New intake", icon: "plus" },
  { to: "/requests", label: "My requests", icon: "list" },
  { to: "/manifest", label: "Manifest upload", icon: "upload" },
];

function Sidebar() {
  const navigate = useNavigate();
  const user = getUser();
  const mock = api.mode === "mock";
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const toggleMode = () => {
    setUseMockApi(!mock);
    window.location.reload();
  };
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
  };
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand">
        <span className="brand-mark">A</span>
        <span className="brand-text"><strong>Aura</strong><small>Digital Thread</small></span>
      </NavLink>
      <nav className="side-nav" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} size={17} />{n.label}</NavLink>
        ))}
      </nav>
      <div className="side-foot">
        <div className="mode-card">
          <span className={`switch ${mock ? "on" : ""}`} onClick={toggleMode} role="switch" aria-checked={mock} tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleMode()} title="Switch between the in-browser mock API and the backend">
            <span className="track"><span className="thumb" /></span>
            {mock ? "Mock data" : "Live data"}
          </span>
          {mock && (
            <button className="btn-sm btn-ghost" title="Restore the seed mock data" onClick={() => { resetMockStore(); window.location.reload(); }}>Reset</button>
          )}
        </div>
        <div className="user-row">
          <span className="avatar" aria-hidden>{initials(user?.name)}</span>
          <div className="user-meta">
            <div className="name">{user?.name}</div>
            <div className="small muted">{user?.email}</div>
          </div>
          <button className="btn-icon" onClick={toggleTheme} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} aria-label="Toggle theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
          <button className="btn-icon" onClick={() => { logout(); navigate("/login"); }} title="Sign out" aria-label="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function Layout() {
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
      <ChatWidget />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/intake/new" element={<IntakeForm />} />
        <Route path="/requests" element={<MyRequests />} />
        <Route path="/results/:id" element={<Results />} />
        <Route path="/manifest" element={<ManifestUpload />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
