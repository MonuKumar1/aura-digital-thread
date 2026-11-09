import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "../auth";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

export default function Login() {
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Enter your name.");
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address.");
    login({ name, email });
    navigate(from, { replace: true });
  }

  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={submit}>
        <div className="brand" style={{ fontSize: 20 }}><span className="brand-mark">A</span>Aura Digital Thread</div>
        <p className="muted">One intake, eight specialist agents, one evidence package. Sign in with the mock SSO: any name and email work.</p>
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} /></label>
        <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="you@example.com" /></label>
        {error && <div className="error-box">{error}</div>}
        <button className="btn-primary" type="submit" style={{ justifyContent: "center" }}>Continue with SSO</button>
        <button type="button" className="btn-ghost small" onClick={() => { setName("Alex Rivera"); setEmail("alex.rivera@example.com"); }}>
          Use demo sponsor (alex.rivera@example.com)
        </button>
      </form>
    </div>
  );
}
