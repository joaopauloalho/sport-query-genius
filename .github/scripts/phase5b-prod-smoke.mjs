import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL ?? "https://sport-query-genius.vercel.app";
const email = process.env.SMOKE_EMAIL ?? "smoke.prod.20260824.0740@example.com";
const password = process.env.SMOKE_PASSWORD ?? "Scoutly-Smoke-2026!";

const errorTitles = [
  "Time não encontrado",
  "Jogador não encontrado",
  "Entidade ambígua",
  "Pergunta não compreendida",
  "Métrica não suportada",
  "Filtro não suportado",
  "Consulta ainda não suportada",
  "Limite do provider atingido",
  "Provider indisponível",
  "Dados insuficientes",
  "DeepSeek indisponível",
  "Resposta inválida do DeepSeek",
  "Sessão expirada",
  "Muitas solicitações",
  "Limite de uso atingido",
  "Análise já em andamento",
  "Solicitação já processada",
  "Proteção de uso indisponível",
  "Não foi possível analisar",
];

const questions = [
  "Qual a média de posse de bola do Corinthians nos últimos 10 jogos?",
  "Qual a média de escanteios do Corinthians nos jogos em que teve mais de 10 chutes?",
  "Quantos chutes no alvo o Corinthians teve nos jogos em que venceu?",
  "Liste os jogos do Corinthians com pelo menos 6 escanteios.",
  "Qual a média de posse do Benfica na Champions League 2025/26?",
  "Mostre os jogos do Arsenal na Premier League 2025/26 com pelo menos 4 chutes no alvo.",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "pt-BR" });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.on("console", (message) => console.log(`BROWSER_CONSOLE|${message.type()}|${message.text()}`));
page.on("pageerror", (error) => console.log(`BROWSER_PAGEERROR|${error.message}`));

function compact(body, max = 2200) {
  return body.replace(/\s+/g, " ").slice(0, max);
}

async function waitForResult(question) {
  for (let attempt = 1; attempt <= 18; attempt += 1) {
    await page.waitForTimeout(5_000);
    const body = await page.locator("body").innerText();
    const normalized = body.toLocaleLowerCase("pt-BR");
    const matchedError = errorTitles.find((title) => normalized.includes(title.toLocaleLowerCase("pt-BR")));
    if (matchedError) return { kind: "FAIL_CLOSED", error: matchedError, body };
    if (normalized.includes("dados reais")) return { kind: "ANSWERED", error: null, body };
    console.log(`RESULT_POLL|${attempt}|${JSON.stringify(question)}|${compact(body, 500)}`);
  }
  return { kind: "TIMEOUT", error: "UI timeout", body: await page.locator("body").innerText() };
}

try {
  console.log(`SMOKE_BASE_URL=${baseUrl}`);
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForTimeout(4_000);
  if (!page.url().includes("/app")) {
    throw new Error(`AUTH_FAILED|url=${page.url()}|body=${compact(await page.locator("body").innerText(), 1200)}`);
  }
  console.log(`AUTH_PASS|${email}`);

  let answered = 0;
  let failClosed = 0;
  let timedOut = 0;

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const target = `${baseUrl}/app/resultado?q=${encodeURIComponent(question)}`;
    console.log(`QUERY_START|${index + 1}|${JSON.stringify(question)}`);
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const result = await waitForResult(question);
    if (result.kind === "ANSWERED") answered += 1;
    else if (result.kind === "FAIL_CLOSED") failClosed += 1;
    else timedOut += 1;
    console.log(`QUERY_RESULT|${index + 1}|${result.kind}|${JSON.stringify(question)}|ERROR=${result.error ?? ""}|BODY=${compact(result.body)}`);
    if (index < questions.length - 1) {
      console.log("WAIT_FOR_CONCURRENCY_GUARD=35s");
      await page.waitForTimeout(35_000);
    }
  }

  console.log(`SMOKE_SUMMARY|answered=${answered}|fail_closed=${failClosed}|timeout=${timedOut}|total=${questions.length}`);
  if (timedOut > 0) process.exitCode = 2;
} finally {
  await browser.close();
}
