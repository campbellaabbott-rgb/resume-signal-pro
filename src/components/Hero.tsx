import { FileText, Zap, Target, AlertTriangle, Shield, Clock, Star, Eye, Users, Sparkles, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { LiveActivityCounter } from "./LiveActivityCounter";
import { useABTest } from "@/hooks/use-ab-test";

export function Hero() {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  
  // A/B Tests
  const heroCta = useABTest('hero_cta');
  const pricingDisplay = useABTest('pricing_display');
  const freeScanCta = useABTest('free_scan_cta');

  // CTA text variants
  const getCtaText = () => {
    switch (heroCta.variant) {
      case 'urgent': return 'Analyze Now - Limited Spots';
      case 'benefit': return 'Land More Interviews - $25';
      default: return 'Get Your Analysis - $25';
    }
  };

  // Free scan button text variants
  const getFreeScanText = () => {
    switch (freeScanCta.variant) {
      case 'instant': return 'Get Instant Results';
      case 'free_badge': return '✨ FREE Scan Available';
      default: return 'Get Free Resume Score';
    }
  };

  // Pricing display variants
  const getPricingDisplay = () => {
    switch (pricingDisplay.variant) {
      case 'starting_at': return { main: 'Starting at $25', sub: 'One-time' };
      case 'roi_focused': return { main: '$25', sub: '= 1 Interview ROI' };
      default: return { main: t('hero.price'), sub: t('hero.oneTime') };
    }
  };

  const pricing = getPricingDisplay();

  const handleFreeScanClick = () => {
    freeScanCta.trackConversion({ source: 'hero_free_scan' });
    document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth' });
  };

  const features = [
    { icon: FileText, labelKey: "hero.features.atsBullets", descKey: "hero.features.atsBulletsDesc" },
    { icon: Zap, labelKey: "hero.features.actionVerbs", descKey: "hero.features.actionVerbsDesc" },
    { icon: Target, labelKey: "hero.features.keywords", descKey: "hero.features.keywordsDesc" },
    { icon: AlertTriangle, labelKey: "hero.features.redFlags", descKey: "hero.features.redFlagsDesc" },
  ];

  const trustBadges = [
    { icon: Shield, labelKey: "hero.trust.secure" },
    { icon: Clock, labelKey: "hero.trust.results" },
    { icon: Star, labelKey: "hero.trust.approved" },
  ];

  return (
    <section 
      className="relative py-12 sm:py-20 md:py-28 overflow-hidden" 
      aria-labelledby="hero-heading"
    >
      {/* Background effects */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-destructive/5 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[100px]" />
      </div>
      
      <div className="container relative">
        <div className="max-w-3xl mx-auto text-center">
          {/* Problem Statement - Bold and Alarming */}
          <div className="mb-6 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium mb-6">
              <AlertTriangle className="w-4 h-4" />
              <span>85% of resumes never reach a human</span>
            </div>
            
            <h1 
              id="hero-heading"
              className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-4 leading-tight"
            >
              Is Your Resume Being{" "}
              <span className="text-destructive">Rejected by ATS?</span>
            </h1>
            
            <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed">
              Find out in 30 seconds. Get your ATS score and see exactly what's costing you interviews.
            </p>
          </div>

          {/* Single Primary CTA */}
          <div className="mb-8 animate-fade-in" style={{ animationDelay: "0.1s" }}>
            <button
              onClick={handleFreeScanClick}
              className="group relative w-full sm:w-auto inline-flex items-center justify-center gap-3 px-10 py-5 sm:py-6 rounded-2xl bg-gradient-to-r from-success via-success to-emerald-500 text-success-foreground text-lg sm:text-xl font-bold shadow-xl shadow-success/30 hover:shadow-2xl hover:shadow-success/40 active:scale-[0.98] transition-all duration-300 min-h-[64px] touch-manipulation"
            >
              <Sparkles className="w-6 h-6 sm:w-7 sm:h-7" />
              <span>Check My Resume Now</span>
              <div className="absolute -top-3 -right-2 sm:-right-3 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-lg">
                FREE
              </div>
            </button>
            
            {/* Minimal trust indicators */}
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-success" />
                No sign-up required
              </span>
              <span className="hidden sm:block w-1 h-1 rounded-full bg-muted-foreground/30" />
              <span className="flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-primary" />
                100% private
              </span>
            </div>

            {/* Anonymous testimonial */}
            <div className="mt-6 px-4 py-3 rounded-xl bg-card/40 border border-border/30 max-w-md mx-auto">
              <p className="text-sm text-muted-foreground italic">
                "This is a very wonderful product. I have just gone through the freemium features & I can confidently say it's going to be a big success."
              </p>
              <p className="text-xs text-muted-foreground/60 mt-2">— Recent user</p>
            </div>
          </div>

          {/* Live counter as social proof */}
          <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
            <LiveActivityCounter />
          </div>

          {/* Trusted by companies */}
          <div className="mt-8 animate-fade-in" style={{ animationDelay: "0.18s" }}>
            <p className="text-xs text-muted-foreground/60 mb-4">Trusted by professionals at</p>
            <div className="flex flex-wrap justify-center items-center gap-x-8 gap-y-4 opacity-50">
              {/* Google */}
              <svg className="h-5 w-auto" viewBox="0 0 272 92" fill="currentColor">
                <path d="M115.75 47.18c0 12.77-9.99 22.18-22.25 22.18s-22.25-9.41-22.25-22.18C71.25 34.32 81.24 25 93.5 25s22.25 9.32 22.25 22.18zm-9.74 0c0-7.98-5.79-13.44-12.51-13.44S80.99 39.2 80.99 47.18c0 7.9 5.79 13.44 12.51 13.44s12.51-5.55 12.51-13.44z"/>
                <path d="M163.75 47.18c0 12.77-9.99 22.18-22.25 22.18s-22.25-9.41-22.25-22.18c0-12.85 9.99-22.18 22.25-22.18s22.25 9.32 22.25 22.18zm-9.74 0c0-7.98-5.79-13.44-12.51-13.44s-12.51 5.46-12.51 13.44c0 7.9 5.79 13.44 12.51 13.44s12.51-5.55 12.51-13.44z"/>
                <path d="M209.75 26.34v39.82c0 16.38-9.66 23.07-21.08 23.07-10.75 0-17.22-7.19-19.66-13.07l8.48-3.53c1.51 3.61 5.21 7.87 11.17 7.87 7.31 0 11.84-4.51 11.84-13v-3.19h-.34c-2.18 2.69-6.38 5.04-11.68 5.04-11.09 0-21.25-9.66-21.25-22.09 0-12.52 10.16-22.26 21.25-22.26 5.29 0 9.49 2.35 11.68 4.96h.34v-3.61h9.25zm-8.56 20.92c0-7.81-5.21-13.52-11.84-13.52-6.72 0-12.35 5.71-12.35 13.52 0 7.73 5.63 13.36 12.35 13.36 6.63 0 11.84-5.63 11.84-13.36z"/>
                <path d="M225 3v65h-9.5V3h9.5z"/>
                <path d="M262.02 54.48l7.56 5.04c-2.44 3.61-8.32 9.83-18.48 9.83-12.6 0-22.01-9.74-22.01-22.18 0-13.19 9.49-22.18 20.92-22.18 11.51 0 17.14 9.16 18.98 14.11l1.01 2.52-29.65 12.28c2.27 4.45 5.8 6.72 10.75 6.72 4.96 0 8.4-2.44 10.92-6.14zm-23.27-7.98l19.82-8.23c-1.09-2.77-4.37-4.7-8.23-4.7-4.95 0-11.84 4.37-11.59 12.93z"/>
                <path d="M35.29 41.41V32H67c.31 1.64.47 3.58.47 5.68 0 7.06-1.93 15.79-8.15 22.01-6.05 6.3-13.78 9.66-24.02 9.66C16.32 69.35.36 53.89.36 34.91.36 15.93 16.32.47 35.3.47c10.5 0 17.98 4.12 23.6 9.49l-6.64 6.64c-4.03-3.78-9.49-6.72-16.97-6.72-13.86 0-24.7 11.17-24.7 25.03 0 13.86 10.84 25.03 24.7 25.03 8.99 0 14.11-3.61 17.39-6.89 2.66-2.66 4.41-6.46 5.1-11.65l-22.49.01z"/>
              </svg>
              {/* Microsoft */}
              <svg className="h-5 w-auto" viewBox="0 0 23 23" fill="currentColor">
                <path d="M0 0h11v11H0z"/>
                <path d="M12 0h11v11H12z"/>
                <path d="M0 12h11v11H0z"/>
                <path d="M12 12h11v11H12z"/>
              </svg>
              {/* Amazon */}
              <svg className="h-5 w-auto" viewBox="0 0 603 182" fill="currentColor">
                <path d="M374.00 142.06c-34.53 25.44-84.58 39.00-127.67 39.00c-60.41 0-114.84-22.34-155.94-59.50c-3.23-2.92-0.34-6.91 3.54-4.64c44.41 25.82 99.32 41.36 156.05 41.36c38.27 0 80.36-7.93 119.12-24.37c5.84-2.48 10.73 3.84 4.90 8.15z"/>
                <path d="M388.00 126.21c-4.41-5.65-29.18-2.67-40.31-1.35c-3.38 0.41-3.90-2.53-0.85-4.66c19.74-13.88 52.11-9.87 55.88-5.22c3.78 4.67-0.98 37.07-19.53 52.54c-2.85 2.38-5.57 1.11-4.30-2.04c4.18-10.42 13.53-33.62 9.11-39.27z"/>
                <path d="M348.46 20.57v-12.75c0-1.94 1.47-3.23 3.24-3.23h57.24c1.84 0 3.31 1.32 3.31 3.23v10.93c-0.02 1.84-1.58 4.25-4.33 8.05l-29.66 42.34c11.02-0.27 22.66 1.37 32.67 7.02c2.26 1.28 2.87 3.16 3.05 5.01v13.61c0 1.89-2.08 4.10-4.27 2.96c-17.84-9.35-41.54-10.37-61.28 0.10c-2.01 1.08-4.12-1.10-4.12-2.99v-12.93c0-2.12 0.03-5.74 2.15-8.97l34.37-49.30h-29.92c-1.84 0-3.31-1.29-3.31-3.21l-0.14 0.13z"/>
                <path d="M124.60 79.77h-17.40c-1.66-0.12-2.99-1.38-3.13-2.97v-70.95c0-1.79 1.50-3.22 3.35-3.22h16.22c1.69 0.08 3.04 1.39 3.17 3.01v9.27h0.32c4.25-9.46 12.22-13.87 22.98-13.87c10.92 0 17.75 4.41 22.66 13.87c4.24-9.46 13.87-13.87 24.14-13.87c7.33 0 15.34 3.02 20.24 9.79c5.54 7.54 4.41 18.50 4.41 28.12l-0.02 37.59c0 1.79-1.50 3.24-3.35 3.24h-17.38c-1.73-0.13-3.12-1.51-3.12-3.24v-31.56c0-3.78 0.33-13.22-0.49-16.82c-1.30-6.04-5.22-7.75-10.27-7.75c-4.24 0-8.65 2.83-10.45 7.35c-1.79 4.52-1.63 12.07-1.63 17.22v31.56c0 1.79-1.50 3.24-3.35 3.24h-17.38c-1.74-0.13-3.12-1.51-3.12-3.24l-0.02-31.56c0-10.02 1.63-24.76-10.76-24.76c-12.56 0-12.07 14.38-12.07 24.76v31.56c0 1.79-1.50 3.24-3.35 3.24l0.02-0.01z"/>
                <path d="M469.26 1.04c25.83 0 39.81 22.18 39.81 50.38c0 27.25-15.44 48.86-39.81 48.86c-25.35 0-39.16-22.18-39.16-49.78c0-27.76 13.97-49.46 39.16-49.46zm0.15 18.25c-12.82 0-13.63 17.46-13.63 28.35c0 10.91-0.16 34.20 13.48 34.20c13.47 0 14.12-18.78 14.12-30.24c0-7.54-0.33-16.58-2.61-23.77c-1.96-6.22-5.87-8.54-11.36-8.54z"/>
                <path d="M540.00 79.77h-17.33c-1.73-0.13-3.12-1.51-3.12-3.24l-0.02-71.02c0.15-1.66 1.60-2.96 3.35-2.96h16.13c1.51 0.07 2.76 1.08 3.10 2.48v10.85h0.33c4.89-10.05 11.73-14.84 23.78-14.84c7.82 0 15.45 2.83 20.36 10.60c4.57 7.22 4.57 19.36 4.57 28.12v37.02c-0.19 1.60-1.62 2.88-3.35 2.88h-17.48c-1.62-0.12-2.95-1.35-3.10-2.88v-31.97c0-9.86 1.14-24.28-10.93-24.28c-4.24 0-8.15 2.84-10.11 7.17c-2.45 5.47-2.77 10.92-2.77 17.11v31.73c-0.02 1.79-1.55 3.24-3.41 3.24v-0.01z"/>
                <path d="M280.39 45.72c0 6.87 0.16 12.60-3.30 18.71c-2.78 4.96-7.21 8.01-12.12 8.01c-6.72 0-10.66-5.12-10.66-12.70c0-14.93 13.39-17.65 26.08-17.65v3.63zm17.68 42.74c-1.16 1.04-2.84 1.11-4.15 0.41c-5.84-4.85-6.88-7.10-10.09-11.72c-9.64 9.83-16.48 12.77-28.99 12.77c-14.80 0-26.31-9.13-26.31-27.41c0-14.28 7.74-24.00 18.76-28.75c9.56-4.19 22.91-4.93 33.11-6.09v-2.27c0-4.17 0.33-9.10-2.12-12.70c-2.13-3.22-6.23-4.55-9.84-4.55c-6.69 0-12.64 3.43-14.10 10.54c-0.30 1.58-1.46 3.14-3.06 3.22l-16.88-1.82c-1.44-0.32-3.04-1.48-2.63-3.68c3.94-20.76 22.67-27.02 39.45-27.02c8.58 0 19.81 2.28 26.58 8.78c8.58 8.01 7.76 18.71 7.76 30.35v27.49c0 8.26 3.43 11.88 6.66 16.35c1.13 1.59 1.38 3.50-0.06 4.69c-3.60 3.01-10.01 8.59-13.53 11.73l-0.56-0.33z"/>
                <path d="M51.84 45.72c0 6.87 0.16 12.60-3.29 18.71c-2.79 4.96-7.21 8.01-12.12 8.01c-6.73 0-10.66-5.12-10.66-12.70c0-14.93 13.39-17.65 26.07-17.65v3.63zm17.68 42.74c-1.16 1.04-2.84 1.11-4.16 0.41c-5.84-4.85-6.88-7.10-10.08-11.72c-9.64 9.83-16.49 12.77-28.99 12.77c-14.81 0-26.32-9.13-26.32-27.41c0-14.28 7.74-24.00 18.76-28.75c9.56-4.19 22.91-4.93 33.12-6.09v-2.27c0-4.17 0.32-9.10-2.13-12.70c-2.13-3.22-6.22-4.55-9.84-4.55c-6.68 0-12.64 3.43-14.10 10.54c-0.30 1.58-1.46 3.14-3.06 3.22l-16.88-1.82c-1.44-0.32-3.04-1.48-2.62-3.68c3.93-20.76 22.66-27.02 39.44-27.02c8.58 0 19.81 2.28 26.58 8.78c8.58 8.01 7.76 18.71 7.76 30.35v27.49c0 8.26 3.42 11.88 6.66 16.35c1.13 1.59 1.38 3.50-0.06 4.69c-3.60 3.01-10.01 8.59-13.53 11.73l-0.55-0.33z"/>
              </svg>
              {/* Apple */}
              <svg className="h-5 w-auto" viewBox="0 0 170 170" fill="currentColor">
                <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.197-2.12-9.973-3.17-14.34-3.17-4.58 0-9.492 1.05-14.746 3.17-5.262 2.13-9.501 3.24-12.742 3.35-4.929 0.21-9.842-1.96-14.746-6.52-3.13-2.73-7.045-7.41-11.735-14.04-5.032-7.08-9.169-15.29-12.41-24.65-3.471-10.11-5.211-19.9-5.211-29.378 0-10.857 2.346-20.221 7.045-28.068 3.693-6.303 8.606-11.275 14.755-14.925s12.793-5.51 19.948-5.629c3.915 0 9.049 1.211 15.429 3.591 6.362 2.388 10.447 3.599 12.238 3.599 1.339 0 5.877-1.416 13.57-4.239 7.275-2.618 13.415-3.702 18.445-3.275 13.63 1.1 23.87 6.473 30.68 16.153-12.19 7.386-18.22 17.731-18.1 31.002 0.11 10.337 3.86 18.939 11.23 25.769 3.34 3.17 7.07 5.62 11.22 7.36-0.9 2.61-1.85 5.11-2.86 7.51zM119.11 7.24c0 8.102-2.96 15.667-8.86 22.669-7.12 8.324-15.732 13.134-25.071 12.375-0.119-0.972-0.188-1.995-0.188-3.07 0-7.778 3.386-16.102 9.399-22.908 3.002-3.446 6.82-6.311 11.45-8.597 4.62-2.252 8.99-3.497 13.1-3.71 0.12 1.083 0.17 2.166 0.17 3.24z"/>
              </svg>
              {/* Meta */}
              <svg className="h-5 w-auto" viewBox="0 0 512 512" fill="currentColor">
                <path d="M256 0C114.6 0 0 114.6 0 256s114.6 256 256 256 256-114.6 256-256S397.4 0 256 0zm-48.9 384c-52.7 0-95.3-42.6-95.3-95.3 0-52.7 42.6-95.3 95.3-95.3 25.5 0 48.6 10 65.8 26.3l-26.6 25.7c-10.3-9.8-24.1-15.8-39.2-15.8-31.6 0-57.2 25.6-57.2 57.2s25.6 57.2 57.2 57.2c28.7 0 52.4-21.1 56.5-48.6h-56.5v-33.8h94.8c1.1 6.3 1.7 12.9 1.7 19.7-.1 53.7-43.4 102.7-96.5 102.7zm160.8-45.3l-26.1-15.1 26.1-45.2 26.1 45.2-26.1 15.1zm0-90.3l-26.1-15.1 26.1-45.2 26.1 45.2-26.1 15.1zm-52.3 45.2l-26.1-15.1 26.1-45.2 26.1 45.2-26.1 15.1z"/>
              </svg>
              {/* Netflix */}
              <svg className="h-5 w-auto" viewBox="0 0 111 30" fill="currentColor">
                <path d="M105.06 14.28L111 30c-1.75-.25-3.499-.563-5.28-.845l-3.345-8.686-3.437 7.969c-1.687-.282-3.344-.376-5.031-.595l6.031-13.75L94.468 0H99.5l3.062 8.188L105.875 0h5.063l-5.875 14.28z"/>
                <path d="M90.5 0v27.594c-1.718.063-3.5.125-5.28.22V0H90.5z"/>
                <path d="M81.5 0v27.75c-1.781-.031-3.5 0-5.28.031V0H81.5z"/>
                <path d="M71.469 4.72V0H55.78v4.72h5.312v22.937c1.75-.031 3.5-.094 5.282-.125V4.72h5.094z"/>
                <path d="M50.562 27.5V0H45.28v19.156l-7.875-19.156h-5.188v27.5c1.75.031 3.5.063 5.28.094V8.28l8.375 19.5c1.594-.031 3.125-.063 4.688-.094V0l.001-.156"/>
                <path d="M24.812 13.688c-1.5-.438-2.5-.781-2.5-1.813 0-.594.562-1.031 1.531-1.031.875 0 1.782.375 2.782 1.187l2.875-3.843c-1.532-1.25-3.594-2.032-5.594-2.032-3.562 0-6.312 2.032-6.312 5.032 0 2.844 2.407 4.25 4.625 4.875 2.032.563 3.218.907 3.218 1.969s-.875 1.406-2.093 1.406c-1.22 0-2.688-.625-3.844-1.782l-2.906 3.844c1.812 1.719 4.25 2.688 6.718 2.688 3.657 0 6.782-1.906 6.782-5.469 0-2.844-2.312-4.25-5.282-5.031"/>
                <path d="M0 0v27.5h10.906c5.782 0 9.188-3 9.188-8.062 0-3.375-1.782-5.688-4.75-6.657C17.25 12.125 18.844 10 18.844 7c0-4.625-3.188-7-8.813-7H0zm5.28 4.72h4.625c2.532 0 3.656 1 3.656 2.687s-1.125 2.625-3.656 2.625H5.281V4.72zm0 9.656h5.062c2.406 0 3.907.875 3.907 2.875 0 2.156-1.5 3.062-4.062 3.062H5.28v-5.937z"/>
              </svg>
            </div>
          </div>

          {/* What you'll discover - brief preview */}
          <div className="mt-10 pt-8 border-t border-border/30 animate-fade-in" style={{ animationDelay: "0.2s" }}>
            <p className="text-sm text-muted-foreground mb-4">Your free scan reveals:</p>
            <div className="flex flex-wrap justify-center gap-3">
              {[
                "ATS Score",
                "Missing Keywords", 
                "Red Flags",
                "Quick Fixes"
              ].map((item) => (
                <span 
                  key={item}
                  className="px-3 py-1.5 rounded-full bg-card/60 border border-border/50 text-xs sm:text-sm text-foreground"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
