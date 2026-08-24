"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Building2, Lock, Mail, Eye, EyeOff } from "lucide-react";
import { useAppSettings } from "@/lib/appSettings";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { data: appSettings } = useAppSettings();
  const appName = appSettings?.appName || "ILRMS";
  const orgName = appSettings?.orgName || "Charis Microfinance Bank";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push("/dashboard");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center brand-gradient p-4">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5"
        style={{ backgroundImage: "radial-gradient(circle at 25% 25%, white 2px, transparent 2px), radial-gradient(circle at 75% 75%, white 2px, transparent 2px)", backgroundSize: "60px 60px" }}
      />

      <div className="relative w-full max-w-md">
        {/* Logo card */}
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="brand-gradient px-8 pt-8 pb-6 text-center">
            <div className="w-16 h-16 rounded-full bg-white/15 flex items-center justify-center mx-auto mb-4 border-2 border-white/30">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-display font-bold text-white">{appName}</h1>
            <p className="text-blue-100 text-sm mt-1">{orgName}</p>
            <p className="text-white/60 text-xs mt-0.5">Investment & Loan Recovery Management System</p>
          </div>

          {/* Gold accent bar */}
          <div className="h-1 gold-gradient" />

          {/* Form */}
          <div className="px-8 py-8">
            <h2 className="text-lg font-semibold text-foreground mb-6">Sign in to your account</h2>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="officer@charisbank.com"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors bg-background"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    className="w-full pl-10 pr-10 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors bg-background"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full brand-gradient text-white py-2.5 px-4 rounded-lg font-semibold text-sm mt-2 hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in...
                  </>
                ) : "Sign In"}
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="px-8 py-4 bg-muted/40 border-t border-border text-center">
            <p className="text-xs text-muted-foreground">
              Authorized personnel only · © {new Date().getFullYear()} {orgName}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
