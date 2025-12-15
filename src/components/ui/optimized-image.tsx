import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface OptimizedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  webpSrc?: string;
  fallbackSrc?: string;
  className?: string;
  containerClassName?: string;
  priority?: boolean;
}

export function OptimizedImage({
  src,
  alt,
  webpSrc,
  fallbackSrc = "/placeholder.svg",
  className,
  containerClassName,
  priority = false,
  ...props
}: OptimizedImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (priority) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "50px",
        threshold: 0.01,
      }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, [priority]);

  const handleLoad = () => {
    setIsLoaded(true);
  };

  const handleError = () => {
    setHasError(true);
    setIsLoaded(true);
  };

  const imageSrc = hasError ? fallbackSrc : src;

  return (
    <div className={cn("relative overflow-hidden", containerClassName)}>
      {/* Placeholder skeleton */}
      {!isLoaded && (
        <div 
          className="absolute inset-0 bg-muted animate-pulse" 
          aria-hidden="true"
        />
      )}
      
      {isInView && (
        <picture>
          {webpSrc && !hasError && (
            <source srcSet={webpSrc} type="image/webp" />
          )}
          <img
            ref={imgRef}
            src={imageSrc}
            alt={alt}
            loading={priority ? "eager" : "lazy"}
            decoding={priority ? "sync" : "async"}
            onLoad={handleLoad}
            onError={handleError}
            className={cn(
              "transition-opacity duration-300",
              isLoaded ? "opacity-100" : "opacity-0",
              className
            )}
            {...props}
          />
        </picture>
      )}
      
      {/* Invisible placeholder for lazy loading */}
      {!isInView && (
        <div 
          ref={imgRef as any}
          className={cn("bg-muted", className)}
          style={{ aspectRatio: props.width && props.height ? `${props.width}/${props.height}` : undefined }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
