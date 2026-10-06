const socket = io();

const DIAS = [
  ['segunda', 'Segunda'],
  ['terca', 'Terça'],
  ['quarta', 'Quarta'],
  ['quinta', 'Quinta'],
  ['sexta', 'Sexta'],
  ['sabado', 'Sábado'],
];
const HORAS = ['08:00-10:00', '10:00-12:00', '13:00-15:00', '15:00-17:00', '17:00-19:00'];

let estado = { grade: {}, cursos: [], alunos: [], agenda: [] };
let visiveis = [];
let nomesOnline = [];
let alunoEditandoId = '';
let meuNome = '';
try { meuNome = localStorage.getItem('nomeFuncionario') || ''; } catch (e) {}

const $ = (id) => document.getElementById(id);
const modalAula = new bootstrap.Modal($('modalAula'));
const modalConfirmar = new bootstrap.Modal($('modalConfirmar'));
const modalNome = new bootstrap.Modal($('modalNome'));

const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const porNome = (a, b) => a.localeCompare(b, 'pt-BR');
const nomeAluno = (id) => (estado.alunos.find((a) => a.id === id) || { nome: '(aluno removido)' }).nome;
const nomeDia = (d) => (DIAS.find(([k]) => k === d) || ['', d])[1];
const horaTexto = (h) => h.replace('-', ' às ');
const classeCurso = (curso) => 'curso-' + (Math.max(0, estado.cursos.indexOf(curso)) % 8);

// ================= Confirmação =================
function confirmar(htmlMensagem) {
  return new Promise((resolve) => {
    let confirmado = false;
    $('confirmarTexto').innerHTML = htmlMensagem;
    const ok = () => { confirmado = true; modalConfirmar.hide(); };
    $('btnConfirmarOk').addEventListener('click', ok, { once: true });
    $('modalConfirmar').addEventListener(
      'hidden.bs.modal',
      () => {
        $('btnConfirmarOk').removeEventListener('click', ok);
        resolve(confirmado);
      },
      { once: true }
    );
    modalConfirmar.show();
  });
}

// ================= Quadro =================
function agendaFiltrada() {
  const fc = $('filtroCurso').value;
  const fa = $('filtroAluno').value.trim().toLowerCase();
  return estado.agenda.filter(
    (a) => (!fc || a.curso === fc) && (!fa || nomeAluno(a.alunoId).toLowerCase().includes(fa))
  );
}

function cardHTML(a) {
  return `
    <div class="aula ${classeCurso(a.curso)}">
      <div class="aula-topo">
        <strong class="aula-nome">${esc(nomeAluno(a.alunoId))}</strong>
        <span class="aula-acoes">
          <button class="btn-icone" data-acao="editar" data-id="${a.id}" title="Editar" aria-label="Editar">✏️</button>
          <button class="btn-icone" data-acao="excluir" data-id="${a.id}" title="Excluir" aria-label="Excluir">🗑️</button>
        </span>
      </div>
      <div class="d-flex flex-wrap gap-1">
        <span class="badge badge-curso">${esc(a.curso)}</span>
        ${a.reposicao ? '<span class="badge text-bg-warning">Reposição</span>' : ''}
      </div>
      ${a.reposicao && a.obs ? `<small class="obs">📝 ${esc(a.obs)}</small>` : ''}
    </div>`;
}

function slotHTML(dia, hora) {
  const itens = visiveis
    .filter((a) => a.dia === dia && a.horario === hora)
    .sort((a, b) => porNome(nomeAluno(a.alunoId), nomeAluno(b.alunoId)));
  return (
    itens.map(cardHTML).join('') +
    `<button class="btn btn-sm btn-outline-primary btn-add" data-acao="add"
        data-dia="${dia}" data-horario="${hora}">+ Aluno</button>`
  );
}

function popularFiltroCurso() {
  const sel = $('filtroCurso');
  if (sel.options.length === estado.cursos.length + 1) return;
  const atual = sel.value;
  sel.innerHTML =
    '<option value="">Todos os cursos</option>' +
    estado.cursos.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = atual;
}

