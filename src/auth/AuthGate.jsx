import React, { useEffect, useState } from "react";
import { isConfigured, getSession, onAuthChange, signInWithPassword, signUpWithPassword, fetchProfile, signOut } from "../lib/auth";
import { ALLOWED_EMAIL_DOMAIN, isAllowedEmail } from "../lib/config";
import App from "../App";

/* Brand palette — from the CMAC brand guidelines */
const NAVY = "#112138";
const RED = "#FD0E33";
const MUT = "#7E8BA1";

const inputStyle = {
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
const btnStyle = {
  width: "100%",
  marginTop: 14,
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
const ghostBtn = { ...btnStyle, background: "transparent", border: "1.5px solid #3A4E6D", color: "#C9D1DD" };
const labelStyle = { display: "block", fontSize: 10, textTransform: "uppercase", letterSpacing: "1.8px", color: MUT, fontWeight: 800, margin: "14px 0 8px" };

function Shell({ children }) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: NAVY, padding: 24, fontFamily: "'Montserrat','Segoe UI',system-ui,sans-serif" }}>
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

function Login({ onSignedIn }) {
  const [mode, setMode] = useState("signin"); // signin | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState({ status: "idle", msg: "" });

  const fail = (msg) => setState({ status: "error", msg });

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (!isAllowedEmail(email)) return fail("Please use your @" + ALLOWED_EMAIL_DOMAIN + " email address.");
    if (mode === "register" && password.length < 8) return fail("Choose a password of at least 8 characters.");
    setState({ status: "busy", msg: "" });
    try {
      if (mode === "signin") {
        const { error } = await signInWithPassword(email, password);
        if (error) {
          const raw = (error.message || "").toLowerCase();
          if (raw.includes("invalid")) {
            return fail("No account with that password. New here? Use \"Create account\" below.");
          }
          throw error;
        }
      } else {
        const { data, error } = await signUpWithPassword(email, password);
        if (error) {
          const raw = (error.message || "").toLowerCase();
          if (raw.includes("already registered") || raw.includes("already exists")) {
            return fail("That email already has an account — sign in instead.");
          }
          throw error;
        }
        if (!data?.session) {
          return fail("Account created, but instant sign-in is disabled. The administrator needs to turn off \"Confirm email\" in Supabase (Authentication → Sign In / Providers → Email).");
        }
      }
      onSignedIn();
    } catch (err) {
      fail(err?.message || "Something went wrong. Please try again.");
    }
  };

  const isReg = mode === "register";
  return (
    <Shell>
      <Logo />
      <h1 style={{ color: "#fff", fontSize: 30, fontWeight: 800, letterSpacing: "-.5px", lineHeight: 1.15, margin: "34px 0 8px" }}>
        Operations<br />Command Centre<span style={{ color: RED }}>.</span>
      </h1>
      <p style={{ color: MUT, fontSize: 13.5, fontWeight: 600, margin: "0 0 26px", lineHeight: 1.5 }}>
        {isReg
          ? "Create your account with your work email. Access starts once Paul Wardle approves your request."
          : "One source of truth for actions, projects, mobilisations and reporting."}
      </p>

      <form onSubmit={submit}>
        <label htmlFor="email" style={{ ...labelStyle, marginTop: 0 }}>Work email</label>
        <input id="email" type="email" autoFocus autoComplete="email" required
          placeholder={"name@" + ALLOWED_EMAIL_DOMAIN} value={email}
          onChange={(e) => setEmail(e.target.value)} style={inputStyle} />

        <label htmlFor="password" style={labelStyle}>{isReg ? "Choose a password" : "Password"}</label>
        <input id="password" type="password" autoComplete={isReg ? "new-password" : "current-password"} required
          placeholder="••••••••" value={password}
          onChange={(e) => setPassword(e.target.value)} style={inputStyle} />

        {state.status === "error" && (
          <div style={{ marginTop: 10, fontSize: 13, color: "#FF6B85", fontWeight: 600, lineHeight: 1.5 }}>{state.msg}</div>
        )}

        <button type="submit" style={btnStyle} disabled={state.status === "busy"}>
          {state.status === "busy" ? (isReg ? "Creating account…" : "Signing in…") : (isReg ? "Create account & request access" : "Sign in")}
        </button>
        <button type="button" style={ghostBtn}
          onClick={() => { setMode(isReg ? "signin" : "register"); setState({ status: "idle", msg: "" }); }}>
          {isReg ? "I already have an account — sign in" : "New here? Create account"}
        </button>

        <div style={{ marginTop: 16, fontSize: 12, color: MUT, fontWeight: 600, textAlign: "center", lineHeight: 1.6 }}>
          {isReg
            ? "New accounts are view-only until approved."
            : "You'll stay signed in on this device. Forgotten password? Contact Paul Wardle."}
        </div>
      </form>
    </Shell>
  );
}

function PendingScreen({ email, status, onRefresh, onSignOut }) {
  const rejected = status === "rejected" || status === "suspended";
  return (
    <Shell>
      <Logo />
      <h1 style={{ color: "#fff", fontSize: 26, fontWeight: 800, letterSpacing: "-.5px", margin: "34px 0 10px" }}>
        {rejected ? <>Access unavailable<span style={{ color: RED }}>.</span></> : <>Request sent<span style={{ color: RED }}>.</span></>}
      </h1>
      <div style={{ background: "#1B3050", borderLeft: "4px solid " + RED, borderRadius: 10, padding: "16px 18px", color: "#C9D1DD", fontSize: 14, lineHeight: 1.6, fontWeight: 500 }}>
        {rejected ? (
          <>Your account (<b style={{ color: "#fff" }}>{email}</b>) doesn't currently have access. Speak to Paul Wardle if you think that's wrong.</>
        ) : (
          <>Your account (<b style={{ color: "#fff" }}>{email}</b>) is awaiting approval from Paul Wardle. You'll get view access as soon as it's approved — check back shortly.</>
        )}
      </div>
      {!rejected && <button style={btnStyle} onClick={onRefresh}>I've been approved — refresh</button>}
      <button style={ghostBtn} onClick={onSignOut}>Sign out</button>
    </Shell>
  );
}

export default function AuthGate() {
  const [state, setState] = useState({ loading: true, session: null });
  const [profile, setProfile] = useState(null);
  const [profLoading, setProfLoading] = useState(false);

  const loadProfile = async () => {
    setProfLoading(true);
    setProfile(await fetchProfile());
    setProfLoading(false);
  };

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

  useEffect(() => {
    if (state.session?.mode === "cloud") loadProfile();
    else setProfile(null);
  }, [state.session?.user?.id]);

  if (state.loading) return <Splash text="Starting your command centre…" />;
  if (isConfigured && !state.session) return <Login onSignedIn={() => {}} />;

  const mode = state.session?.mode || (isConfigured ? "cloud" : "local");
  const email = state.session?.user?.email || (isConfigured ? "" : "Local device");

  if (mode === "cloud") {
    if (profLoading && !profile) return <Splash text="Checking your access…" />;
    const status = profile?.status || "pending";
    if (status !== "approved") {
      return <PendingScreen email={email} status={status} onRefresh={loadProfile} onSignOut={signOut} />;
    }
  }

  const role = mode === "local" ? "admin" : profile?.role || "viewer";
  const auth = {
    mode,
    email,
    role,
    isAdmin: role === "admin",
    canEdit: role === "admin" || role === "editor",
    signOut,
  };

  return <App auth={auth} />;
}
