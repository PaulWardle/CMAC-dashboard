import React, { useEffect, useState } from "react";
import { isConfigured, getSession, onAuthChange, signInWithPassword, signOut } from "../lib/auth";
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail, isAdminEmail } from "../lib/config";
import App from "../App";

/* Brand palette — from the CMAC brand guidelines */
const NAVY = "#112138";
const RED = "#FD0E33";
const MUT = "#7E8BA1";

function Shell({ children }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: NAVY,
        padding: 24,
        fontFamily: "'Montserrat','Segoe UI',system-ui,sans-serif",
      }}
    >
      <div style={{ width: "min(400px, 100%)" }}>{children}</div>
    </div>
  );
}

function Logo({ height = 44 }) {
  return <img src="/cmac-logo-white.png" alt="cmac." style={{ height, width: "auto", display: "block" }} />;
}

function Splash({ text }) {
  return (
    <Shell>
      <Logo />
      <div style={{ marginTop: 26, fontSize: 13, color: MUT, fontWeight: 600 }}>{text}</div>
    </Shell>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState({ status: "idle", msg: "" });

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (!isAllowedEmail(email)) {
      setState({ status: "error", msg: "Please use your @" + ALLOWED_EMAIL_DOMAIN + " email address." });
      return;
    }
    setState({ status: "sending", msg: "" });
    try {
      const { error } = await signInWithPassword(email, password);
      if (error) throw error;
      // Success: the auth listener flips straight into the app.
    } catch (err) {
      const raw = (err?.message || "").toLowerCase();
      setState({
        status: "error",
        msg: raw.includes("invalid") ? "Incorrect email or password." : err?.message || "Could not sign you in. Please try again.",
      });
    }
  };

  const input = {
    width: "100%",
    fontFamily: "inherit",
    fontSize: 15,
    fontWeight: 600,
    padding: "13px 16px",
    border: "none",
    borderRadius: 10,
    color: NAVY,
    background: "#fff",
    outline: "none",
  };
  const btn = {
    width: "100%",
    marginTop: 12,
    background: RED,
    color: "#fff",
    border: "none",
    borderRadius: 999,
    padding: "13px 18px",
    fontSize: 14.5,
    fontWeight: 800,
    fontFamily: "inherit",
    cursor: "pointer",
    letterSpacing: ".2px",
  };

  return (
    <Shell>
      <Logo />
      <h1 style={{ color: "#fff", fontSize: 30, fontWeight: 800, letterSpacing: "-.5px", lineHeight: 1.15, margin: "34px 0 8px" }}>
        Operations<br />Command Centre<span style={{ color: RED }}>.</span>
      </h1>
      <p style={{ color: MUT, fontSize: 13.5, fontWeight: 600, margin: "0 0 30px", lineHeight: 1.5 }}>
        One source of truth for actions, projects, mobilisations and reporting.
      </p>

      <form onSubmit={submit}>
        <label
          htmlFor="email"
          style={{ display: "block", fontSize: 10, textTransform: "uppercase", letterSpacing: "1.8px", color: MUT, fontWeight: 800, marginBottom: 8 }}
        >
          Work email
        </label>
        <input
          id="email"
          type="email"
          autoFocus
          autoComplete="email"
          required
          placeholder={"name@" + ALLOWED_EMAIL_DOMAIN}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={input}
        />
        <label
          htmlFor="password"
          style={{ display: "block", fontSize: 10, textTransform: "uppercase", letterSpacing: "1.8px", color: MUT, fontWeight: 800, margin: "14px 0 8px" }}
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={input}
        />
        {state.status === "error" && (
          <div style={{ marginTop: 10, fontSize: 13, color: "#FF6B85", fontWeight: 600 }}>{state.msg}</div>
        )}
        <button type="submit" style={btn} disabled={state.status === "sending"}>
          {state.status === "sending" ? "Signing in…" : "Sign in"}
        </button>
        <div style={{ marginTop: 16, fontSize: 12, color: MUT, fontWeight: 600, textAlign: "center", lineHeight: 1.6 }}>
          You'll stay signed in on this device.<br />
          Need an account or forgotten your password? Contact Paul Wardle.
        </div>
      </form>
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

  const mode = state.session?.mode || (isConfigured ? "cloud" : "local");
  const email = state.session?.user?.email || (isConfigured ? "" : "Local device");
  const auth = {
    mode,
    email,
    // Local mode is single-user, full control. In cloud mode only the
    // administrator account(s) can edit; RLS enforces this server-side too.
    canEdit: mode === "local" || isAdminEmail(email),
    signOut,
  };

  return <App auth={auth} />;
}
