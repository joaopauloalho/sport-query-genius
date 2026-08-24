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
  "Qual a média de escanteios do Corinthians nos últimos 5 jogos?",
  "Quantos gols o Bayern de Munique marcou nos últimos 5 jogos?",
  "Quantos gols Yuri Alberto marcou nos últimos 10 jogos?",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: "pt-BR" });
const page = await context.newPage();
page.setDefaultTimeout(30_000);

try {
  console.log(`SMOKE_BASE_URL=${baseUrl}`);
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(2_000);

  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');
  const loginButton = page.getByRole("button", { name: "Entrar", exact: true });

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.waitForFunction(
    ({ expectedEmail, expectedPasswordLength }) => {
      const emailElement = document.querySelector('input[type="email"]');
      const passwordElement = document.querySelector('input[type="password"]');
      return (
        emailElement?.value === expectedEmail &&
        passwordElement?.value.length === expectedPasswordLength
      );
    },
    { expectedEmail: email, expectedPasswordLength: password.length },
  );
  console.log(`AUTH_FIELDS_READY email=${await emailInput.inputValue()} password_length=${(await passwordInput.inputValue()).length}`);
  await loginButton.click();

  await page.waitForTimeout(4_000);
  const authBody = await page.locator("body").innerText();
  if (!page.url().includes("/app")) {
    const compact = authBody.replace(/\s+/g, " ").slice(0, 800);
    throw new Error(`AUTH_FAILED url=${page.url()} body=${compact}`);
  }
  console.log(`AUTH_PASS email=${email}`);

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const target = `${baseUrl}/app/resultado?q=${encodeURIComponent(question)}`;
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });

    await page.waitForFunction(
      ({ errors }) => {
        const text = document.body?.innerText ?? "";
        return text.includes("Dados reais") || errors.some((title) => text.includes(title));
      },
      { errors: errorTitles },
      { timeout: 120_000 },
    );

    const body = await page.locator("body").innerText();
    const matchedError = errorTitles.find((title) => body.includes(title));
    if (matchedError || !body.includes("Dados reais")) {
      const compact = body.replace(/\s+/g, " ").slice(0, 1400);
      throw new Error(`QUERY_FAILED question=${JSON.stringify(question)} error=${matchedError ?? "missing real-data badge"} body=${compact}`);
    }

    const compact = body.replace(/\s+/g, " ").slice(0, 600);
    console.log(`QUERY_PASS|${question}|${compact}`);

    if (index < questions.length - 1) {
      console.log("WAIT_FOR_CONCURRENCY_GUARD=35s");
      await page.waitForTimeout(35_000);
    }
  }

  console.log(`SMOKE_PASS questions=${questions.length}`);
} finally {
  await browser.close();
}
