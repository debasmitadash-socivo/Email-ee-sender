"use client";
import { useState } from "react";

export function UnsubscribeConfirm({ token, email }: { token: string; email: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function confirm() {
    setState("busy");
    const res = await fetch(`/api/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setState(res.ok ? "done" : "error");
  }

  if (state === "done") {
    return (
      <div>
        <h1 className="text-lg font-semibold mb-2">You're unsubscribed</h1>
        <p className="text-sm text-muted">{email} will not receive any further emails from us.</p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-lg font-semibold mb-2">Unsubscribe</h1>
      <p className="text-sm text-muted mb-6">
        Stop all future emails to <strong>{email}</strong>?
      </p>
      <button
        onClick={confirm}
        disabled={state === "busy"}
        className="rounded-md bg-primary text-white px-6 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {state === "busy" ? "…" : "Yes, unsubscribe me"}
      </button>
      {state === "error" && <p className="text-sm text-danger mt-3">Something went wrong — try again.</p>}
    </div>
  );
}
