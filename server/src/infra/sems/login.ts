import { chromium, type Locator, type Page } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import { env } from '../../config/env.js'

/**
 * Login headless no SEMS+ (semsplus.goodwe.com) via Playwright.
 *
 * Em vez de recriar o X-Signature na mão (frágil), abrimos a página de login num
 * navegador headless, preenchemos usuário/senha e deixamos o próprio JS do site
 * gerar `token` e `X-Signature` — capturamos ambos dos headers das requisições
 * que o portal dispara para o us-gateway logo após o login.
 *
 * O portal é uma SPA roteada por hash (`/#/login`) e antes de logar é preciso
 * selecionar o servidor/região correto (o dispositivo está no servidor
 * "Americas", que é o que fala com `us-gateway.semsportal.com`) — sem isso o
 * formulário de login nem chega a renderizar.
 */

const GATEWAY_HOST = new URL(env.SEMS_GATEWAY).host

// Seletores tentados em ordem de prioridade para o campo de conta/usuário.
// Um único seletor combinado com `.first()` pode travar num elemento oculto
// (ex.: input isca de autofill) que nunca fica visível; por isso testamos um
// de cada vez e seguimos para o próximo assim que um deles não aparece.
const ACCOUNT_SELECTORS = [
  "input[name='account']",
  "input[name='username']",
  "input[name='email']",
  "input[type='email']",
  "input[id*='account' i]",
  "input[id*='email' i]",
  "input[id*='username' i]",
  "input[placeholder*='mail' i]",
  "input[placeholder*='usu' i]",
  "input[placeholder*='conta' i]",
  "input[placeholder*='account' i]",
  "input[type='text']",
]

// Nomes de região conhecidos do portal, usados para achar o seletor de servidor.
const KNOWN_REGIONS = [
  'Americas', 'América', 'Europe', 'Europa', 'Australia', 'Austrália', 'Asia', 'Ásia', 'Africa', 'África',
]

export class CaptchaRequiredError extends Error {}
export class SemsLoginError extends Error {}

export async function loginHeadless(): Promise<{ token: string; signature: string }> {
  const captured: { token?: string; signature?: string } = {}
  let settled = false
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  const browser = await chromium.launch({ headless: env.SEMS_HEADLESS, args: ['--no-sandbox'] })
  const ctx = await browser.newContext({
    locale: 'pt-BR',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  })
  const page = await ctx.newPage()

  page.on('request', (req) => {
    if (settled || !req.url().includes(GATEWAY_HOST)) return
    const h = req.headers()
    const tok = h['token']
    const sig = h['x-signature']
    if (tok && sig) {
      captured.token = tok
      captured.signature = sig
      settled = true
      resolveDone()
    }
  })

  try {
    await page.goto(env.SEMS_LOGIN_URL, { timeout: env.SEMS_LOGIN_TIMEOUT_MS, waitUntil: 'domcontentloaded' })
    await selectRegion(page, env.SEMS_REGION)
    await fillAndSubmit(page)

    const timedOut = await Promise.race([
      done.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), env.SEMS_LOGIN_TIMEOUT_MS)),
    ])
    if (timedOut) {
      if (await captchaVisible(page)) throw new CaptchaRequiredError('Aliyun Captcha exigido no login')
      const { png, html } = await dumpDebug(page, 'login_no_gateway_call')
      throw new SemsLoginError(`login não produziu sessão (credenciais ou seletor?); screenshot=${png} html=${html}`)
    }
  } finally {
    await ctx.close()
    await browser.close()
  }

  return { token: captured.token!, signature: captured.signature! }
}

/** Seleciona o servidor/região (ex.: "Americas") antes do login, se houver esse
 * seletor na página. Best-effort: se não encontrar nada em poucos segundos,
 * segue em frente (a página pode já abrir na região certa). */
async function selectRegion(page: Page, region: string): Promise<void> {
  try {
    // Caso 1: <select> nativo com uma option correspondente à região.
    const selects = page.locator('select')
    const count = await selects.count()
    for (let i = 0; i < count; i++) {
      const sel = selects.nth(i)
      let opts: string[]
      try {
        opts = await sel.locator('option').allTextContents()
      } catch {
        continue
      }
      const match = opts.find((o) => o.toLowerCase().includes(region.toLowerCase()))
      if (match) {
        await sel.selectOption({ label: match })
        return
      }
    }

    // Caso 2: dropdown/tab customizado — procura um elemento clicável já visível
    // cujo texto seja algum nome de região conhecido (indicando o seletor de
    // servidor, mesmo que mostre outra região por padrão).
    const trigger = page.locator(KNOWN_REGIONS.map((r) => `text=/^${r}$/i`).join(',')).first()
    if (await trigger.count()) {
      try {
        await trigger.waitFor({ state: 'visible', timeout: 3000 })
        await trigger.click({ timeout: 3000 })
      } catch {
        return
      }
      const option = page.getByText(region, { exact: false }).first()
      try {
        await option.waitFor({ state: 'visible', timeout: 3000 })
        await option.click()
      } catch {
        /* segue sem selecionar */
      }
    }
  } catch {
    // Nunca deixa a seleção de região derrubar o login inteiro — na pior das
    // hipóteses o formulário falha depois e o diagnóstico (screenshot) mostra o motivo real.
  }
}

