import { useState, useEffect } from "react";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export function LiveActivityCounter() {
  const [count, setCount] = useState<number | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    // Calculate count based on time of day
    // Starts at 0 at midnight, increases by ~30 per hour
    // By 7 AM = ~210, by noon = ~360, by 6 PM = ~540
    const calculateCount = () => {
      const now = new Date();
      const hoursSinceMidnight = now.getHours() + now.getMinutes() / 60;
      
      // Base rate of ~30 per hour
      const baseCount = Math.floor(hoursSinceMidnight * 30);
      
      // Add some random variation (±5) to make it feel more organic
      const variation = Math.floor(Math.random() * 11) - 5;
      
      return Math.max(0, baseCount + variation);
    };

    // Set initial count
    setCount(calculateCount());

    // Update every minute to reflect gradual increase
    const interval = setInterval(() => {
      const newCount = calculateCount();
      if (newCount !== count) {
        setCount(newCount);
        setIsAnimating(true);
        setTimeout(() => setIsAnimating(false), 1000);
      }
    }, 60000);

    return () => {
      clearInterval(interval);
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
