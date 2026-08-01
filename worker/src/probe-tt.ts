import { chromium } from "playwright";
async function main() {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto("https://multiversecomputing.teamtailor.com/jobs/8102493-senior-data-engineer",
    { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForTimeout(5000);
  const d = await p.evaluate(`(() => {
    const files = [...document.querySelectorAll('input[type=file]')].map(e => ({
      name: e.name, accept: e.accept, hidden: getComputedStyle(e).display === 'none',
      w: Math.round(e.getBoundingClientRect().width) }));
    const body = document.body.innerText;
    return {
      fileInputs: files,
      mentionsResume: /resume|cv|curriculum|lebenslauf/i.test(body),
      dropZoneText: (body.match(/[^.\\n]{0,60}(upload|drag|resume|cv)[^.\\n]{0,60}/gi) || []).slice(0,4),
      submitLabels: [...document.querySelectorAll('button,input[type=submit]')]
        .map(e => (e.innerText || e.value || '').trim()).filter(Boolean).slice(0,8),
      hasConnectOption: /connect|sign in with|linkedin/i.test(body)
    };
  })()`);
  console.log(JSON.stringify(d, null, 2).slice(0, 1400));
  await b.close();
}
main();
