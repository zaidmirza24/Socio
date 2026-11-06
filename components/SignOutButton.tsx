"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface SignOutButtonProps {
  variant?: "header" | "sidebar";
  className?: string;
}

export function SignOutButton({ variant = "header", className = "" }: SignOutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    try {
      setLoading(true);
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } catch (err: unknown) {
      console.error("Error signing out:", err);
      // Fallback redirect even if network drops
      router.push("/login");
    } finally {
      setLoading(false);
    }
  };

  if (variant === "sidebar") {
    return (
      <button
        onClick={handleSignOut}
        disabled={loading}
        title="Sign out of Socio"
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg text-slate-600 hover:text-red-700 hover:bg-red-50 border border-slate-200 hover:border-red-200 transition disabled:opacity-50 ${className}`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-red-600 shrink-0" />
        ) : (
          <LogOut className="h-4 w-4 text-slate-500 hover:text-red-600 shrink-0" />
        )}
        <span>{loading ? "Signing out..." : "Sign Out"}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      title="Sign out of Socio"
      className={`inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition disabled:opacity-50 ${className}`}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-red-600" />
      ) : (
        <LogOut className="h-3.5 w-3.5 text-slate-500 hover:text-red-600" />
      )}
      <span>{loading ? "Signing out..." : "Sign Out"}</span>
    </button>
  );
}

