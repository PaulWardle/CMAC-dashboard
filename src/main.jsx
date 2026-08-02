import React from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./auth/AuthGate";
import "./index.css";

/**
 * Last-line-of-defence error boundary. Data arrives from AI output and JSON
 * imports, so a malformed record must degrade to a recovery screen — never a
 * blank page. Offers reload plus a raw backup of this device's local mirror.
 */
class AppBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  exportBackup() {
    try {
      const raw = localStorage.getItem("cmac-occ-v1") || "{}";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
      a.download = "cmac-occ-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
    } catch (e) {
      alert("Could not read the local copy: " + (e.message || e));
    }
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#112138", fontFamily: "'Montserrat','Segoe UI',system-ui,sans-serif", padding: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, borderTop: "4px solid #FD0E33", padding: "26px 28px", maxWidth: 520, color: "#112138" }}>
          <div style={{ fontWeight: 800, fontSize: 19, marginBottom: 8 }}>Something went wrong<span style={{ color: "#FD0E33" }}>.</span></div>
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "#5C6675", margin: "0 0 6px" }}>
            The app hit an unexpected error while drawing this screen. Your data is safe on the server and on this device — reloading usually clears it.
          </p>
          <p style={{ fontSize: 11.5, color: "#8A93A1", margin: "0 0 16px", wordBreak: "break-word" }}>{String(this.state.err && (this.state.err.message || this.state.err)).slice(0, 300)}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => window.location.reload()} style={{ background: "#FD0E33", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontFamily: "inherit", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Reload the app</button>
            <button onClick={() => this.exportBackup()} style={{ background: "#fff", color: "#112138", border: "1.5px solid #D6DDE4", borderRadius: 10, padding: "10px 18px", fontFamily: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Download local backup</button>
          </div>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppBoundary>
      <AuthGate />
    </AppBoundary>
  </React.StrictMode>
);
