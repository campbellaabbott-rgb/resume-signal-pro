-- Enable realtime for affiliate tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.affiliate_clicks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.affiliate_conversions;