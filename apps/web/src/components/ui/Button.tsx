import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  const base =
    "inline-flex items-center justify-center font-medium rounded-md transition-colors " +
    "disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-offset-1 focus-visible:ring-red-500";

  const sizes: Record<Size, string> = {
    sm: "text-xs px-2.5 py-1.5",
    md: "text-sm px-3.5 py-1.5",
  };

  const variants: Record<Variant, string> = {
    primary: "bg-red-600 text-white hover:bg-red-700 border border-red-600",
    secondary:
      "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 hover:border-slate-400",
    ghost: "bg-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent",
    danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50 hover:border-red-300",
  };

  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
