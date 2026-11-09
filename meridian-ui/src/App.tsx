import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { api } from "./api";
import { RequireAuth, getUser, logout } from "./auth";
import ChatWidget from "./components/ChatWidget";
import { resetMockStore } from "./mocks/mockApi";
import Dashboard from "./pages/Dashboard";
import IntakeForm from "./pages/IntakeForm";
import Login from "./pages/Login";
import ManifestUpload from "./pages/ManifestUpload";
import MyRequests from "./pages/MyRequests";
import Results from "./pages/Results";
import { setUseMockApi } from "./runtimeEnv";

function Header() {
  const navigate = useNavigate();
  const user = getUser();
  const mock = api.mode === "mock";
  const toggle = () => {
    setUseMockApi(!mock);
    window.location.reload();
  };
  return (
    <header className="app-header">
      <NavLink to="/" className="brand"><span className="brand-mark">A</span>Aura Digital Thread</NavLink>
      <nav className="nav">
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/intake/new">New intake</NavLink>
        <NavLink to="/requests">My requests</NavLink>
        <NavLink to="/manifest">Manifest upload</NavLink>
      </nav>
      <div className="header-right">
        <span className={`switch ${mock ? "on" : ""}`} onClick={toggle} role="switch" aria-checked={mock} tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggle()} title="Switch between the in-browser mock API and the backend">
          <span className="track"><span className="thumb" /></span>
          {mock ? "Mock data" : "Live data"}
        </span>
        {mock && (
          <button className="btn-sm btn-ghost" title="Reset in-browser mock data" onClick={() => { resetMockStore(); window.location.reload(); }}>Reset</button>
        )}
        <span className="small muted" title={user?.email}>{user?.name}</span>
        <button className="btn-sm" onClick={() => { logout(); navigate("/login"); }}>Sign out</button>
      </div>
    </header>
  );
}

function Layout() {
  return (
    <>
      <Header />
      <main className="main">
        <Outlet />
      </main>
      <ChatWidget />
    </>
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
