import { useState, useEffect, useRef } from "react";
import { Users, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOptimizationTracking } from "@/hooks/use-optimization-tracking";

interface LiveActivityIndicatorProps {
  className?: string;
  variant?: "inline" | "badge" | "toast";
}

export function LiveActivityIndicator({ className, variant = "badge" }: LiveActivityIndicatorProps) {
  const [activeUsers, setActiveUsers] = useState<number>(0);
  const [lastActivity, setLastActivity] = useState<string>("");
  const [isVisible, setIsVisible] = useState(false);
  const { trackLiveActivityViewed } = useOptimizationTracking();
  const hasTracked = useRef(false);

  useEffect(() => {
    // Simulate realistic activity based on time of day
    const calculateActiveUsers = () => {
      const hour = new Date().getHours();
      // Peak hours: 9-11 AM and 2-4 PM
      const isPeakHour = (hour >= 9 && hour <= 11) || (hour >= 14 && hour <= 16);
      const baseUsers = isPeakHour ? 15 : 8;
      const variance = Math.floor(Math.random() * 7);
      return baseUsers + variance;
    };

    const activities = [
      "someone just scanned their resume",
      "a user improved their ATS score",
      "someone downloaded their report",
      "a resume was optimized",
      "keywords were analyzed"
    ];

    const updateActivity = () => {
      setActiveUsers(calculateActiveUsers());
      setLastActivity(activities[Math.floor(Math.random() * activities.length)]);
    };

    // Initial update
    updateActivity();
    
    // Show after a short delay and track
    const showTimer = setTimeout(() => {
      setIsVisible(true);
      if (!hasTracked.current) {
        trackLiveActivityViewed();
        hasTracked.current = true;
      }
    }, 2000);

    // Update periodically
    const updateInterval = setInterval(updateActivity, 30000);

    return () => {
      clearTimeout(showTimer);
      clearInterval(updateInterval);
    };
  }, []);

  if (!isVisible || activeUsers === 0) return null;

  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
        <span>{activeUsers} people scanning now</span>
      </div>
    );
  }

  if (variant === "toast") {
    return (
      <div 
        className={cn(
          "fixed bottom-4 left-4 z-40 flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border shadow-lg animate-slide-in-left",
          className
        )}
      >
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-success/20">
          <Sparkles className="w-5 h-5 text-success" />
        </div>
        <div className="text-sm">
          <p className="font-medium text-foreground capitalize">{lastActivity}</p>
          <p className="text-xs text-muted-foreground">Just now</p>
        </div>
      </div>
    );
  }

  // Default badge variant
  return (
    <div 
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/20 text-sm",
        className
      )}
    >
      <div className="relative flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-success" />
        <div className="absolute w-2 h-2 rounded-full bg-success animate-ping" />
      </div>
      <Users className="w-3.5 h-3.5 text-success" />
      <span className="text-success font-medium">{activeUsers}</span>
      <span className="text-muted-foreground">scanning now</span>
    </div>
  );
}
