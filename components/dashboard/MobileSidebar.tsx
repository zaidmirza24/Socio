"use client";

import { useEffect } from "react";
import { SidebarNav } from "./SidebarNav";
import { SignOutButton } from "@/components/SignOutButton";
import { X, ShieldCheck } from "lucide-react";

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileSidebar({ isOpen, onClose }: MobileSidebarProps) {
  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col justify-between z-10 animate-in slide-in-from-left duration-200">
        <div className="overflow-y-auto">
          {/* Drawer Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/80 bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-xs">
                S
              </div>
              <div>
                <span className="font-bold text-slate-900 text-sm tracking-tight block">
                  Socio Monitor
                </span>
                <span className="text-[10px] text-slate-400 block">
                  Instagram Campaign Intel
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Nav Items */}
          <SidebarNav onNavigate={onClose} />
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-slate-200/80 bg-slate-50/40 space-y-3">
          <SignOutButton variant="sidebar" />
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
            <ShieldCheck className="h-3 w-3 text-slate-400" />
            <span>Private Vercel Cloud Build</span>
          </div>
        </div>
      </div>
    </div>
  );
}

