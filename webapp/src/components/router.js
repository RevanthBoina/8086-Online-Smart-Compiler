import React, { useState, useEffect, useCallback } from "react";
import Home from "../pages/home";
import Compiler from "../pages/compiler";
import InstructionSet from "../pages/instructions";
import Navbar from "./navbar";
import Footer from "./footer";
import {
  Route,
  BrowserRouter as Router,
  Switch,
  Redirect,
  useLocation,
} from "react-router-dom";

/**
 * Router basename.
 *
 * In a production build `PUBLIC_URL` is derived from the `homepage` property
 * in package.json, i.e. the GitHub Pages project path
 * ("/8086-Online-Smart-Compiler"). During `npm start` it is empty, so the app
 * keeps working from the dev server root.
 */
function getBasename() {
  const publicUrl = process.env.PUBLIC_URL || "";
  if (!publicUrl) return "";
  try {
    const url = new URL(publicUrl, "http://localhost");
    return url.pathname.replace(/\/+$/, "");
  } catch (err) {
    return publicUrl.replace(/\/+$/, "");
  }
}

const WASM_URL = (process.env.PUBLIC_URL || "") + "/emulator_8086_web_bg.wasm";

function WasmLoading() {
  return (
    <div
      style={{
        padding: "60px 24px",
        textAlign: "center",
        fontFamily: "monospace",
      }}
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          width: 36,
          height: 36,
          margin: "0 auto 16px",
          border: "3px solid #cbd5e1",
          borderTopColor: "#1d4ed8",
          borderRadius: "50%",
          animation: "spin 0.9s linear infinite",
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        Loading 8086 engine…
      </div>
      <div style={{ fontSize: 13, color: "#64748b" }}>
        Preparing the WebAssembly interpreter ({WASM_URL.split("/").pop()}).
      </div>
    </div>
  );
}

function WasmError({ message, onRetry }) {
  return (
    <div
      style={{
        padding: "48px 24px",
        maxWidth: 640,
        margin: "0 auto",
        textAlign: "center",
        fontFamily: "monospace",
      }}
      role="alert"
    >
      <div style={{ fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>
        The 8086 engine could not be loaded
      </div>
      <div
        style={{
          fontSize: 13,
          color: "#475569",
          backgroundColor: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
          textAlign: "left",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message}
      </div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
        The compiler is disabled until the WebAssembly module loads
        successfully.
      </div>
      <button
        type="button"
        onClick={onRetry}
        style={{
          padding: "8px 20px",
          fontWeight: 700,
          color: "#fff",
          backgroundColor: "#1d4ed8",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 14,
        }}
      >
        Retry loading engine
      </button>
    </div>
  );
}

function CompilerRoute({ wasm, status, error, onRetry }) {
  if (status === "ready") {
    return <Compiler wasm={wasm} />;
  }
  if (status === "error") {
    return <WasmError message={error} onRetry={onRetry} />;
  }
  return <WasmLoading />;
}

/** Keeps focus/scroll behaviour sane when the route changes. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function RootRouter() {
  const [wasm, setWasm] = useState(null);
  const [wasmStatus, setWasmStatus] = useState("loading");
  const [wasmError, setWasmError] = useState("");

  const loadWasm = useCallback(async () => {
    setWasmStatus("loading");
    setWasmError("");
    try {
      const wasmModule = await import("emulator_8086");
      if (typeof wasmModule.default !== "function") {
        throw new Error(
          "emulator_8086 package does not expose an init function."
        );
      }
      await wasmModule.default(WASM_URL);
      if (typeof wasmModule.preprocess !== "function") {
        throw new Error(
          "emulator_8086 package is missing preprocess(); the WASM engine is not usable."
        );
      }
      setWasm(wasmModule);
      setWasmStatus("ready");
    } catch (err) {
      console.error("Failed to initialize the 8086 WASM engine:", err);
      setWasm(null);
      setWasmError(
        (err && (err.message || String(err))) ||
          "Unknown error while loading the WebAssembly module."
      );
      setWasmStatus("error");
    }
  }, []);

  useEffect(() => {
    loadWasm();
  }, [loadWasm]);

  return (
    <Router basename={getBasename()}>
      <div id="page-container">
        <Navbar />
        <ScrollToTop />
        <div className="App">
          <Switch>
            <Route exact path="/" component={Home} />
            <Route
              exact
              path="/compile"
              render={() => (
                <CompilerRoute
                  wasm={wasm}
                  status={wasmStatus}
                  error={wasmError}
                  onRetry={loadWasm}
                />
              )}
            />
            <Route exact path="/instructions" component={InstructionSet} />
            <Route component={() => <Redirect to="/" />} />
          </Switch>
        </div>
      </div>
      <footer id="footer">
        <Footer />
      </footer>
    </Router>
  );
}

export default RootRouter;
