// Função local (apenas no teste) que usa db.query mockado
jest.mock('../database/pooldb'); // usando o pooolddb do projeto, só que mockado
const db = require('../database/pooldb');

// Função local, só para o teste 
async function gerarRelatorioVendas(inicio, fim) {
  // 1) Busca pedidos do período em questão
  const [pedidos] = await db.query(
    `SELECT id, status, total
       FROM pedidos
      WHERE criado_em BETWEEN ? AND ?`,
    [inicio, fim]
  );

  // 2) Considera apenas o 'pago' 
  const pagos = pedidos.filter(p => p.status === 'pago');

  // 3) Soma receita e conta itens/produtos
  let totalReceita = 0;
  let itensVendidos = 0;
  const contagem = new Map();

  for (const p of pagos) {
    totalReceita += Number(p.total || 0);

    const [itens] = await db.query(
      `SELECT pi.quantidade, prod.nome
         FROM pedido_itens pi
         JOIN produtos prod ON prod.id = pi.produto_id
        WHERE pi.pedido_id = ?`,
      [p.id]
    );

    for (const it of itens) {
      const q = Number(it.quantidade || 0);
      itensVendidos += q;
      contagem.set(it.nome, (contagem.get(it.nome) || 0) + q);
    }
  }

  const produtosMaisVendidos = [...contagem.entries()]
    .map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade);

  return { totalReceita, itensVendidos, produtosMaisVendidos, pedidosConsiderados: pagos };
}

describe('Relatório de Vendas (sem alterar admin.js)', () => {
  beforeEach(() => jest.clearAllMocks());

  const pedidosPeriodo = [
    { id: 1, status: 'pago',      total: 100.50 },
    { id: 2, status: 'pendente',  total:  80.00 },
    { id: 3, status: 'cancelado', total: 120.00 },
  ];

  it('filtra pelo período, considera só pagos e calcula receita/itens/ranking', async () => {
    db.query.mockResolvedValueOnce([pedidosPeriodo]);

    db.query.mockResolvedValueOnce([
      [
        { nome: 'Carta A', quantidade: 2 },
        { nome: 'Carta B', quantidade: 1 },
      ],
    ]);

    const rel = await gerarRelatorioVendas('2025-10-08', '2025-10-12');

    expect(rel.pedidosConsiderados.map(p => p.id)).toEqual([1]);
    expect(rel.totalReceita).toBeCloseTo(100.5);
    expect(rel.itensVendidos).toBe(3);
    expect(rel.produtosMaisVendidos).toEqual([
      { nome: 'Carta A', quantidade: 2 },
      { nome: 'Carta B', quantidade: 1 },
    ]);

    expect(db.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM pedidos'),
      ['2025-10-08', '2025-10-12']
    );
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM pedido_itens'),
      [1]
    );
  });

  it('ignora pendente/cancelado mesmo com totais maiores', async () => {
    db.query.mockResolvedValueOnce([pedidosPeriodo]);
    db.query.mockResolvedValueOnce([[{ nome: 'Carta X', quantidade: 4 }]]);

    const rel = await gerarRelatorioVendas('2025-10-01', '2025-10-31');

    expect(rel.pedidosConsiderados).toHaveLength(1);
    expect(rel.totalReceita).toBeCloseTo(100.5);
    expect(rel.itensVendidos).toBe(4);
  });

  it('retorna zerado quando não há pagos no período', async () => {
    db.query.mockResolvedValueOnce([pedidosPeriodo.filter(p => p.status !== 'pago')]);
    db.query.mockResolvedValueOnce([[]]);

    const rel = await gerarRelatorioVendas('2025-09-01', '2025-09-30');

    expect(rel.pedidosConsiderados).toHaveLength(0);
    expect(rel.totalReceita).toBe(0);
    expect(rel.itensVendidos).toBe(0);
    expect(rel.produtosMaisVendidos).toEqual([]);
  });
});