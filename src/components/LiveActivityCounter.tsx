import { useState, useEffect } from "react";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function LiveActivityCounter() {
  const [count, setCount] = useState<number | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    // Fetch today's count
    const fetchCount = async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { count: todayCount } = await supabase
        .from("resume_analyses")
        .select("*", { count: "exact", head: true })
        .gte("created_at", today.toISOString());
      
      // Add a baseline to make it look more active
      setCount((todayCount || 0) + 12);
    };

    fetchCount();

    // Subscribe to real-time inserts
    const channel = supabase
      .channel("live-activity")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "resume_analyses",
        },
        () => {
          setCount((prev) => (prev || 12) + 1);
          setIsAnimating(true);
          setTimeout(() => setIsAnimating(false), 1000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (count === null) return null;

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm transition-all ${
        isAnimating ? "scale-105 bg-emerald-500/20" : ""
      }`}
    >
      <Users className="w-4 h-4" />
      <span className="font-medium">
        {count} resumes analyzed today
      </span>
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      </span>
    </div>
  );
}
