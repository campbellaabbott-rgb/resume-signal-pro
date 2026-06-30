import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, RefreshCcw, CreditCard, HelpCircle, ArrowLeft } from "lucide-react";

const PaymentFailed = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const product = searchParams.get("product");

  const commonReasons = [
    {
      icon: CreditCard,
      title: "Insufficient funds",
      description: "Your card or bank account may not have enough balance. Try a different payment method."
    },
    {
      icon: AlertCircle,
      title: "Card declined",
      description: "Your bank may have declined the transaction. Check with your bank or try another card."
    },
    {
      icon: HelpCircle,
      title: "Incorrect details",
      description: "Double-check your card number, expiration date, and CVV are entered correctly."
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
      <Card className="max-w-lg w-full shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl">{t('paymentFailed.title')}</CardTitle>
          <CardDescription className="text-base mt-2">
            We couldn't process your payment. Don't worry — no charges were made to your account.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Common reasons */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">{t('paymentFailed.commonReasons')}</p>
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

          {/* Action buttons */}
          <div className="flex flex-col gap-3 pt-2">
            <Button 
              size="lg" 
              className="w-full gap-2"
              onClick={() => navigate("/")}
            >
              <RefreshCcw className="w-4 h-4" />
              Try Again
            </Button>
            <Button 
              variant="outline" 
              size="lg"
              className="w-full gap-2"
              onClick={() => navigate("/")}
            >
              <ArrowLeft className="w-4 h-4" />
              Return to Home
            </Button>
          </div>

          {/* Support message */}
          <p className="text-center text-xs text-muted-foreground pt-2">
            Still having issues? Contact us at{" "}
            <a href="mailto:support@resumebooster.com" className="text-primary hover:underline">
              support@resumebooster.com
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentFailed;
