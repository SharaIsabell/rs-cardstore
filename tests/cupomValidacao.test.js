const request = require('supertest');
const express = require('express');
const db = require('../database/pooldb');

// --- MOCKS (para simulação) ---
// 1. Mock do banco de dados para controlar os resultados das queries
jest.mock('../database/pooldb', () => ({
  query: jest.fn(),
  getConnection: jest.fn()
}));

// 2. Mock do Mercado Pago para evitar erros de inicialização no backend/index.js
jest.mock('mercadopago', () => ({
  MercadoPagoConfig: jest.fn(),
  Payment: jest.fn()
}));

// 3. Mock da Sessão: Garante que o req.session.userId seja sempre 1 (modelo de teste)
jest.mock('express-session', () => {
  return () => (req, res, next) => {
    req.session = { userId: 1 };
    next();
  };
});

// Importa o router DEPOIS de criar os mocks
const router = require('../backend/index');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Monta o router na raiz para teste
app.use('/', router);
// --- FIM DOS MOCKS ---

// --- TESTES ---

describe('Validação de Vínculo de Cupom (Segurança)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Deve aplicar o cupom se ele pertencer ao usuário logado', async () => {
    // Caso de teste: Banco encontra o cupom vinculado ao user_id: 1
    db.query.mockResolvedValueOnce([[
      {
        id: 10,
        codigo: 'MEUCUPOM',
        tipo: 'percentual',
        valor: 10,
        user_id: 1 // ID bate com a sessão
      }
    ]]);

    const res = await request(app)
      .post('/carrinho/aplicar-cupom')
      .send({ codigo: 'MEUCUPOM' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Cupom aplicado');
  });

  it('Deve rejeitar o cupom se ele pertencer a outro usuário', async () => {
    // Cao de teste: Banco retorna vazio.
    // Isso acontece na aplicação real porque a query filtra por `user_id = 1`.
    // Se o cupom pertencesse ao user_id 2, a query não o encontraria para o user 1.
    db.query.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .post('/carrinho/aplicar-cupom')
      .send({ codigo: 'CUPOMALHEIO' });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Cupom inválido/);
  });
});

it('Deve retornar erro se o código do cupom não for enviado ou estiver vazio', async () => {
  // Caso de teste: O usuário tenta aplicar sem digitar nada
  const res = await request(app)
    .post('/carrinho/aplicar-cupom')
    .send({ codigo: '' }); // Enviando vazio

  // O backend retorna JSON direto (status 200 padrão) com success: false
  expect(res.body.success).toBe(false);
  expect(res.body.message).toBe('Código do cupom não pode ser vazio.');
});

it('Deve rejeitar cupom se ele já estiver marcado como usado no banco', async () => {
  // Caso de teste: A query SQL filtra por `usado = FALSE`.
  // Se o cupom existir mas `usado` for true, o banco retorna array vazio [].
  db.query.mockResolvedValueOnce([[]]);

  const res = await request(app)
    .post('/carrinho/aplicar-cupom')
    .send({ codigo: 'CUPOMJAUSADO' });

  expect(res.status).toBe(404);
  expect(res.body.success).toBe(false);
  expect(res.body.message).toMatch(/Cupom inválido, expirado ou já utilizado/);
});

it('Deve aplicar corretamente um cupom de valor fixo (formatação de mensagem)', async () => {
  // Caso de teste: Verifica se a lógica de exibição (R$ vs %) funciona para tipo 'fixo'
  db.query.mockResolvedValueOnce([[
    {
      id: 20,
      codigo: 'FIXO15',
      tipo: 'fixo',
      valor: 15.00,
      user_id: 1
    }
  ]]);

  const res = await request(app)
    .post('/carrinho/aplicar-cupom')
    .send({ codigo: 'FIXO15' });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  // Verifica se a mensagem contém "R$ 15,00" (lógica específica do backend para tipo fixo)
  expect(res.body.message).toMatch("Cupom aplicado! R$ 15.00");
});

it('Deve retornar erro 500 caso o banco de dados falhe', async () => {
  // Caso de teste: Simula uma queda ou erro na query do banco
  db.query.mockRejectedValueOnce(new Error('Erro de conexão com o banco'));

  const res = await request(app)
    .post('/carrinho/aplicar-cupom')
    .send({ codigo: 'QUALQUER' });

  expect(res.status).toBe(500);
  expect(res.body.success).toBe(false);
  expect(res.body.message).toContain('Erro no servidor');
});