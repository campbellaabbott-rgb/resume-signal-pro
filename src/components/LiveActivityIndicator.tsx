import { useState, useEffect, useRef, useCallback } from "react";
import { Users, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOptimizationTracking } from "@/hooks/use-optimization-tracking";

interface LiveActivityIndicatorProps {
  className?: string;
  variant?: "inline" | "badge" | "toast";
  rotationInterval?: number; // seconds between activity changes
}

export function LiveActivityIndicator({ 
  className, 
  variant = "badge",
  rotationInterval = 8 
}: LiveActivityIndicatorProps) {
  const [activeUsers, setActiveUsers] = useState<number>(0);
  const [lastActivity, setLastActivity] = useState<string>("");
  const [isVisible, setIsVisible] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activityKey, setActivityKey] = useState(0);
  const { trackLiveActivityViewed } = useOptimizationTracking();
  const hasTracked = useRef(false);

  const activities = [
    "Someone Just Scanned Their Resume",
    "A User Improved Their ATS Score",
    "Someone Downloaded Their Report",
    "A Resume Was Optimized",
    "Keywords Were Analyzed",
    "Someone Got Their Free Score",
    "A Cover Letter Was Generated"
  ];

  // Calculate active users based on time of day
  const calculateActiveUsers = useCallback(() => {
    const hour = new Date().getHours();
    const isPeakHour = (hour >= 9 && hour <= 11) || (hour >= 14 && hour <= 16);
    const baseUsers = isPeakHour ? 15 : 8;
    const variance = Math.floor(Math.random() * 7);
    return baseUsers + variance;
  }, []);

  const updateActivity = useCallback(() => {
    // Start exit animation
    setIsTransitioning(true);
    
    // After exit animation, update content and start enter animation
    setTimeout(() => {
      setActiveUsers(calculateActiveUsers());
      setLastActivity(activities[Math.floor(Math.random() * activities.length)]);
      setActivityKey(prev => prev + 1);
      setIsTransitioning(false);
    }, 300);
  }, [calculateActiveUsers]);

  useEffect(() => {
    // Initial update (no animation)
    setActiveUsers(calculateActiveUsers());
    setLastActivity(activities[Math.floor(Math.random() * activities.length)]);
    
    // Show after a short delay and track
    const showTimer = setTimeout(() => {
      setIsVisible(true);
      if (!hasTracked.current) {
        trackLiveActivityViewed();
        hasTracked.current = true;
      }
    }, 2000);

    // Update periodically with animation
    const updateInterval = setInterval(updateActivity, rotationInterval * 1000);

    return () => {
      clearTimeout(showTimer);
      clearInterval(updateInterval);
    };
  }, [rotationInterval]);

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
          "fixed bottom-4 left-4 z-40 flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border shadow-lg",
          "transition-all duration-300",
          className
        )}
      >
        {/* Animated glow ring on transition */}
        <div 
          key={`ring-${activityKey}`}
          className={cn(
            "absolute inset-0 rounded-xl border-2 border-success/50 pointer-events-none",
            "animate-[ping_0.75s_ease-out_1]",
            activityKey === 0 && "hidden"
          )}
        />
        
        <div className={cn(
          "flex items-center justify-center w-10 h-10 rounded-full bg-success/20 transition-transform duration-300",
          isTransitioning ? "scale-75 opacity-50" : "scale-100 opacity-100"
        )}>
          <Sparkles className={cn(
            "w-5 h-5 text-success transition-all duration-300",
            isTransitioning ? "rotate-180 scale-75" : "rotate-0 scale-100"
          )} />
        </div>
        
        <div 
          key={activityKey}
          className={cn(
            "text-sm transition-all duration-300",
            isTransitioning 
              ? "opacity-0 translate-x-2" 
              : "opacity-100 translate-x-0"
          )}
        >
          <p className="font-medium text-foreground">{lastActivity}</p>
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
