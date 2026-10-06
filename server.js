const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PRODUCAO = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'dados.json');
const DURACAO_LOGIN = 30 * 24 * 60 * 60 * 1000; // 30 dias

// ===== Segurança: senha de acesso e segredo da sessão =====
let SENHA = process.env.SENHA_ACESSO;
let SEGREDO = process.env.SEGREDO;
if (!SENHA || !SEGREDO) {
  if (PRODUCAO) {
    console.error('ERRO: defina as variáveis SENHA_ACESSO e SEGREDO no servidor.');
    process.exit(1);
  }
  SENHA = SENHA || 'escola123';
  SEGREDO = SEGREDO || 'segredo-local-somente-para-testes';
  console.warn('Modo local: a senha de acesso é "escola123".');
}

// ===== EDITE AQUI: cursos de informática da escola =====
const CURSOS = [
  'Informática Básica',
  'Informática Avançada',
  'Word e PowerPoint',
  'Excel',
  'Manutenção de Computadores',
  'Design Gráfico',
  'Programação',
];

// ===== Grade de horários =====
const GRADE = {
  segunda: ['13:00-15:00', '15:00-17:00', '17:00-19:00'],
  terca:   ['13:00-15:00', '15:00-17:00', '17:00-19:00'],
  quarta:  ['13:00-15:00', '15:00-17:00', '17:00-19:00'],
  quinta:  ['13:00-15:00', '15:00-17:00', '17:00-19:00'],
  sexta:   ['08:00-10:00', '10:00-12:00', '13:00-15:00', '15:00-17:00'],
  sabado:  ['08:00-10:00', '10:00-12:00'],
};

// ===== Login (sessão assinada em cookie) =====
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const senhaOk = (s) => crypto.timingSafeEqual(hash(s), hash(SENHA));
const assinar = (b64) => crypto.createHmac('sha256', SEGREDO).update(b64).digest('base64url');

function criarToken(nome) {
  const b64 = Buffer.from(JSON.stringify({ n: nome, e: Date.now() + DURACAO_LOGIN })).toString('base64url');
  return `${b64}.${assinar(b64)}`;
}

function lerToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const esperado = assinar(b64);
  if (sig.length !== esperado.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const p = JSON.parse(Buffer.from(b64, 'base64url').toString());
    return p.e > Date.now() ? p : null;
  } catch (e) {
    return null;
  }
}

function lerCookies(header = '') {
  const out = {};
  header.split(';').forEach((par) => {
    const i = par.indexOf('=');
    if (i > 0) out[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  });
  return out;
}

// Limite de tentativas erradas: 5 por IP a cada 15 minutos
const tentativas = new Map();
const bloqueado = (ip) => {
  const t = tentativas.get(ip);
  return t && t.n >= 5 && Date.now() < t.ate;
};
const registrarFalha = (ip) => {
  const t = tentativas.get(ip);
  if (!t || Date.now() > t.ate) tentativas.set(ip, { n: 1, ate: Date.now() + 15 * 60 * 1000 });
  else t.n++;
};

// ===== Persistência em arquivo JSON =====
fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { alunos: [], agenda: [] };
try {
  if (fs.existsSync(DATA_FILE)) {
    const lido = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.alunos = Array.isArray(lido.alunos) ? lido.alunos : [];
    db.agenda = Array.isArray(lido.agenda) ? lido.agenda : [];
  }
} catch (e) {
  console.error('Erro ao ler dados, iniciando vazio:', e.message);
}

const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const responder = (cb) => (typeof cb === 'function' ? cb : () => {});

// ===== Servidor =====
const app = express();
app.set('trust proxy', 1); // necessário atrás do proxy da hospedagem
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '1kb' }));

// Rotas públicas (login)
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (bloqueado(ip)) {
    return res.status(429).json({ ok: false, erro: 'Muitas tentativas. Aguarde 15 minutos.' });
  }
  const nome = txt(req.body && req.body.nome, 30);
  const senha = String((req.body && req.body.senha) ?? '');
  if (!nome) return res.status(400).json({ ok: false, erro: 'Informe seu nome.' });
  if (!senhaOk(senha)) {
    registrarFalha(ip);
    return res.status(401).json({ ok: false, erro: 'Senha incorreta.' });
  }
  tentativas.delete(ip);
  res.cookie('sessao', criarToken(nome), {
    httpOnly: true,
    sameSite: 'lax',
    secure: PRODUCAO,
    maxAge: DURACAO_LOGIN,
  });
  res.json({ ok: true });
});

app.get('/sair', (req, res) => {
  res.clearCookie('sessao');
  res.redirect('/login');
});

