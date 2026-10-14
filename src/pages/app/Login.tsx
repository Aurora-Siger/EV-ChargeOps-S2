import { useState } from 'react'
import { Link } from 'react-router-dom'
import Volt from '../../components/Volt'
import logo from '../../assets/logo.png'
import { CONNECTION_ERROR_MESSAGE, authClient, authErrorMessage } from '../../lib/authClient'

/* ── login (Better Auth, e-mail e senha; sem cadastro público) ── */

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [verSenha, setVerSenha] = useState(false)
  const [lembrar, setLembrar] = useState(true)
  const [entrando, setEntrando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Sucesso não precisa de callback: o Better Auth atualiza o useSession() do App sozinho.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    setEntrando(true)
    try {
      const { error } = await authClient.signIn.email({ email: email.trim(), password: senha, rememberMe: lembrar })
      if (error) {
        setErro(authErrorMessage(error))
        setEntrando(false)
      }
    } catch {
      // O cliente lança (em vez de devolver `error`) quando a conexão cai no caminho.
      setErro(CONNECTION_ERROR_MESSAGE)
      setEntrando(false)
    }
  }

  return (
    <div className="login">
      <div className="login-glow" />
      <div className="login-box">
        <Link to="/" className="login-logo">
          <img src={logo} alt="Chargefy" />
        </Link>

        <div className="login-volt">
          <Volt size={64} />
          <div className="login-hi">
            <h1>Bem-vindo de volta</h1>
            <p>Entre para agendar sua recarga e acompanhar seus gastos.</p>
          </div>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            <span>E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="field">
            <span>Senha</span>
            <div className="field-pw">
              <input
                type={verSenha ? 'text' : 'password'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button type="button" className="pw-toggle" onClick={() => setVerSenha((v) => !v)}>
                {verSenha ? 'ocultar' : 'mostrar'}
              </button>
            </div>
          </label>

          <div className="login-row">
            <label className="check-lbl">
              <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Manter conectado
            </label>
            <button
              type="button"
              className="link-btn"
              onClick={() => setAviso('Peça ao gestor do condomínio para definir uma senha nova para você no painel.')}
            >
              Esqueci minha senha
            </button>
          </div>

          {aviso && <div className="login-note">{aviso}</div>}

          {erro && (
            <div className="login-error" role="alert">
              {erro}
            </div>
          )}

          <button className="btn btn-primary login-cta" type="submit" disabled={entrando}>
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <div className="login-foot">
          Não tem conta?{' '}
          <button
            className="link-btn"
            onClick={() => setAviso('Não há cadastro aberto: o gestor do condomínio cria a sua conta e vincula a sua unidade.')}
          >
            Fale com o síndico
          </button>
        </div>
      </div>
    </div>
  )
}
