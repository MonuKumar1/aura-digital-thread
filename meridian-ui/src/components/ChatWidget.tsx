import { useEffect, useRef, useState } from "react";
import { useMatch } from "react-router-dom";
import { api } from "../api";
import Icon from "./Icon";
import type { ChatTurn, IntakeListItem, ToolTraceItem } from "../types";

interface Message extends ChatTurn {
  trace?: ToolTraceItem[];
}

const SUGGESTIONS = ["Why is this blocked?", "What follow-up questions are pending?", "Show the CMDB record", "What is the coverage?", "When is the stage due?"];

export default function ChatWidget() {
  const match = useMatch("/results/:id");
  const routeId = match ? Number(match.params.id) : null;
  const [open, setOpen] = useState(false);
  const [intakeId, setIntakeId] = useState<number | null>(routeId);
  const [intakes, setIntakes] = useState<IntakeListItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (routeId && routeId !== intakeId) {
      setIntakeId(routeId);
      setMessages([]);
    }
  }, [routeId, intakeId]);

  useEffect(() => {
    if (open && !routeId && !intakes.length) {
      api.listIntakes({ page: 1, page_size: 50, sort_by: "created_at", sort_dir: "desc" }).then((p) => setIntakes(p.items)).catch(() => undefined);
    }
  }, [open, routeId, intakes.length]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || !intakeId || busy) return;
    const history: ChatTurn[] = messages.map(({ role, content: c }) => ({ role, content: c }));
    setMessages((m) => [...m, { role: "user", content }]);
    setInput("");
    setBusy(true);
    try {
      const res = await api.chat(intakeId, content, history);
      setMessages((m) => [...m, { role: "assistant", content: res.answer, trace: res.tool_trace }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Sorry, that failed: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && (
        <div className="chat-panel" role="dialog" aria-label="Ask Aura">
          <div className="chat-head">
            <span className="avatar" style={{ width: 28, height: 28 }}><Icon name="sparkle" size={14} /></span>
            <strong>Ask Aura</strong>
            <span className="spacer" />
            {intakeId && <span className="badge badge-accent">Intake #{intakeId}</span>}
            <button className="btn-icon" onClick={() => setOpen(false)} aria-label="Close chat"><Icon name="x" /></button>
          </div>
          {!routeId && (
            <div style={{ padding: "12px 16px 0" }}>
              <select value={intakeId ?? ""} onChange={(e) => { setIntakeId(e.target.value ? Number(e.target.value) : null); setMessages([]); }}>
                <option value="">Choose an initiative…</option>
                {intakes.map((i) => <option key={i.id} value={i.id}>#{i.id} {i.initiative_name}</option>)}
              </select>
            </div>
          )}
          <div className="chat-body" ref={bodyRef}>
            {!messages.length && (
              <div className="muted small">Ask about this initiative's agents, follow-ups, CMDB record, coverage, status or deadlines. Answers come from tool calls you can inspect.</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                {m.content}
                {m.trace && m.trace.length > 0 && (
                  <details className="chat-trace">
                    <summary>{m.trace.length} tool call(s)</summary>
                    {m.trace.map((t, j) => (
                      <code key={j}>{t.tool}({JSON.stringify(t.arguments)}) → {t.result_preview.slice(0, 160)}…</code>
                    ))}
                  </details>
                )}
              </div>
            ))}
            {busy && <div className="chat-msg assistant"><span className="spinner" style={{ display: "inline-block", width: 12, height: 12 }} /> thinking…</div>}
          </div>
          {intakeId && !messages.length && (
            <div className="chat-suggest">
              {SUGGESTIONS.map((s) => <button key={s} className="btn-sm" onClick={() => send(s)}>{s}</button>)}
            </div>
          )}
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <input value={input} maxLength={4000} onChange={(e) => setInput(e.target.value)} placeholder={intakeId ? "Ask a question…" : "Choose an initiative first"} disabled={!intakeId} />
            <button className="btn-primary" type="submit" aria-label="Send" disabled={!intakeId || busy || !input.trim()}><Icon name="send" /></button>
          </form>
        </div>
      )}
      <button className="btn-primary chat-fab" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? "Close chat" : "Ask Aura"}>
        <Icon name={open ? "x" : "chat"} /><span className="fab-label">{open ? "Close" : "Ask Aura"}</span>
      </button>
    </>
  );
}