function renderQuadro() {
  popularFiltroCurso();
  visiveis = agendaFiltrada();

  const total = estado.agenda.length;
  $('contador').textContent =
    visiveis.length === total
      ? `${total} agendamento(s) no quadro`
      : `Mostrando ${visiveis.length} de ${total} agendamento(s)`;

  // Tabela (computador / tablet)
  let t = '<thead><tr><th class="hora-col">Horário</th>';
  DIAS.forEach(([, nome]) => (t += `<th>${nome}</th>`));
  t += '</tr></thead><tbody>';
  HORAS.forEach((hora) => {
    t += `<tr><th class="hora-col">${horaTexto(hora)}</th>`;
    DIAS.forEach(([dia]) => {
      if (!(estado.grade[dia] || []).includes(hora)) t += '<td class="indisponivel"></td>';
      else t += `<td class="celula">${slotHTML(dia, hora)}</td>`;
    });
    t += '</tr>';
  });
  t += '</tbody>';
  $('quadro').innerHTML = t;

  // Cartões por dia (celular)
  $('quadroMobile').innerHTML = DIAS.map(
    ([dia, nome]) => `
      <div class="card mb-3">
        <div class="card-header fw-bold">${nome}</div>
        <div class="list-group list-group-flush">
          ${(estado.grade[dia] || [])
            .map(
              (h) => `
            <div class="list-group-item">
              <div class="hora-mobile">🕒 ${horaTexto(h)}</div>
              ${slotHTML(dia, h)}
            </div>`
            )
            .join('')}
        </div>
      </div>`
  ).join('');
}

// ================= Modal de aluno no horário =================
function abrirModalAula({ id = '', dia, horario, alunoId = '', curso = '', reposicao = false, obs = '' }) {
  const alunos = [...estado.alunos].sort((a, b) => porNome(a.nome, b.nome));
  $('aulaAluno').innerHTML =
    '<option value="">Selecione o aluno...</option>' +
    alunos.map((a) => `<option value="${a.id}">${esc(a.nome)}</option>`).join('');
  $('aulaCurso').innerHTML =
    '<option value="">Selecione o curso...</option>' +
    estado.cursos.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  $('modalTitulo').textContent = `${id ? 'Editar' : 'Adicionar'} — ${nomeDia(dia)}, ${horaTexto(horario)}`;
  $('aulaId').value = id;
  $('aulaDia').value = dia;
  $('aulaHorario').value = horario;
  $('aulaAluno').value = alunoId;
  $('aulaCurso').value = curso;
  $('aulaReposicao').checked = reposicao;
  $('aulaObs').value = obs;
  $('boxObs').classList.toggle('d-none', !reposicao);
  $('semAlunos').classList.toggle('d-none', alunos.length > 0);
  $('aulaErro').classList.add('d-none');
  modalAula.show();
}

$('aulaReposicao').addEventListener('change', (e) => {
  $('boxObs').classList.toggle('d-none', !e.target.checked);
});

$('btnSalvarAula').addEventListener('click', () => {
  const dados = {
    id: $('aulaId').value,
    dia: $('aulaDia').value,
    horario: $('aulaHorario').value,
    alunoId: $('aulaAluno').value,
    curso: $('aulaCurso').value,
    reposicao: $('aulaReposicao').checked,
    obs: $('aulaObs').value,
  };
  socket.emit('agenda:salvar', dados, (resp) => {
    if (resp.ok) modalAula.hide();
    else {
      $('aulaErro').textContent = resp.erro;
      $('aulaErro').classList.remove('d-none');
    }
  });
});

// Cliques no quadro (adicionar, editar, excluir)
$('areaQuadro').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-acao]');
  if (!btn) return;
  const { acao, id, dia, horario } = btn.dataset;

  if (acao === 'add') return abrirModalAula({ dia, horario });

  const item = estado.agenda.find((a) => a.id === id);
  if (!item) return;

  if (acao === 'editar') return abrirModalAula(item);

  if (acao === 'excluir') {
    const ok = await confirmar(
      `Excluir <strong>${esc(nomeAluno(item.alunoId))}</strong> do curso ${esc(item.curso)}
       (${nomeDia(item.dia)}, ${horaTexto(item.horario)})?`
    );
    if (ok) socket.emit('agenda:remover', id);
  }
});

// Filtros
$('filtroCurso').addEventListener('change', renderQuadro);
$('filtroAluno').addEventListener('input', renderQuadro);
$('btnLimpar').addEventListener('click', () => {
  $('filtroCurso').value = '';
  $('filtroAluno').value = '';
  renderQuadro();
});

