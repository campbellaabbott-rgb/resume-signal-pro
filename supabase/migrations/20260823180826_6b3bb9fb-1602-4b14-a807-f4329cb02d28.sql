DELETE FROM public.job_board_postings
WHERE source = 'pinpoint'
  AND company_token IN (
  'aiven','ajbell','alan','alixpartners','alten','amplitude','analysysmason','asmglobal','assistantlaunch','bakerhicks','bcn','bison','boomi','bosch','brave','chattermill','checkr','circlek','closinglock','controlrisks','costellomedical','cube','damen','datamark','dmgevents','dms','egis','eisneramper','ekimetrics','elastic','euromonitor','everbridge','exadel','focus','forbrightbank','fundingcircle','groupon','haasf1team','harness','hellofresh','improbable','innovid','iqeq','keyloop','kraken','lendable','liberis','light','linenchest','livanova','lottie','lowell','lxt','magnopus','mcafee','mearsgroup','mejuri','metaview','msamlin','multiplier','next','ogilvy','overstory','revolutionspace','riverflex','rothschildandco','savanta','scc','scope','seeq','semperis','sfg20','shiftmove','siteminder','slu','smarsh','sofi','songtradr','soprasteria','spinnakersupport','spire','sptlabtech','squiz','stackinfra','stagecoach','sunrun','systemiq','technologyadvice','technosylva','telegraph','theaccessgroup','thoughtmachine','tileshop','topdoglaw','toyota','transunion','tritility','ttc','ttp','ugsolutions','unit4','unmind','utilitywarehouse','uvcyber','verifone','version1','wearesocial','whitbywood','wifinity','zendesk','zuora'
);

UPDATE public.job_board_meta
SET v = jsonb_set(v, '{size}', to_jsonb(LEAST((v->>'size')::int, 31709))),
    updated_at = now()
WHERE k = 'catalog_highwater';