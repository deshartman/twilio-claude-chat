import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.ts";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (mode === "signup") await api.signup(email, password);
      else await api.login(email, password);
      nav("/chat", { replace: true });
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="bg-white p-6 rounded shadow w-80 space-y-4">
        <h1 className="text-xl font-semibold">
          {mode === "login" ? "Log in" : "Sign up"}
        </h1>
        <label className="block">
          <span className="text-sm text-slate-600">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-600">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
          />
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-900 text-white rounded py-1.5 text-sm disabled:opacity-50"
        >
          {loading ? "…" : mode === "login" ? "Log in" : "Sign up"}
        </button>
        <button
          type="button"
          className="w-full text-sm text-slate-500 hover:text-slate-800"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </form>
    </div>
  );
}
