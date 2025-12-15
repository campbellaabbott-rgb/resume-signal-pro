import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="py-12 border-t border-border" role="contentinfo">
      <div className="container">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Resume Booster. All rights reserved.</p>
          <nav className="flex items-center gap-6" aria-label="Footer navigation">
            <Link 
              to="/privacy" 
              className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:text-primary min-h-[44px] flex items-center touch-manipulation"
            >
              Privacy Policy
            </Link>
            <Link 
              to="/terms" 
              className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:text-primary min-h-[44px] flex items-center touch-manipulation"
            >
              Terms of Service
            </Link>
            <a 
              href="mailto:support@resumebooster.com" 
              className="hover:text-foreground transition-colors focus-visible:outline-none focus-visible:text-primary min-h-[44px] flex items-center touch-manipulation"
              aria-label="Contact us via email"
            >
              Contact
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