// ================= Cadastro de alunos =================
function renderAlunos() {
  const busca = $('buscaAluno').value.trim().toLowerCase();
  const todos = [...estado.alunos].sort((a, b) => porNome(a.nome, b.nome));
  const lista = todos.filter((a) => !busca || a.nome.toLowerCase().includes(busca));

  $('totalAlunos').textContent = todos.length;
  $('listaAlunos').innerHTML = lista.length
    ? lista
        .map((a) => {
          const qtd = estado.agenda.filter((x) => x.alunoId === a.id).length;
          return `
        <li class="list-group-item d-flex align-items-center flex-wrap gap-2">
          <div class="me-auto">
            <strong>${esc(a.nome)}</strong><br />
            <small class="text-muted">${qtd} horário(s) no quadro</small>
          </div>
          <button class="btn btn-sm btn-outline-primary" data-acao-aluno="editar" data-id="${a.id}">✏️ Editar</button>
          <button class="btn btn-sm btn-outline-danger" data-acao-aluno="excluir" data-id="${a.id}">🗑️ Excluir</button>
        </li>`;
        })
        .join('')
    : '<li class="list-group-item text-muted">Nenhum aluno encontrado.</li>';
}

function resetFormAluno() {
  alunoEditandoId = '';
  $('alunoNome').value = '';
  $('tituloFormAluno').textContent = 'Cadastrar aluno';
  $('btnSalvarAluno').textContent = 'Cadastrar';
  $('btnCancelarAluno').classList.add('d-none');
  $('alunoErro').classList.add('d-none');
}

$('formAluno').addEventListener('submit', (e) => {
  e.preventDefault();
  socket.emit('aluno:salvar', { id: alunoEditandoId, nome: $('alunoNome').value }, (resp) => {
    if (resp.ok) {
      resetFormAluno();
      $('alunoNome').focus();
    } else {
      $('alunoErro').textContent = resp.erro;
      $('alunoErro').classList.remove('d-none');
    }
  });
});

$('btnCancelarAluno').addEventListener('click', resetFormAluno);
$('buscaAluno').addEventListener('input', renderAlunos);

$('listaAlunos').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-acao-aluno]');
  if (!btn) return;
  const aluno = estado.alunos.find((a) => a.id === btn.dataset.id);
  if (!aluno) return;

  if (btn.dataset.acaoAluno === 'editar') {
    alunoEditandoId = aluno.id;
    $('alunoNome').value = aluno.nome;
    $('tituloFormAluno').textContent = 'Editar aluno';
    $('btnSalvarAluno').textContent = 'Salvar alteração';
    $('btnCancelarAluno').classList.remove('d-none');
    $('alunoErro').classList.add('d-none');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('alunoNome').focus();
  } else {
    const qtd = estado.agenda.filter((x) => x.alunoId === aluno.id).length;
    const ok = await confirmar(
      `Excluir o aluno <strong>${esc(aluno.nome)}</strong>?` +
        (qtd ? `<br><small class="text-danger">Os ${qtd} horário(s) dele no quadro também serão removidos.</small>` : '')
    );
    if (ok) {
      if (alunoEditandoId === aluno.id) resetFormAluno();
      socket.emit('aluno:remover', aluno.id);
    }
  }
});

// ================= Abas =================
document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
    $('viewQuadro').classList.toggle('d-none', btn.dataset.view !== 'quadro');
    $('viewAlunos').classList.toggle('d-none', btn.dataset.view !== 'alunos');
  });
});

// ================= Quem está conectado =================
function renderOnline() {
  $('contOnline').textContent = nomesOnline.length;
  $('listaOnline').innerHTML = nomesOnline
    .map((n) => {
      const eu = n === meuNome;
      return `<span class="pessoa ${eu ? 'eu' : ''}">● ${esc(n)}${eu ? ' (você)' : ''}</span>`;
    })
    .join('');
}

function entrar() {
  if (meuNome) socket.emit('entrar', meuNome);
}

$('btnEntrar').addEventListener('click', () => {
  const n = $('inputNome').value.trim().slice(0, 30);
  if (!n) return $('inputNome').focus();
  meuNome = n;
  try { localStorage.setItem('nomeFuncionario', n); } catch (e) {}
  $('meuNome').textContent = n;
  entrar();
  renderOnline();
  modalNome.hide();
});
$('inputNome').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btnEntrar').click();
});
$('modalNome').addEventListener('shown.bs.modal', () => $('inputNome').focus());
$('btnTrocarNome').addEventListener('click', () => {
  $('inputNome').value = meuNome;
  modalNome.show();
});

if (meuNome) $('meuNome').textContent = meuNome;
else modalNome.show();

// ================= Tempo real =================
socket.on('estado', (novo) => {
  estado = novo;
  renderQuadro();
  renderAlunos();
});

socket.on('online', (nomes) => {
  nomesOnline = nomes;
  renderOnline();
});

socket.on('connect', () => {
  $('status').textContent = '● Online';
  $('status').className = 'badge text-bg-success';
  entrar(); // reentra com o nome se a conexão cair e voltar
});
socket.on('disconnect', () => {
  $('status').textContent = '● Desconectado';
  $('status').className = 'badge text-bg-danger';
});