import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.ts";
import { Button } from "../components/ui/Button.tsx";

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

  const inputCls =
    "mt-1 w-full border border-slate-300 rounded-md px-3 py-2 text-sm placeholder:text-slate-400 " +
    "focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center mb-6">
          <img src="/twilio-logo.svg" alt="Twilio" className="h-10 w-auto" />
        </div>
        <form
          onSubmit={submit}
          className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm space-y-4"
        >
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {mode === "login" ? "Log in" : "Create your account"}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {mode === "login"
                ? "Welcome back. Enter your credentials to continue."
                : "Set up an account to start chatting with your Twilio estate."}
            </p>
          </div>
          <label className="block">
            <span className="text-sm text-slate-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputCls}
              placeholder="you@example.com"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              className={inputCls}
              placeholder="At least 8 characters"
            />
          </label>
          {err && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {err}
            </p>
          )}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "…" : mode === "login" ? "Log in" : "Sign up"}
          </Button>
          <button
            type="button"
            className="w-full text-sm text-slate-500 hover:text-red-700 transition-colors"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login"
              ? "Need an account? Sign up"
              : "Already have an account? Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
