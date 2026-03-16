"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { User, Session } from "@supabase/supabase-js";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabaseRef.current = supabase;

    // Get initial session
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
      })
      .catch(() => {
        setSession(null);
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Periodically check if session has expired
  useEffect(() => {
    if (!session?.expires_at) return;
    const check = setInterval(() => {
      if (session.expires_at! * 1000 < Date.now()) {
        supabaseRef.current?.auth.getSession().then(({ data }) => {
          if (!data.session) {
            setSession(null);
            setUser(null);
          }
        });
      }
    }, 60_000);
    return () => clearInterval(check);
  }, [session]);

  const signOut = async () => {
    const supabase = supabaseRef.current ?? createClient();
    supabaseRef.current = supabase;

    const [clientSignOut, serverSignOut] = await Promise.allSettled([
      supabase.auth.signOut(),
      fetch("/api/auth/sign-out", { method: "POST" }),
    ]);

    if (clientSignOut.status === "rejected" && serverSignOut.status === "rejected") {
      throw clientSignOut.reason ?? serverSignOut.reason;
    }

    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
