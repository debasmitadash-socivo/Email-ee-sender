// Minimal shadcn-style UI kit, brand-token driven. White-max rules apply:
// pure white surfaces, 1px borders, purple reserved for primary actions.
import * as React from "react";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "danger";
}) {
  const styles = {
    default:
      "bg-gradient-to-b from-[#C285E6] to-[#B56FDC] text-white shadow-sm hover:shadow-md hover:brightness-105",
    outline: "bg-surface border border-border text-ink hover:border-primary/50 hover:text-primary",
    ghost: "bg-transparent text-muted hover:text-ink",
    danger: "bg-surface border border-danger text-danger hover:bg-danger hover:text-white",
  }[variant];
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:pointer-events-none",
        styles,
        className
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted",
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx("rounded-md border border-border bg-surface px-3 py-2 text-sm", className)}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx("card p-6", className)}>{children}</div>;
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold mb-4">{children}</h2>;
}

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-ink mb-1">
      {children}
    </label>
  );
}

/** Status chip: tinted background at ~10% opacity with solid text (§12). */
export function Chip({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "primary" | "secondary" | "warn" | "success" | "danger";
  children: React.ReactNode;
}) {
  const tones = {
    muted: "bg-muted/10 text-muted",
    primary: "bg-primary/10 text-primary",
    secondary: "bg-secondary/10 text-secondary",
    warn: "bg-warn/10 text-warn",
    success: "bg-success/10 text-success",
    danger: "bg-danger/10 text-danger",
  }[tone];
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones)}>
      {children}
    </span>
  );
}

export function stateTone(
  state: string
): "muted" | "primary" | "secondary" | "warn" | "success" | "danger" {
  switch (state) {
    case "valid":
    case "positive":
    case "interested":
    case "active":
    case "running":
    case "approved":
    case "finished":
      return "success";
    case "risky":
    case "awaiting_approval":
    case "paused":
    case "not_now":
    case "ooo":
    case "pending":
      return "warn";
    case "invalid":
    case "bounced":
    case "failed":
    case "auth_error":
    case "unsubscribed":
    case "not_interested":
    case "rejected":
      return "danger";
    case "in_sequence":
    case "scheduled":
    case "replied":
    case "info_request":
      return "secondary";
    default:
      return "muted";
  }
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm data-table">{children}</table>
    </div>
  );
}

export function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left font-semibold text-muted text-xs uppercase tracking-wide px-4 py-3 border-b border-border bg-bg/60">
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cx("px-4 py-3.5 border-b border-border align-top", className)}>{children}</td>;
}

export function Empty({ children, icon = "✨" }: { children: React.ReactNode; icon?: string }) {
  return (
    <div className="card p-12 text-center">
      <div className="text-3xl mb-3">{icon}</div>
      <div className="text-muted text-sm max-w-md mx-auto">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted mt-1.5 max-w-2xl">{description}</p>}
      </div>
      {action}
    </div>
  );
}
