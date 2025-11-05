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

/**
  * Envia e-mail de atualização de status do pedido para o cliente.
  * @param {object} pedido - Dados do pedido (id)
  * @param {object} cliente - Dados do cliente (email, nome)
  * @param {string} novoStatus - O novo status do pedido ('pago', 'enviado', 'entregue', 'cancelado')
  * @param {string|null} codigoRastreio - O código de rastreio, se aplicável (para status 'enviado')
  */
 const enviarEmailStatusPedido = async (pedido, cliente, novoStatus, codigoRastreio = null) => {
     const transporter = nodemailer.createTransport({
         service: 'gmail',
         auth: {
             user: GMAIL_USER,
             pass: GMAIL_APP_PASS
         }
     });

     const statusLegivelMap = {
         'pago': 'Pagamento Confirmado',
         'enviado': 'Enviado',
         'entregue': 'Entregue',
         'cancelado': 'Cancelado'
     };
     const statusLegivel = statusLegivelMap[novoStatus] || novoStatus.charAt(0).toUpperCase() + novoStatus.slice(1);
 
     const subject = `Atualização do Pedido #${pedido.id}: ${statusLegivel} - RS Card Store`;

     let statusMessage = '';
     switch (novoStatus) {
         case 'pago':
             statusMessage = `Seu pagamento foi confirmado com sucesso! Já estamos separando seus produtos para envio.`;
             break;
         case 'enviado':
             statusMessage = `Ótima notícia! Seu pedido foi enviado.`;
             if (codigoRastreio) {
                 statusMessage += ` Você pode acompanhá-lo usando o código de rastreio: <strong>${codigoRastreio}</strong>`;
             }
             break;
         case 'entregue':
             statusMessage = `Confirmamos a entrega do seu pedido! Esperamos que você ganhe vários duelos. 😊`;
             break;
         case 'cancelado':
             statusMessage = `Seu pedido foi cancelado. Se você tiver alguma dúvida, por favor, entre em contato conosco.`;
             break;
         default:
             statusMessage = `O status foi atualizado para ${statusLegivel}.`;
     }
 
     const corpoHtml = `
     <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
         <header style="background-color: #0A2463; padding: 20px; text-align: center;">
             <h1 style="color: #FFFFFF; margin: 0; font-family: 'Montserrat', sans-serif;">RS<span style="color: #FF9F1C;">CardStore</span></h1>
         </header>
 
         <main style="padding: 30px 40px; color: #333;">
             <h2 style="color: #0A2463;">Atualização do seu Pedido #${pedido.id}</h2>
             
             <p style="margin-bottom: 20px;">Olá, ${cliente.nome.split(' ')[0]}!</p>
             <p style="margin-bottom: 20px;">Temos uma novidade sobre o seu pedido <strong>#${pedido.id}</strong>.</p>
 
             <div style="background-color: #f4f4f9; padding: 15px; border-radius: 5px; margin-bottom: 25px; border-left: 4px solid #FF9F1C;">
                 <p style="margin: 0; font-size: 1.1em;"><strong>Novo Status: ${statusLegivel}</strong></p>
                 <p style="margin: 5px 0 0;">${statusMessage}</p>
             </div>
 
             <p>Você pode ver todos os detalhes do seu pedido acessando sua conta em nosso site:</p>
             <div style="text-align: center; margin: 30px 0;">
                 <a href="http://localhost:3000/meus-pedidos" target="_blank" style="background-color: #0A2463; color: #FFFFFF; padding: 12px 25px; text-decoration: none; border-radius: 50px; font-weight: bold; font-family: 'Lato', sans-serif;">
                     Ver Meus Pedidos
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
         to: cliente.email, // E-mail do cliente
         subject: subject,
         html: corpoHtml
     };
 
     try {
         await transporter.sendMail(mailOptions);
         console.log(`[E-MAIL] Atualização de status (${novoStatus}) do pedido ${pedido.id} enviada para ${cliente.email}`);
     } catch (error) {
         console.error(`[E-MAIL] Erro ao enviar atualização (${novoStatus}) para ${cliente.email} (Pedido ${pedido.id}):`, error);
     }
 };

 /**
 * Envia e-mail de redefinição de senha.
 * @param {string} email - Email do destinatário
 * @param {string} token - Token de redefinição
 */
const enviarEmailRedefinicaoSenha = async (email, token) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: GMAIL_USER,
            pass: GMAIL_APP_PASS
        }
    });

    // Link seguro com token
    const urlRedefinicao = `http://localhost:3000/redefinir-senha?token=${token}`;

    // Template HTML moderno
    const htmlBody = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
        <meta charset="UTF-M">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Lato:wght@400;700&display=swap');
            body {
                font-family: 'Lato', Arial, sans-serif;
                margin: 0;
                padding: 0;
                background-color: #f4f4f9;
            }
            .container {
                width: 90%;
                max-width: 600px;
                margin: 20px auto;
                background-color: #ffffff;
                border: 1px solid #e0e0e0;
                border-radius: 12px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.05);
                overflow: hidden;
            }
            .header {
                background-color: #0A2463;
                padding: 30px 40px;
                text-align: center;
            }
            .logo {
                font-family: 'Montserrat', Arial, sans-serif;
                font-size: 28px;
                font-weight: 800;
                color: #e0e0e0;
                text-decoration: none;
            }
            .logo-span {
                color: #FF9F1C;
            }
            .content {
                padding: 40px;
                color: #333;
                line-height: 1.6;
            }
            .content h2 {
                font-family: 'Montserrat', Arial, sans-serif;
                color: #0A2463;
                margin: 0 0 20px;
                font-size: 24px;
            }
            .content p {
                margin-bottom: 20px;
            }
            .icon {
                font-size: 40px;
                display: block;
                text-align: center;
                margin-bottom: 20px;
                color: #0A2463;
            }
            .button-wrapper {
                text-align: center;
                margin: 30px 0;
            }
            .button {
                background-color: #FF9F1C;
                color: #0A2463;
                padding: 14px 30px;
                text-decoration: none;
                border-radius: 50px;
                font-weight: bold;
                font-family: 'Lato', sans-serif;
                font-size: 16px;
                border: none;
                display: inline-block;
            }
            .footer {
                background-color: #f9f9f9;
                text-align: center;
                padding: 20px 40px;
                font-size: 12px;
                color: #777;
                border-top: 1px solid #eee;
            }
        </style>
    </head>
    <body>
        <div class.="container" style="width: 90%; max-width: 600px; margin: 20px auto; background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); overflow: hidden;">
            <div class="header" style="background-color: #0A2463; padding: 30px 40px; text-align: center;">
                <a href="http://localhost:3000" class="logo" style="font-family: 'Montserrat', Arial, sans-serif; font-size: 28px; font-weight: 800; color: #e0e0e0; text-decoration: none;">
                    RS<span class="logo-span" style="color: #FF9F1C;">CardStore</span>
                </a>
            </div>
            <div class="content" style="padding: 40px; color: #333; line-height: 1.6;">
                <span class="icon" style="font-size: 40px; display: block; text-align: center; margin-bottom: 20px; color: #0A2463;">🔑</span>
                <h2 style="font-family: 'Montserrat', Arial, sans-serif; color: #0A2463; margin: 0 0 20px; font-size: 24px;">Redefinição de Senha</h2>
                <p style="margin-bottom: 20px;">Olá,</p>
                <p style="margin-bottom: 20px;">Recebemos uma solicitação para redefinir a senha da sua conta. Se foi você, clique no botão abaixo para criar uma nova senha:</p>
                <div class="button-wrapper" style="text-align: center; margin: 30px 0;">
                    <a href="${urlRedefinicao}" target="_blank" class="button" style="background-color: #FF9F1C; color: #0A2463; padding: 14px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; font-family: 'Lato', sans-serif; font-size: 16px; border: none; display: inline-block;">
                        Criar Nova Senha
                    </a>
                </div>
                <p style="margin-bottom: 20px;">Se você não solicitou isso, pode ignorar este e-mail com segurança.</p>
                <p style="font-size: 0.9em; color: #777; margin-bottom: 20px;">Este link é válido por 5 minutos.</p>
            </div>
            <div class="footer" style="background-color: #f9f9f9; text-align: center; padding: 20px 40px; font-size: 12px; color: #777; border-top: 1px solid #eee;">
                © 2025 RS Card Store. Todos os direitos reservados.
            </div>
        </div>
    </body>
    </html>
    `;

    const mailOptions = {
        from: `"RS Card Store" <${GMAIL_USER}>`,
        to: email,
        subject: 'Redefinição de Senha - RS Card Store',
        html: htmlBody
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`[E-MAIL] Redefinição de senha enviada para ${email}`);
    } catch (error) {
        console.error(`[E-MAIL] Erro ao enviar redefinição para ${email}:`, error);
    }
};

module.exports = { 
    enviarEmailVerificacao, 
    enviarEmailAlertaEstoque,
    enviarEmailConfirmacaoPedido,
    enviarEmailStatusPedido,
    enviarEmailRedefinicaoSenha
};