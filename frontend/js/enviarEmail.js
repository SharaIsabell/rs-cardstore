const nodemailer = require('nodemailer');
const GMAIL_USER = 'rscardstore@gmail.com';
const GMAIL_APP_PASS = 'fdsj niye rngv yjtt';
const ADMIN_TO = 'admin@rscardstore.com';

const enviarEmailVerificacao = async (email, token) => {
  // Configure o transporter do Nodemailer (substitua com suas credenciais de e-mail)
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
 * Envia e-mail de alerta de estoque (usando param para colocar alguns atributos sem usar o .env)
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

module.exports = { enviarEmailVerificacao, enviarEmailAlertaEstoque };