/** Preenche o form de login. Seletores tolerantes a variações do portal. */
async function fillAndSubmit(page: Page): Promise<void> {
  try {
    await page.locator('input').first().waitFor({ state: 'visible', timeout: env.SEMS_LOGIN_TIMEOUT_MS })
  } catch {
    throw await diagnoseFailure(page, 'nenhum campo de formulário apareceu na página de login')
  }

  let acc: Locator | null = null
  for (const selector of ACCOUNT_SELECTORS) {
    const loc = page.locator(selector).first()
    try {
      await loc.waitFor({ state: 'visible', timeout: 1500 })
      acc = loc
      break
    } catch {
      continue
    }
  }
  if (!acc) throw await diagnoseFailure(page, 'campo de conta/usuário não encontrado entre os seletores conhecidos')

  const pwd = page.locator("input[type='password']").first()
  try {
    await pwd.waitFor({ state: 'visible', timeout: 5000 })
  } catch {
    throw await diagnoseFailure(page, 'campo de senha não encontrado')
  }

  await acc.fill(env.SEMS_ACCOUNT)
  await pwd.fill(env.SEMS_PASSWORD)

  // O portal exige aceitar os termos/privacidade antes de logar. O container
  // desse aceite fica por cima do botão e intercepta o clique, causando timeout.
  // Marcamos o checkbox de aceite antes.
  await acceptAgreement(page)

  const btn = page
    .locator("button[type='submit'], button:has-text('Entrar'), button:has-text('Login'), button:has-text('Log in')")
    .first()
  if (await btn.count()) {
    try {
      await btn.click({ timeout: 8000 })
    } catch {
      // Overlay ainda intercepta: clica direto no elemento via DOM, ignorando
      // quem estiver por cima (o handler React ainda dispara).
      await btn.evaluate((el: HTMLElement) => el.click())
    }
  } else {
    await pwd.press('Enter')
  }
}

/** Fecha o banner de cookies e marca o aceite do Contrato de Serviço.
 *
 * Cuidado: há dois checkboxes na tela — "Lembrar senha" e "Li e concordo com o
 * Contrato de Serviço". Só o segundo habilita o botão Login, então miramos pelo
 * texto e nunca pelo "primeiro checkbox da página". */
async function acceptAgreement(page: Page): Promise<void> {
  for (const label of ['Aceitar cookies', 'Aceitar', 'Accept cookies', 'Accept all', 'Aceitar tudo']) {
    const b = page.getByRole('button', { name: label, exact: false }).first()
    try {
      if (await b.count()) {
        await b.click({ timeout: 3000 })
        break
      }
    } catch {
      continue
    }
  }

  for (const text of ['concordo', 'Contrato de Serviço', 'Termos', 'agree', 'Agreement']) {
    const row = page
      .locator(
        `xpath=//*[contains(text(),'${text}')]/ancestor-or-self::*[.//input[@type='checkbox'] or .//*[contains(@class,'ant-checkbox')]][1]`,
      )
      .first()
    try {
      if (!(await row.count())) continue
      const cb = row.locator("input[type='checkbox']").first()
      if (await cb.count()) {
        await cb.check({ timeout: 3000, force: true })
        return
      }
      const box = row.locator(".ant-checkbox, [class*='checkbox']").first()
      if (await box.count()) {
        await box.click({ timeout: 3000, force: true })
        return
      }
    } catch {
      continue
    }
  }
}

/** Monta o erro a ser levantado quando o formulário não é encontrado: detecta
 * captcha, descreve os inputs presentes e salva screenshot/HTML em disco para
 * inspeção remota via GET /admin/sems/debug/*. */
async function diagnoseFailure(page: Page, reason: string): Promise<Error> {
  if (await captchaVisible(page)) {
    return new CaptchaRequiredError('Aliyun Captcha exigido no login (detectado ao preencher formulário)')
  }
  const inputsDesc = await describeInputs(page)
  const { png, html } = await dumpDebug(page, 'login_fail')
  let title = '?'
  try {
    title = await page.title()
  } catch {
    /* mantém "?" */
  }
  return new SemsLoginError(
    `${reason}; url=${page.url()}; title=${JSON.stringify(title)}; inputs=[${inputsDesc}]; screenshot=${png}; html=${html}`,
  )
}

async function describeInputs(page: Page, limit = 10): Promise<string> {
  try {
    const inputs = await page.locator('input').all()
    const descs: string[] = []
    for (const inp of inputs.slice(0, limit)) {
      try {
        const name = await inp.getAttribute('name')
        const itype = await inp.getAttribute('type')
        const placeholder = await inp.getAttribute('placeholder')
        const visible = await inp.isVisible()
        descs.push(`(name=${JSON.stringify(name)} type=${JSON.stringify(itype)} placeholder=${JSON.stringify(placeholder)} visible=${visible})`)
      } catch {
        continue
      }
    }
    return descs.length ? descs.join(', ') : 'nenhum'
  } catch {
    return 'erro ao inspecionar'
  }
}

async function dumpDebug(page: Page, tag: string): Promise<{ png: string; html: string }> {
  const ts = Math.floor(Date.now() / 1000)
  await fs.mkdir(env.SEMS_DEBUG_DIR, { recursive: true }).catch(() => {})
  let png = path.join(env.SEMS_DEBUG_DIR, `${tag}_${ts}.png`)
  let html = path.join(env.SEMS_DEBUG_DIR, `${tag}_${ts}.html`)
  try {
    await page.screenshot({ path: png, fullPage: true })
  } catch {
    png = ''
  }
  try {
    const content = await page.content()
    await fs.writeFile(html, content, 'utf-8')
  } catch {
    html = ''
  }
  return { png, html }
}

async function captchaVisible(page: Page): Promise<boolean> {
  try {
    return (await page.locator("[id*='aliyunCaptcha'], iframe[src*='captcha'], .nc_wrapper").count()) > 0
  } catch {
    return false
  }
}
