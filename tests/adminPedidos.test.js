const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { adminRouter } = require('../backend/admin');
const db = require('../database/pooldb');
const { enviarEmailStatusPedido } = require('../frontend/js/enviarEmail');

// O que tá testando? Resposta: Atualização de status de pedidos via rota admin, 
// e queremos como resultado final: Commit/rollback corretos e disparo de e-mail apenas quando for necessário

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  console.error.mockRestore();
  console.log.mockRestore();
});

jest.mock('../database/pooldb', () => ({
  getConnection: jest.fn(),
  query: jest.fn()
}));

jest.mock('../frontend/js/enviarEmail', () => ({
  enviarEmailStatusPedido: jest.fn()
}));

describe('POST /admin/pedidos/:id', () => {
  let app, mockConn;

  beforeEach(() => {
    jest.clearAllMocks();

    mockConn = {
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
      query: jest.fn()
    };
    db.getConnection.mockResolvedValue(mockConn);

    app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());
    app.use(
      session({
        secret: 'teste',
        resave: false,
        saveUninitialized: true
      })
    );

    app.use((req, res, next) => {
      req.session.isAdmin = true;
      req.session.pinValidated = true;
      next();
    });

    app.use('/admin', adminRouter);
  });

  it('atualiza o status e envia e-mail quando o status muda', async () => {
    mockConn.query
      .mockResolvedValueOnce([[{ status: 'pendente', email: 'cliente@teste.com', nome: 'Luiz' }]]) // busca pedido
      .mockResolvedValueOnce([]); // update pedido

    const res = await request(app)
      .post('/admin/pedidos/1')
      .send({ status: 'pago' });

    expect(res.status).toBe(302);
    expect(mockConn.beginTransaction).toHaveBeenCalled();
    expect(mockConn.commit).toHaveBeenCalled();
    expect(enviarEmailStatusPedido).toHaveBeenCalledWith(
      { id: '1' },
      { email: 'cliente@teste.com', nome: 'Luiz' },
      'pago',
      null
    );
  });

  it('não envia e-mail se o status não mudou', async () => {
    mockConn.query
      .mockResolvedValueOnce([[{ status: 'pago', email: 'cliente@teste.com', nome: 'Luiz' }]]) // status igual
      .mockResolvedValueOnce([]); // update pedido

    const res = await request(app)
      .post('/admin/pedidos/1')
      .send({ status: 'pago' });

    expect(res.status).toBe(302);
    expect(enviarEmailStatusPedido).not.toHaveBeenCalled();
  });

  it('faz rollback se o pedido não existir', async () => {
    mockConn.query.mockResolvedValueOnce([[]]); // pedido inexistente

    const res = await request(app)
      .post('/admin/pedidos/999')
      .send({ status: 'pago' });

    expect(mockConn.rollback).toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(enviarEmailStatusPedido).not.toHaveBeenCalled();
  });

  it('faz rollback e loga erro se ocorrer exceção', async () => {
    mockConn.query.mockRejectedValue(new Error('Erro DB'));

    const res = await request(app)
      .post('/admin/pedidos/1')
      .send({ status: 'pago' });

    expect(mockConn.rollback).toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(enviarEmailStatusPedido).not.toHaveBeenCalled();
  });
});