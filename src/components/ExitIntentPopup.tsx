import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Zap, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useABTest } from '@/hooks/use-ab-test';
import { useIsMobile } from '@/hooks/use-mobile';

type TriggerMethod = 'mouse_leave' | 'rapid_scroll' | 'tab_switch' | 'back_button';

export const ExitIntentPopup = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [hasShown, setHasShown] = useState(false);
  const [triggerMethod, setTriggerMethod] = useState<TriggerMethod | null>(null);
  const { trackConversion } = useABTest('social_proof_placement');
  const isMobile = useIsMobile();
  
  // Mobile scroll tracking refs
  const lastScrollY = useRef(0);
  const scrollVelocity = useRef(0);
  const lastScrollTime = useRef(Date.now());
  const scrollUpCount = useRef(0);

  const showPopup = useCallback((method: TriggerMethod) => {
    if (hasShown) return;
    setTriggerMethod(method);
    setIsVisible(true);
    setHasShown(true);
    sessionStorage.setItem('exitIntentShown', 'true');
    sessionStorage.setItem('exitIntentTrigger', method);
    
    // Track popup view with trigger method
    trackConversion({ 
      action: 'exit_intent_shown', 
      trigger_method: method,
      device_type: isMobile ? 'mobile' : 'desktop'
    });
  }, [hasShown, trackConversion, isMobile]);

  // Desktop: Mouse leave detection
  const handleMouseLeave = useCallback((e: MouseEvent) => {
    if (e.clientY <= 0) {
      showPopup('mouse_leave');
    }
  }, [showPopup]);

  // Mobile: Rapid scroll up detection (user scrolling back to top quickly)
  const handleScroll = useCallback(() => {
    if (hasShown) return;
    
    const currentScrollY = window.scrollY;
    const currentTime = Date.now();
    const timeDelta = currentTime - lastScrollTime.current;
    
    if (timeDelta > 0) {
      const distance = lastScrollY.current - currentScrollY;
      scrollVelocity.current = distance / timeDelta;
      
      // Detect rapid upward scroll (velocity > 2px/ms) when near top
      if (scrollVelocity.current > 2 && currentScrollY < 200) {
        scrollUpCount.current += 1;
        
        // Trigger after 2 rapid scroll-ups near top
        if (scrollUpCount.current >= 2) {
          showPopup('rapid_scroll');
        }
      } else if (distance < 0) {
        // Reset count on scroll down
        scrollUpCount.current = 0;
      }
    }
    
    lastScrollY.current = currentScrollY;
    lastScrollTime.current = currentTime;
  }, [hasShown, showPopup]);

  // Mobile: Visibility change detection (switching tabs/apps)
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'hidden' && !hasShown) {
      // Mark as shown but don't display yet - show when they come back
      sessionStorage.setItem('exitIntentPending', 'true');
      sessionStorage.setItem('exitIntentPendingTrigger', 'tab_switch');
    } else if (document.visibilityState === 'visible') {
      // Show popup when they return if it was pending
      if (sessionStorage.getItem('exitIntentPending') && !hasShown) {
        const pendingTrigger = sessionStorage.getItem('exitIntentPendingTrigger') as TriggerMethod || 'tab_switch';
        sessionStorage.removeItem('exitIntentPending');
        sessionStorage.removeItem('exitIntentPendingTrigger');
        showPopup(pendingTrigger);
      }
    }
  }, [hasShown, showPopup]);

  // Mobile: Back button / history popstate
  const handlePopState = useCallback(() => {
    if (!hasShown) {
      // Push state back to prevent actual navigation and show popup
      window.history.pushState(null, '', window.location.href);
      showPopup('back_button');
    }
  }, [hasShown, showPopup]);

  useEffect(() => {
    // Check if already shown this session
    if (sessionStorage.getItem('exitIntentShown')) {
      setHasShown(true);
      return;
    }

    // Wait before enabling exit intent detection
    const timeout = setTimeout(() => {
      if (isMobile) {
        // Mobile-specific detection
        window.addEventListener('scroll', handleScroll, { passive: true });
        document.addEventListener('visibilitychange', handleVisibilityChange);
        
        // Push initial state for back button detection
        window.history.pushState(null, '', window.location.href);
        window.addEventListener('popstate', handlePopState);
      } else {
        // Desktop: mouse leave
        document.addEventListener('mouseleave', handleMouseLeave);
      }
    }, 5000);

    return () => {
      clearTimeout(timeout);
      if (isMobile) {
        window.removeEventListener('scroll', handleScroll);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('popstate', handlePopState);
      } else {
        document.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, [isMobile, handleMouseLeave, handleScroll, handleVisibilityChange, handlePopState]);

  const handleClose = () => {
    // Track dismissal with trigger method
    if (triggerMethod) {
      trackConversion({ 
        action: 'exit_intent_dismissed', 
        trigger_method: triggerMethod,
        device_type: isMobile ? 'mobile' : 'desktop'
      });
    }
    setIsVisible(false);
  };

  const handleGetFreeScan = () => {
    trackConversion({ 
      action: 'exit_intent_cta_click',
      trigger_method: triggerMethod || 'unknown',
      device_type: isMobile ? 'mobile' : 'desktop'
    });
    setIsVisible(false);
    
    const uploadSection = document.getElementById('upload');
    if (uploadSection) {
      uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl animate-in zoom-in-95 duration-300">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close popup"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-8 text-center">
          {/* Icon */}
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
            <Zap className="h-8 w-8 text-primary" />
          </div>

          {/* Headline */}
          <h2 className="text-2xl font-bold text-foreground mb-3">
            Wait! Don't Leave Empty-Handed
          </h2>

          {/* Subheadline */}
          <p className="text-muted-foreground mb-6">
            Get your <span className="text-primary font-semibold">free ATS scan</span> and see how your resume scores against real hiring systems.
          </p>

          {/* Benefits */}
          <div className="space-y-3 mb-6 text-left">
            {[
              'Instant ATS compatibility score',
              'Keyword optimization tips',
              'Formatting issue detection'
            ].map((benefit, index) => (
              <div key={index} className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                <span className="text-sm text-foreground">{benefit}</span>
              </div>
            ))}
          </div>

          {/* CTA Button */}
          <Button
            onClick={handleGetFreeScan}
            size="lg"
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-6 text-lg"
          >
            Get My Free Scan Now
          </Button>

          {/* Dismissal text */}
          <button
            onClick={handleClose}
            className="mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            No thanks, I'll risk it
          </button>
        </div>
      </div>
    </div>
  );
};
