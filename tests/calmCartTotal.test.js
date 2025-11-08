const { calcCartTotal } = require('../frontend/js/calcCartTotal');

// O que tá testando? Resposta: As funcionalidades do carrinho de compras , 
// e queremos como resultado final: Cálculos funcionando corretamente em todos os cenários de teste

describe('calcCartTotal', () => {
  test('retorna 0 com lista vazia', () => {
    expect(calcCartTotal([])).toBe(0);
  });

  test('soma itens sem desconto', () => {
    const items = [
      { preco: 10, desconto_percentual: 0, quantidade: 2 },
      { preco: 5, desconto_percentual: 0, quantidade: 3 },
    ];
    expect(calcCartTotal(items)).toBe(10*2 + 5*3);
  });

  test('aplica desconto por item', () => {
    const items = [                                           // Calculos abaixo:           
      { preco: 100, desconto_percentual: 10, quantidade: 1 }, // 90
      { preco: 50,  desconto_percentual: 20, quantidade: 2 }, // 40*2 = 80
    ];
    expect(calcCartTotal(items)).toBe(170);
  });

  test('ignora valores inválidos com coerção para 0', () => {
    const items = [
      { preco: 'x', desconto_percentual: 'y', quantidade: 'z' },
    ];
    expect(calcCartTotal(items)).toBe(0);
  });

  test('quantidades diferentes e desconto misto', () => {
    const items = [                                            // Calculos abaixo:  
      { preco: 20, desconto_percentual: 0, quantidade: 5 },    // 100
      { preco: 30, desconto_percentual: 50, quantidade: 1 },   // 15
      { preco: 7.5, desconto_percentual: 10, quantidade: 4 },  // 6.75*4 = 27 
    ];
    expect(calcCartTotal(items)).toBeCloseTo(142);
  });
});
