import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { login } from "../auth";
import Icon, { type IconName } from "../components/Icon";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

const POINTS: { icon: IconName; text: string }[] = [
  { icon: "file", text: "One intake form instead of 120 questions in 11 systems" },
  { icon: "layers", text: "Eight specialist agents run only where they apply" },
  { icon: "shield", text: "A single evidence package with every control referenced" },
];

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
      <section className="login-hero">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-text"><strong>Aura</strong><small>Digital Thread</small></span>
        </div>
        <div>
          <h1>Governance that keeps pace with delivery</h1>
          <p>Describe a change once. Aura works out which assessments apply, gathers the evidence and tells you whether it can go straight through.</p>
        </div>
        <ul className="login-points">
          {POINTS.map((p) => <li key={p.text}><Icon name={p.icon} size={18} />{p.text}</li>)}
        </ul>
      </section>
      <section className="login-pane">
        <form className="login-card stack" onSubmit={submit} noValidate>
          <div>
            <h2>Sign in</h2>
            <p className="muted">This demo uses mock SSO, so any name and email work.</p>
          </div>
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} autoComplete="name" /></label>
          <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="you@example.com" autoComplete="email" /></label>
          {error && <div className="error-box" role="alert">{error}</div>}
          <button className="btn-primary btn-block" type="submit">Continue with SSO</button>
          <button type="button" className="btn-ghost btn-block" onClick={() => { setName("Alex Rivera"); setEmail("alex.rivera@example.com"); setError(""); }}>
            Fill in the demo sponsor
          </button>
        </form>
      </section>
    </div>
  );
}
