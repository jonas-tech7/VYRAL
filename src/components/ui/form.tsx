import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

const field =
  "w-full rounded-md border border-edge-strong bg-raised px-3 text-[14px] text-ink transition-colors duration-150 placeholder:text-ink-4 hover:border-ink-4 focus:border-accent/70 focus:outline-none focus-visible:outline-none disabled:opacity-50 aria-[invalid=true]:border-negative/60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-[96px] resize-y py-2.5 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(field, "h-10 appearance-none pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  optional,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  optional?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline justify-between text-[13px] font-medium text-ink">
        <span>{label}</span>
        {optional ? <span className="text-[12px] font-normal text-ink-4">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-[12.5px] text-negative" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}
