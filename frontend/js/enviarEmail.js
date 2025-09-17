const nodemailer = require('nodemailer');

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

module.exports = { enviarEmailVerificacao };