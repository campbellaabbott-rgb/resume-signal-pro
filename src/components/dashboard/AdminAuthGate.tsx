import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getStoredAdminKey, setStoredAdminKey, clearStoredAdminKey } from "@/lib/admin-auth";

interface AdminAuthGateProps {
  children: React.ReactNode;
}

// Gates internal dashboards (analytics, errors) behind the ADMIN_API_KEY secret.
// This is a UI-level gate, not a backend security boundary by itself — the actual
// enforcement is the edge function checking the x-admin-key header against
// ADMIN_API_KEY. Without this gate the dashboards simply failed silently with no
// way to ever provide that key, since nothing in the frontend ever sent it.
export function AdminAuthGate({ children }: AdminAuthGateProps) {
  const [storedKey, setStoredKeyState] = useState<string | null>(() => getStoredAdminKey());
  const [draft, setDraft] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setStoredAdminKey(draft.trim());
    setStoredKeyState(draft.trim());
  };

  const handleSignOut = () => {
    clearStoredAdminKey();
    setStoredKeyState(null);
    setDraft("");
  };

  if (!storedKey) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 p-6 rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-primary/10">
              <Lock className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold">Admin Access Required</h2>
              <p className="text-xs text-muted-foreground">Enter the ADMIN_API_KEY for this Supabase project</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-key" className="text-xs">Admin Key</Label>
            <Input
              id="admin-key"
              type="password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="••••••••••••"
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={!draft.trim()}>
            Unlock
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end px-4 pt-2">
        <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-xs h-7">
          Lock dashboard
        </Button>
      </div>
      {children}
    </div>
  );
}
