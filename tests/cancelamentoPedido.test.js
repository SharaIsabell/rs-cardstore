const request = require('supertest');
const express = require('express');
const session = require('express-session');
const router = require('../backend/index'); 
const db = require('../database/pooldb');

// Mocks
jest.mock('../database/pooldb', () => ({
  getConnection: jest.fn(),
  query: jest.fn()
}));
jest.mock('../frontend/js/enviarEmail', () => ({ enviarEmailStatusPedido: jest.fn() }));
jest.mock('mercadopago', () => ({ MercadoPagoConfig: jest.fn(), Payment: jest.fn() }));

describe('Teste de Robustez ACID', () => {
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
    db.getConnection.mockResolvedValue(mockConn); // Aqui Garante o uso da conexão mockada

    app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());
    app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => { req.session.userId = 1; next(); });
    app.use('/', router);
  });

  it('PROVA DE ROLLBACK: Deve reverter tudo se falhar ao devolver o estoque', async () => {
    // 1. SELECT inicial funciona
    mockConn.query.mockResolvedValueOnce([[{ status: 'pago', id: 100 }]]); 
    // 2. Busca itens funciona
    mockConn.query.mockResolvedValueOnce([[{ produto_id: 10, quantidade: 5 }]]);
    
    // 3. ERRO PROPOSITAL NO UPDATE DE ESTOQUE
    const erroSimulado = new Error('Erro Fatal no Banco de Dados');
    mockConn.query.mockRejectedValueOnce(erroSimulado);

    await request(app).post('/pedido/cancelar/100');

    // A PROVA:
    expect(mockConn.beginTransaction).toHaveBeenCalled(); // Começou a transação? SIM.
    expect(mockConn.rollback).toHaveBeenCalled(); // Chamou o Rollback? SIM.
    expect(mockConn.commit).not.toHaveBeenCalled(); // Garante que NÃO salvou nada errado.
    expect(mockConn.release).toHaveBeenCalled(); // Liberou a conexão? SIM.
  });
});