// Tudo daqui para baixo exige login
app.use((req, res, next) => {
  const sessao = lerToken(lerCookies(req.headers.cookie).sessao);
  if (sessao) {
    req.usuario = sessao;
    return next();
  }
  if (req.method === 'GET' && req.accepts('html')) return res.redirect('/login');
  res.status(401).end();
});

// Backup: baixa o arquivo de dados (acesse /api/backup logado)
app.get('/api/backup', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) return res.status(404).send('Ainda não há dados.');
  res.download(DATA_FILE, 'backup-quadro-horarios.json');
});

app.use(express.static(path.join(__dirname, 'public')));

// Tempo real também exige login
io.use((socket, next) => {
  const sessao = lerToken(lerCookies(socket.handshake.headers.cookie).sessao);
  if (!sessao) return next(new Error('nao-autorizado'));
  socket.usuario = sessao.n;
  next();
});

function estadoAtual() {
  return { grade: GRADE, cursos: CURSOS, alunos: db.alunos, agenda: db.agenda };
}

function persistir() {
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE); // gravação segura
  } catch (e) {
    console.error('Erro ao salvar:', e.message);
  }
  io.emit('estado', estadoAtual());
}

// ===== Quem está conectado =====
const online = new Map(); // socket.id -> nome do funcionário
function nomesOnline() {
  return [...new Set(online.values())].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

io.on('connection', (socket) => {
  socket.emit('estado', estadoAtual());
  socket.emit('online', nomesOnline());

  socket.on('entrar', (nome) => {
    const n = txt(nome, 30);
    if (!n) return;
    online.set(socket.id, n);
    io.emit('online', nomesOnline());
  });

  socket.on('disconnect', () => {
    if (online.delete(socket.id)) io.emit('online', nomesOnline());
  });

  // ----- Cadastro de alunos -----
  socket.on('aluno:salvar', (d, cb) => {
    const resp = responder(cb);
    const nome = txt(d && d.nome, 100);
    if (!nome) return resp({ ok: false, erro: 'Informe o nome do aluno.' });

    const id = d && typeof d.id === 'string' ? d.id : '';
    const repetido = db.alunos.some(
      (a) => a.id !== id && a.nome.toLowerCase() === nome.toLowerCase()
    );
    if (repetido) return resp({ ok: false, erro: 'Já existe um aluno com esse nome.' });

    const existente = id && db.alunos.find((a) => a.id === id);
    if (existente) existente.nome = nome;
    else db.alunos.push({ id: crypto.randomUUID(), nome });

    persistir();
    resp({ ok: true });
  });

  socket.on('aluno:remover', (id, cb) => {
    const resp = responder(cb);
    db.alunos = db.alunos.filter((a) => a.id !== id);
    db.agenda = db.agenda.filter((x) => x.alunoId !== id);
    persistir();
    resp({ ok: true });
  });

  // ----- Agenda (aluno em um horário) -----
  socket.on('agenda:salvar', (d, cb) => {
    const resp = responder(cb);
    if (!d || typeof d !== 'object') return resp({ ok: false, erro: 'Dados inválidos.' });

    const dia = txt(d.dia, 20);
    const horario = txt(d.horario, 20);
    if (!GRADE[dia] || !GRADE[dia].includes(horario)) {
      return resp({ ok: false, erro: 'Horário inválido.' });
    }

    const aluno = db.alunos.find((a) => a.id === d.alunoId);
    if (!aluno) return resp({ ok: false, erro: 'Selecione um aluno.' });

    const curso = txt(d.curso, 100);
    if (!CURSOS.includes(curso)) return resp({ ok: false, erro: 'Selecione um curso.' });

    const reposicao = d.reposicao === true;
    const obs = reposicao ? txt(d.obs, 200) : '';
    const id = typeof d.id === 'string' ? d.id : '';

    const conflito = db.agenda.find(
      (a) => a.id !== id && a.alunoId === aluno.id && a.dia === dia && a.horario === horario
    );
    if (conflito) {
      return resp({
        ok: false,
        erro: `${aluno.nome} já está neste horário (${conflito.curso}).`,
      });
    }

    const item = { id: id || crypto.randomUUID(), dia, horario, alunoId: aluno.id, curso, reposicao, obs };
    const i = id ? db.agenda.findIndex((a) => a.id === id) : -1;
    if (i >= 0) db.agenda[i] = item;
    else db.agenda.push(item);

    persistir();
    resp({ ok: true });
  });

  socket.on('agenda:remover', (id, cb) => {
    const resp = responder(cb);
    db.agenda = db.agenda.filter((a) => a.id !== id);
    persistir();
    resp({ ok: true });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Quadro de horários rodando em http://localhost:${PORT}`);
});