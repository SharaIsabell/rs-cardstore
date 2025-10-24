const nodemailer = require('nodemailer');
const GMAIL_USER = 'rscardstore@gmail.com';
const GMAIL_APP_PASS = 'fdsj niye rngv yjtt';
const ADMIN_TO = 'admin@rscardstore.com';

const enviarEmailVerificacao = async (email, token) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'rscardstore@gmail.com',
      pass: 'fdsj niye rngv yjtt'
    }
  });

  const urlVerificacao = `http://localhost:3000/verificar-email?token=${token}`;

  const mailOptions = {
    from: 'rscardstore@gmail.com',
    to: email,
    subject: 'Verificação de E-mail - RS Card Store',
    html: `<p>Por favor, clique no link a seguir para verificar seu e-mail: <a href="${urlVerificacao}">${urlVerificacao}</a></p><p>Este link expira em 5 minutos.</p>`
  };

  await transporter.sendMail(mailOptions);
};

/**
 * Envia e-mail de alerta de estoque 
 * @param {{id:number, nome:string, estoque:number, imagem_url?:string}} produto
 * @param {'LOW'|'OUT'} tipo - LOW = baixo, OUT = esgotou
 * @param {number} [limiteBaixo=5]
 */
async function enviarEmailAlertaEstoque(produto, tipo, limiteBaixo = 5) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS }
  });

  const assunto =
    tipo === 'OUT'
      ? `Produto ESGOTADO: ${produto.nome} (ID ${produto.id})`
      : `Estoque baixo (${produto.estoque}) — ${produto.nome} (ID ${produto.id})`;

  const corpoHtml =
    tipo === 'OUT'
      ? `
        <div style="font-family:Arial,Helvetica,sans-serif;">
          <h2>Produto esgotado</h2>
          <p><strong>Produto:</strong> ${produto.nome} (ID ${produto.id})</p>
          <p><strong>Estoque atual:</strong> ${produto.estoque}</p>
          ${produto.imagem_url ? `<p><img src="${produto.imagem_url}" alt="${produto.nome}" style="max-width:300px"/></p>` : ''}
          <hr/><p>RS Card Store • Notificação automática</p>
        </div>
      `
      : `
        <div style="font-family:Arial,Helvetica,sans-serif;">
          <h2>Estoque baixo</h2>
          <p><strong>Produto:</strong> ${produto.nome} (ID ${produto.id})</p>
          <p><strong>Estoque atual:</strong> ${produto.estoque}</p>
          <p><strong>Limite de alerta:</strong> ${limiteBaixo}</p>
          ${produto.imagem_url ? `<p><img src="${produto.imagem_url}" alt="${produto.nome}" style="max-width:300px"/></p>` : ''}
          <hr/><p>RS Card Store • Notificação automática</p>
        </div>
      `;

  await transporter.sendMail({
    from: GMAIL_USER,
    to: ADMIN_TO,
    subject: assunto,
    html: corpoHtml
  });
}

/**
 * Envia e-mail de confirmação de pedido para o cliente com resumo e NF.
 * @param {object} pedido - Dados do pedido (id, total, frete, email, nome)
 * @param {Array<object>} itens - Lista de itens (nome, quantidade, preco_unitario)
 * @param {string} linkNF - URL da nota fiscal fictícia
 */
const enviarEmailConfirmacaoPedido = async (pedido, itens, linkNF) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: GMAIL_USER,
            pass: GMAIL_APP_PASS
        }
    });

    // Monta a lista de itens para o HTML
    const itensHtml = itens.map(item => `
        <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 10px;">${item.nome}</td>
            <td style="padding: 10px; text-align: center;">${item.quantidade}</td>
            <td style="padding: 10px; text-align: right;">R$ ${Number(item.preco_unitario).toFixed(2).replace('.', ',')}</td>
        </tr>
    `).join('');

    const freteFormatado = Number(pedido.frete).toFixed(2).replace('.', ',');
    const totalFormatado = Number(pedido.total).toFixed(2).replace('.', ',');

    // Monta o corpo do e-mail
    const corpoHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
        <header style="background-color: #0A2463; padding: 20px; text-align: center;">
            <h1 style="color: #FFFFFF; margin: 0; font-family: 'Montserrat', sans-serif;">RS<span style="color: #FF9F1C;">CardStore</span></h1>
        </header>

        <main style="padding: 30px 40px; color: #333;">
        <h2 style="color: #0A2463;">Pedido Confirmado!</h2>
            
            <p style="margin-bottom: 20px;">Olá, ${pedido.nome.split(' ')[0]}!</p>
            <p style="margin-bottom: 20px;">Seu pedido <strong>#${pedido.id}</strong> foi confirmado e já estamos preparando tudo para o envio.</p>

            <p>Abaixo está o resumo da sua compra e o link para sua nota fiscal.</p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 25px 0;">
                <thead>
                    <tr style="background-color: #f4f4f9;">
                        <th style="padding: 10px; text-align: left;">Item</th>
                        <th style="padding: 10px; text-align: center;">Qtd.</th>
                        <th style="padding: 10px; text-align: right;">Preço</th>
                    </tr>
                </thead>
                <tbody>
                    ${itensHtml}
                </tbody>
                <tfoot>
                    <tr style="border-top: 2px solid #eee;">
                        <td colspan="2" style="padding: 10px; text-align: right; color: #333;">Frete:</td>
                        <td style="padding: 10px; text-align: right;">R$ ${freteFormatado}</td>
                    </tr>
                    <tr style="font-size: 1.2em; font-weight: bold; color: #0A2463; border-top: 1px solid #ddd;">
                        <td colspan="2" style="padding: 15px 10px; text-align: right;">Total:</td>
                        <td style="padding: 15px 10px; text-align: right;">R$ ${totalFormatado}</td>
                    </tr>
                </tfoot>
            </table>

            <h3 style="color: #0A2463;">Nota Fiscal</h3>
            <p>Sua nota fiscal (fictícia) está disponível para download. Guarde este link para seu registro e garantia.</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="http://localhost:3000${linkNF}" target="_blank" style="background-color: #FF9F1C; color: #0A2463; padding: 12px 25px; text-decoration: none; border-radius: 50px; font-weight: bold; font-family: 'Lato', sans-serif;">
                    Acessar Nota Fiscal
                </a>
            </div>
            
            <p style="margin-top: 30px;">Obrigado por comprar na RS Card Store!</p>
        </main>
        <footer style="background-color: #f9f9f9; text-align: center; padding: 20px; font-size: 0.8em; color: #777;">
            © 2025 RS Card Store. Todos os direitos reservados.
        </footer>
    </div>
    `;

    const mailOptions = {
        from: `"RS Card Store" <${GMAIL_USER}>`,
        to: pedido.email, // E-mail do cliente
        subject: `Confirmação do Pedido #${pedido.id} - RS Card Store`,
        html: corpoHtml
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[E-MAIL] Confirmação do pedido ${pedido.id} enviada para ${pedido.email}`);
    } catch (error) {
        console.error(`[E-MAIL] Erro ao enviar confirmação para ${pedido.email}:`, error);
    }
};

module.exports = { 
    enviarEmailVerificacao, 
    enviarEmailAlertaEstoque,
    enviarEmailConfirmacaoPedido
};