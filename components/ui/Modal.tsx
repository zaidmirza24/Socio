"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
} as const;

interface ModalProps {
  children: ReactNode;
  size?: keyof typeof SIZES;
  /** Closes on Escape and on a click outside the panel. Omit to manage closing yourself. */
  onClose?: () => void;
  /** Accessible name: id of the heading inside the dialog. */
  labelledBy: string;
  role?: "dialog" | "alertdialog";
  /** Extra classes for the panel (padding, flex layout, ...). */
  className?: string;
}

/**
 * Shared dialog shell. The overlay scrolls, so a tall dialog is always fully reachable on short or
 * small screens, and a short one stays centred. Sizes are capped to the viewport width with a
 * 16px gutter.
 *
 * It renders into document.body. Ancestors with backdrop-filter/transform (like the blurred top bar)
 * would otherwise become the containing block of `position: fixed` and trap the dialog inside them.
 */
export function Modal({ children, size = "md", onClose, labelledBy, role = "dialog", className = "" }: ModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-900/50 backdrop-blur-sm">
      <div className="flex min-h-full items-center justify-center p-4" onClick={onClose}>
        <div
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          className={`w-full ${SIZES[size]} rounded-2xl border border-slate-200 bg-white shadow-xl ${className}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
