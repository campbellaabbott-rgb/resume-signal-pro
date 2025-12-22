import { useState, useEffect, useRef, Suspense, lazy, ComponentType, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface LazySectionProps {
  children: ReactNode;
  fallback?: ReactNode;
  threshold?: number;
  rootMargin?: string;
  triggerOnce?: boolean;
  minHeight?: string;
  className?: string;
}

/**
 * Lazy load sections only when they enter the viewport
 * Improves initial page load performance
 */
export function LazySection({
  children,
  fallback,
  threshold = 0.1,
  rootMargin = "100px",
  triggerOnce = true,
  minHeight = "200px",
  className = "",
}: LazySectionProps) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (triggerOnce) {
            observer.disconnect();
          }
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      {
        threshold,
        rootMargin,
      }
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [threshold, rootMargin, triggerOnce]);

  const defaultFallback = (
    <div className="space-y-4 p-8" style={{ minHeight }}>
      <Skeleton className="h-8 w-3/4 mx-auto" />
      <Skeleton className="h-4 w-1/2 mx-auto" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  );

  return (
    <div ref={ref} className={className} style={{ minHeight: isVisible ? "auto" : minHeight }}>
      {isVisible ? children : (fallback || defaultFallback)}
    </div>
  );
}

/**
 * Create a lazy-loaded component with intersection observer
 */
export function createLazyComponent<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  fallback?: ReactNode
) {
  const LazyComponent = lazy(importFn);

  return function LazyWrapper(props: React.ComponentProps<T>) {
    return (
      <Suspense fallback={fallback || <ComponentSkeleton />}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}

function ComponentSkeleton() {
  return (
    <div className="p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

/**
 * Skeleton loader for specific section types
 */
export function SectionSkeleton({ type = "default" }: { type?: "cards" | "list" | "hero" | "default" }) {
  if (type === "cards") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-8">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-6 rounded-2xl border border-border space-y-4">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ))}
      </div>
    );
  }

  if (type === "list") {
    return (
      <div className="space-y-4 p-8">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 p-4 rounded-xl border border-border">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (type === "hero") {
    return (
      <div className="text-center p-12 space-y-6">
        <Skeleton className="h-12 w-2/3 mx-auto" />
        <Skeleton className="h-6 w-1/2 mx-auto" />
        <Skeleton className="h-14 w-64 mx-auto rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-4">
      <Skeleton className="h-8 w-1/2 mx-auto" />
      <Skeleton className="h-4 w-3/4 mx-auto" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}
