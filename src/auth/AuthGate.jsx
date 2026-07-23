import React, { useEffect, useState } from "react";
import { isConfigured, getSession, onAuthChange, signInWithEmail, signOut } from "../lib/auth";
import App from "../App";

const NAVY = "#112138";
const RED = "#FD0E33";

function Wordmark({ size = 46 }) {
  return <img src="/cmac-logo.png" alt="cmac." style={{ height: size, width: "auto", display: "block" }} />;
}

function Shell({ children }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(160deg,#EDF1F2 0%,#DCE3E8 100%)",
        padding: 20,
        fontFamily: "Montserrat, 'Segoe UI', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "min(420px, 100%)",
          background: "#fff",
          border: "1px solid #E1E7EC",
          borderTop: "4px solid " + RED,
          borderRadius: 16,
          padding: "30px 30px 28px",
          boxShadow: "0 18px 50px rgba(17,33,56,.14)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Splash({ text }) {
  return (
    <Shell>
      <div style={{ textAlign: "center", color: "#5C6675" }}>
        <Wordmark />
        <div style={{ marginTop: 18, fontSize: 13 }}>{text}</div>
      </div>
    </Shell>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ status: "idle", msg: "" });

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setState({ status: "sending", msg: "" });
    try {
      const { error } = await signInWithEmail(email);
      if (error) throw error;
      setState({ status: "sent", msg: "" });
    } catch (err) {
      setState({ status: "error", msg: err?.message || "Could not send the link. Please try again." });
    }
  };

  const label = { fontSize: 10, textTransform: "uppercase", letterSpacing: "1.1px", color: "#5C6675", fontWeight: 800, display: "block", marginBottom: 6 };
  const input = { width: "100%", fontFamily: "inherit", fontSize: 14, padding: "10px 12px", border: "1.5px solid #C7CFD8", borderRadius: 10, color: NAVY };
  const btn = { width: "100%", marginTop: 14, background: RED, color: "#fff", border: "none", borderRadius: 999, padding: "11px 16px", fontSize: 14, fontWeight: 800, fontFamily: "inherit", cursor: "pointer" };

  return (
    <Shell>
      <Wordmark />
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "2.2px", color: "#7E8BA1", fontWeight: 800, marginTop: 8 }}>
        Operations Command Centre
      </div>

      {state.status === "sent" ? (
        <div style={{ marginTop: 22 }}>
          <div style={{ background: "#F0F8F2", border: "1px solid #BFE0C8", borderLeft: "4px solid #1A7F44", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#0F5C2E", lineHeight: 1.5 }}>
            <b>Check your inbox.</b> We've emailed a secure sign-in link to
            <br />
            <b>{email}</b>. Open it on this device to continue.
          </div>
          <button style={{ ...btn, background: "#fff", color: NAVY, border: "1.5px solid #C7CFD8", marginTop: 12 }} onClick={() => setState({ status: "idle", msg: "" })}>
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={submit} style={{ marginTop: 22 }}>
          <label style={label} htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            autoFocus
            autoComplete="email"
            required
            placeholder="you@cmacgroup.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={input}
          />
          {state.status === "error" && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: RED }}>{state.msg}</div>
          )}
          <button type="submit" style={btn} disabled={state.status === "sending"}>
            {state.status === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
          <div style={{ marginTop: 14, fontSize: 11.5, color: "#8A93A1", lineHeight: 1.5, textAlign: "center" }}>
            No password needed. We'll send a one-time secure link.
          </div>
        </form>
      )}
    </Shell>
  );
}

export default function AuthGate() {
  const [state, setState] = useState({ loading: true, session: null });

  useEffect(() => {
    let mounted = true;
    getSession().then((s) => {
      if (mounted) setState({ loading: false, session: s });
    });
    const off = onAuthChange((s) => setState({ loading: false, session: s }));
    return () => {
      mounted = false;
      off();
    };
  }, []);

  if (state.loading) return <Splash text="Starting your command centre…" />;
  if (isConfigured && !state.session) return <Login />;

  const auth = {
    mode: state.session?.mode || (isConfigured ? "cloud" : "local"),
    email: state.session?.user?.email || (isConfigured ? "" : "Local device"),
    signOut,
  };

  return <App auth={auth} />;
}
