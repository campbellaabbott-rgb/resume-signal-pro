ALTER TABLE public._mig_probe ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._mig_probe FROM anon, authenticated;