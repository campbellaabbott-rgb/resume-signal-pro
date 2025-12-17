import { useState, useEffect } from "react";
import { Users } from "lucide-react";

export function LiveActivityCounter() {
  const [count, setCount] = useState<number | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    // Generate a realistic-looking count based on time of day
    const generateCount = () => {
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.getDay();
      
      // Base count varies by time of day (busier during work hours)
      let baseCount: number;
      if (hour >= 9 && hour <= 11) {
        baseCount = 35 + Math.floor(Math.random() * 20); // Morning rush: 35-54
      } else if (hour >= 12 && hour <= 14) {
        baseCount = 25 + Math.floor(Math.random() * 15); // Lunch: 25-39
      } else if (hour >= 15 && hour <= 18) {
        baseCount = 40 + Math.floor(Math.random() * 25); // Afternoon peak: 40-64
      } else if (hour >= 19 && hour <= 22) {
        baseCount = 30 + Math.floor(Math.random() * 20); // Evening: 30-49
      } else {
        baseCount = 8 + Math.floor(Math.random() * 12); // Late night/early morning: 8-19
      }
      
      // Weekends are slightly quieter
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        baseCount = Math.floor(baseCount * 0.7);
      }
      
      // Add some randomness based on the minute to make it feel dynamic
      const minuteVariation = Math.floor(now.getMinutes() / 10);
      baseCount += minuteVariation;
      
      return baseCount;
    };

    setCount(generateCount());

    // Occasionally increment to simulate activity
    const interval = setInterval(() => {
      if (Math.random() > 0.7) { // 30% chance every 30 seconds
        setCount((prev) => (prev || 20) + 1);
        setIsAnimating(true);
        setTimeout(() => setIsAnimating(false), 1000);
      }
    }, 30000);

    return () => clearInterval(interval);
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
