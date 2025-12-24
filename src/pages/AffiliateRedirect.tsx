import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

/**
 * Short link redirect handler
 * Redirects /r/:code to /?ref=:code
 */
export default function AffiliateRedirect() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (code) {
      // Redirect to home with ref parameter
      window.location.href = `${window.location.origin}/?ref=${code}`;
    } else {
      navigate('/');
    }
  }, [code, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Redirecting...</p>
      </div>
    </div>
  );
}
