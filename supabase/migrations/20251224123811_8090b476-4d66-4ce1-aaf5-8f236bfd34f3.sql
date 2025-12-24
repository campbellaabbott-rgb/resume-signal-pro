-- Add column to track which AI model was used for generation
ALTER TABLE public.product_deliveries 
ADD COLUMN IF NOT EXISTS ai_model_used text;

-- Add index for analytics queries
CREATE INDEX IF NOT EXISTS idx_product_deliveries_ai_model 
ON public.product_deliveries(ai_model_used) 
WHERE ai_model_used IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.product_deliveries.ai_model_used IS 'The AI model that successfully generated the content (e.g., openai/gpt-5, google/gemini-2.5-pro)';