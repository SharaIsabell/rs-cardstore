function calcCartTotal(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((acc, item) => {
    const price = Number(item.preco) || 0;
    const disc = Number(item.desconto_percentual) || 0;
    const qty = Number(item.quantidade) || 0;
    const unit = price * (1 - disc/100);
    return acc + (unit * qty);
  }, 0);
}

if (typeof module !== 'undefined') {
  module.exports = { calcCartTotal };
}