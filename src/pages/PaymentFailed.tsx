import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, RefreshCcw, CreditCard, HelpCircle, ArrowLeft, Loader2 } from "lucide-react";
import { PRODUCTS, type ProductId } from "@/config/products";
import { useProductCheckout } from "@/hooks/use-product-checkout";

/**
 * Stripe's cancel_url for every one-time checkout.
 *
 * WHAT IT SAID (platform sweep L3-15): "We couldn't process your payment",
 * with card-decline reasons, to everyone who simply backed out of Stripe
 * Checkout -- declines are shown inside Checkout itself, so the people who
 * land here mostly changed their mind. And "Try Again" went to the home page
 * whatever they had been buying, losing their place. It now says the checkout
 * was cancelled and nothing was charged, keeps the decline reasons as a
 * secondary "if your card was declined", and "Try again" returns to the
 * product named in ?product= (every checkout's cancel_url carries it).
 */
const PaymentFailed = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const product = searchParams.get("product");
  const { purchaseProduct, isLoading } = useProductCheckout();

  const known = product && product in PRODUCTS ? (product as ProductId) : null;

  const tryAgain = async () => {
    if (!known) return navigate("/");
    // The guided flow keeps the buyer's intake on this device; send them back to it.
    if (known.startsWith("freelance")) return navigate("/freelance-boost");
    // The analysis is bought from the scan results; the credits from their own picker.
    if (known === "fullAnalysis") return navigate("/");
    if (known === "scanPack") return navigate("/pricing");
    await purchaseProduct(known, { ctaSection: "payment_cancelled" });
  };

  const commonReasons = [
    { icon: CreditCard, title: t("paymentFailed.fundsTitle"), description: t("paymentFailed.fundsDesc") },
    { icon: AlertCircle, title: t("paymentFailed.declinedTitle"), description: t("paymentFailed.declinedDesc") },
    { icon: HelpCircle, title: t("paymentFailed.incorrectTitle"), description: t("paymentFailed.incorrectDesc") },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
      <Card className="max-w-lg w-full shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <ArrowLeft className="w-8 h-8 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">{t("paymentFailed.title")}</CardTitle>
          <CardDescription className="text-base mt-2">
            {t("paymentFailed.subtitle")}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Action buttons first: most people here just want to go back. */}
          <div className="flex flex-col gap-3 pt-2">
            <Button size="lg" className="w-full gap-2" onClick={tryAgain} disabled={isLoading}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
              {t("paymentFailed.tryAgain")}
            </Button>
            <Button variant="outline" size="lg" className="w-full gap-2" onClick={() => navigate("/")}>
              <ArrowLeft className="w-4 h-4" />
              {t("paymentFailed.returnHome")}
            </Button>
          </div>

          {/* If the card was in fact declined */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">{t("paymentFailed.commonReasons")}</p>
            <div className="space-y-3">
              {commonReasons.map((reason, index) => (
                <div key={index} className="flex gap-3 p-3 bg-muted/50 rounded-lg">
                  <reason.icon className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">{reason.title}</p>
                    <p className="text-xs text-muted-foreground">{reason.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Support message */}
          <p className="text-center text-xs text-muted-foreground pt-2">
            {t("paymentFailed.contactLead")}{" "}
            <a href="mailto:resumeboostersupp@gmail.com" className="text-primary hover:underline">
              resumeboostersupp@gmail.com
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentFailed;
