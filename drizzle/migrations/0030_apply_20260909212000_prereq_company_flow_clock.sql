SELECT public._mig_exec((SELECT sql FROM public._mig_stage WHERE name = '20260909212000_fixed'));
UPDATE public._mig_stage SET applied_at = now() WHERE name = '20260909212000_fixed';