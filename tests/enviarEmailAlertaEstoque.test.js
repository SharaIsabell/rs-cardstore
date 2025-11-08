const nodemailer = require('nodemailer');
const { enviarEmailAlertaEstoque } = require('../frontend/js/enviarEmail');

// O que tá testando? Resposta: Alertas de estoque baixo ou esgotado , 
// e queremos como resultado final: E-mails corretos, ou falhas de envio tratadas sem crashar

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  console.error.mockRestore();
  console.log.mockRestore();
});

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue(true)
  }))
}));

describe('enviarEmailAlertaEstoque', () => {
  const produto = { id: 10, nome: 'Booster Pack', estoque: 2, imagem_url: 'https://img' };
  let transporter;

  beforeEach(() => {
    transporter = { sendMail: jest.fn().mockResolvedValue(true) };
    nodemailer.createTransport.mockReturnValue(transporter);
  });

  it('envia e-mail de estoque baixo corretamente', async () => {
    await enviarEmailAlertaEstoque(produto, 'LOW', 5);

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Estoque baixo'),
        html: expect.stringContaining('Booster Pack')
      })
    );
  });

  it('envia e-mail de produto esgotado corretamente', async () => {
    await enviarEmailAlertaEstoque(produto, 'OUT');

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('ESGOTADO'),
        html: expect.stringContaining('Produto esgotado')
      })
    );
  });

});